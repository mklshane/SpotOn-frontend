/**
 * Regression tests for the two database guards in src/data/db.ts.
 *
 * The bug these guard: a completed screening was lost on the web build with the message
 * "We couldn't save this screening ... If SpotOn is open in another tab, close it and try again."
 *
 * Two independent defects produced that screen:
 *
 * 1. expo-sqlite's `withTransactionAsync` is a bare BEGIN/COMMIT on a SHARED connection with no
 *    queueing. The background directory sync (sync.ts, eight transactions per page, started
 *    fire-and-forget from the Clinics tab and outliving it) interleaved with the screening save;
 *    the second BEGIN threw "cannot start a transaction within a transaction" and the loser's
 *    ROLLBACK unwound the winner's work. `withDbTransaction` is the FIFO that prevents it.
 * 2. Every save failure rendered the multi-tab copy, because analysis.tsx discarded the result of
 *    `isDatabaseLockedOut`. `classifyDbError` is what lets the screen tell the truth, so every
 *    message string it has to recognize is pinned here against the code that emits it.
 *
 * Compiles the real module with the project's own tsc (never a retyped copy), swapping only the
 * expo-sqlite import for a stub connection that records the order operations ran in.
 *
 * Run:  npm run test:db-guards
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'db-guards-'));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  [
    'src/data/db.ts', 'src/config.ts', 'src/lib/account-scope.ts', 'src/lib/storage-keys.ts',
    '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022',
    '--lib', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

// db.ts imports expo-sqlite, which cannot load outside a native/web runtime. Point the compiled
// output at a stub whose openDatabaseAsync hands back a fake connection.
mkdirSync(join(out, 'stub'), { recursive: true });
writeFileSync(
  join(out, 'stub', 'expo-sqlite.js'),
  `export let conn = null;
export function setConn(c) { conn = c; }
export async function openDatabaseAsync() { return conn; }
`,
);
// db.ts reads Platform.OS to decide whether the in-memory fallback applies. Pin it to 'web',
// which is the platform every case here is about.
writeFileSync(join(out, 'stub', 'react-native.js'), `export const Platform = { OS: 'web' };\n`);
// tsc emits extensionless relative specifiers, which node's ESM loader will not resolve.
const js = join(out, 'data', 'db.js');
writeFileSync(
  js,
  readFileSync(js, 'utf8')
    .replace(/from "expo-sqlite"/, `from "../stub/expo-sqlite.js"`)
    .replace(/from "react-native"/, `from "../stub/react-native.js"`)
    .replace(/from "(\.\.?\/[^"]+?)"/g, (m, spec) => (spec.endsWith('.js') ? m : `from "${spec}.js"`)),
);

const { setConn } = await import(pathToFileURL(join(out, 'stub', 'expo-sqlite.js')).href);
const db = await import(pathToFileURL(js).href);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ withDbTransaction ---- */

/**
 * A connection that models the one property that matters: BEGIN throws while a transaction is
 * already open, exactly as SQLite does. Anything that gets past this could get past SQLite.
 */
function makeConn(log) {
  let inTxn = false;
  return {
    execAsync: async (sql) => { log.push(`exec:${sql.slice(0, 24)}`); },
    getFirstAsync: async () => ({ user_version: 999 }), // pretend fully migrated
    runAsync: async () => {},
    withTransactionAsync: async (task) => {
      if (inTxn) throw new Error('cannot start a transaction within a transaction');
      inTxn = true;
      log.push('BEGIN');
      try {
        await task();
        log.push('COMMIT');
      } finally {
        inTxn = false;
      }
    },
  };
}

console.log('withDbTransaction');
{
  const log = [];
  setConn(makeConn(log));

  // Two overlapping callers, the shape that used to break: a long sync transaction with a
  // screening save starting in the middle of it.
  const slow = db.withDbTransaction(async () => { log.push('sync-write'); await sleep(40); });
  await sleep(5);
  const save = db.withDbTransaction(async () => { log.push('screening-write'); });
  await Promise.all([slow, save]);

  check('overlapping transactions serialize',
    log.join(',').includes('BEGIN,sync-write,COMMIT,BEGIN,screening-write,COMMIT'),
    log.join(','));
}
{
  const log = [];
  setConn(makeConn(log));
  // A transaction that throws must not wedge the queue for the rest of the session - the app has
  // no way to recover a permanently blocked chain short of a reload.
  const boom = db.withDbTransaction(async () => { throw new Error('write failed'); });
  let rejected = false;
  await boom.catch(() => { rejected = true; });
  await db.withDbTransaction(async () => { log.push('after'); });
  check('a failed transaction rejects its own caller', rejected);
  check('a failed transaction does not wedge the queue', log.includes('after'), log.join(','));
}
{
  const log = [];
  setConn(makeConn(log));
  // withDbLock shares the queue: a raw statement run cannot land inside someone's transaction.
  const txn = db.withDbTransaction(async () => { log.push('txn'); await sleep(30); });
  await sleep(5);
  const lock = db.withDbLock(async () => { log.push('lock'); return 7; });
  const [, v] = await Promise.all([txn, lock]);
  check('withDbLock shares the transaction queue',
    log.indexOf('txn') < log.indexOf('lock') && log.indexOf('COMMIT') < log.indexOf('lock'),
    log.join(','));
  check('withDbLock returns its task result', v === 7);
}

/* -------------------------------------------------------- classifyDbError ---- */

console.log('classifyDbError');
const cases = [
  // wa-sqlite AccessHandlePoolVFS #acquireAccessHandles / addCapacity
  ['locked', new DOMException(
    "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle",
    'NoModificationAllowedError')],
  ['locked', new Error('NoModificationAllowedError: access handle')],
  // expo-sqlite/web/worker.ts maybeInitAsync, after the first VFS failure poisons the worker
  ['poisoned', new Error('Invalid VFS state')],
  ['poisoned', new Error('Failed to initialize AccessHandlePoolVFS')],
  // expo-sqlite SQLiteDatabase.withTransactionAsync
  ['busy', new Error('cannot start a transaction within a transaction')],
  ['busy', new Error('Call to function \'NativeStatement.runAsync\' has been rejected: database is locked')],
  // OPFS quota, and the pool running out of files (AccessHandlePoolVFS jOpen -> SQLITE_CANTOPEN)
  ['full', new DOMException('The quota has been exceeded.', 'QuotaExceededError')],
  ['full', new Error('unable to open database file')],
  ['full', new Error('disk I/O error')],
  // the account-scope guards in scan-history.tsx / screening-repo.ts / lesion-repo.ts
  ['signed-out', new Error('Cannot save screening history while signed out')],
  ['signed-out', new Error('A screening must belong to an authenticated account')],
  ['signed-out', new Error('Screening and lesion must belong to the same authenticated account')],
  ['unknown', new Error('tps: confidence out of range')],
];
for (const [want, err] of cases) {
  const got = db.classifyDbError(err);
  check(`${want.padEnd(10)} <- ${String(err.message).slice(0, 52)}`, got === want, `got ${got}`);
}
// The lock classifier must survive a non-Error rejection - some runtimes reject with a plain
// DOMException-shaped object, which used to stringify to [object Object] and classify as unknown.
check('plain object rejection is still classified',
  db.classifyDbError({ name: 'NoModificationAllowedError', message: 'x' }) === 'locked');
check('a wrapped cause is searched too',
  db.classifyDbError(new Error('image copy failed', { cause: new Error('QuotaExceededError') })) === 'full');

/* -------------------------------------------------- no stray transactions ---- */

console.log('call-site guard');
{
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.tsx?$/.test(f));
  const stray = [];
  for (const f of files) {
    if (f === 'src/data/db.ts') continue; // the one legitimate home of withTransactionAsync
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('.withTransactionAsync(')) return;
      // A callback already running inside withDbLock holds the queue; calling withDbTransaction
      // there would deadlock, so those sites opt out explicitly.
      const preceding = lines.slice(Math.max(0, i - 3), i).join('\n');
      if (preceding.includes('serialized-by-withDbLock')) return;
      stray.push(`${f}:${i + 1}`);
    });
  }
  check('no transaction bypasses the queue', stray.length === 0, stray.join(', '));
}

console.log(failures === 0 ? '\nAll db guard tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);

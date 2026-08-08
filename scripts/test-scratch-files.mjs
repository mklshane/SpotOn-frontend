/**
 * Regression test for scratch photo cleanup (src/lib/scratch-files.ts).
 *
 * This module deletes files, so the property that matters is not "does it reclaim space" — it is
 * **what it refuses to touch**. Screening photos live under documentDirectory/screenings/, and a
 * deletion there is unrecoverable user data: the whole scan history for a lesion, gone. Every
 * containment case below exists because some plausible edit would breach it, most sharply the
 * Android one — documentDirectory there has no `Documents/` segment, so a tmp derivation by naive
 * string replace returns documentDirectory itself and the sweep eats the user's history.
 *
 * Also pinned: the /private/var spelling. iOS symlinks /var to /private/var, and VisionCamera
 * reports the resolved path while expo-file-system reports the symlinked one. Miss that and every
 * raw sensor still (the single biggest file we produce) silently fails its containment check and
 * leaks forever — the exact bug this module was written to fix.
 *
 * Compiles the real module with the project's own tsc (never a retyped copy), swapping only the
 * expo-file-system import for a stub with a scriptable in-memory filesystem.
 *
 * Run:  npm run test:scratch
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'scratch-files-'));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/scratch-files.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019,dom', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);

// The one dependency is expo-file-system/legacy, which cannot load outside a native runtime.
// Point the compiled import at a stub backed by a scriptable directory tree.
writeFileSync(
  join(out, 'fs-stub.js'),
  `export let documentDirectory = '';
export let cacheDirectory = '';
export let tree = {};
export const deleted = [];

export function reset(doc, cache, t = {}) {
  documentDirectory = doc;
  cacheDirectory = cache;
  tree = t;
  deleted.length = 0;
}

export async function deleteAsync(uri) {
  deleted.push(uri);
  for (const dir of Object.keys(tree)) {
    if (uri.startsWith(dir)) delete tree[dir][uri.slice(dir.length)];
  }
}

export async function readDirectoryAsync(dir) {
  if (!(dir in tree)) throw new Error('ENOENT: ' + dir);
  return Object.keys(tree[dir]);
}

export async function getInfoAsync(uri) {
  for (const dir of Object.keys(tree)) {
    const name = uri.startsWith(dir) ? uri.slice(dir.length) : null;
    if (name && tree[dir][name]) {
      const e = tree[dir][name];
      return { exists: true, uri, size: e.size ?? 1, isDirectory: !!e.dir, modificationTime: e.mtime ?? 0 };
    }
  }
  return { exists: false, uri, isDirectory: false };
}
`,
);
const js = join(out, 'scratch-files.js');
const compiled = readFileSync(js, 'utf8');
if (!compiled.includes('expo-file-system/legacy')) {
  console.error('FATAL: compiled scratch-files.js no longer imports expo-file-system/legacy — the');
  console.error('stub swap below is stale and the test would silently exercise nothing.');
  process.exit(1);
}
writeFileSync(js, compiled.replace(/["']expo-file-system\/legacy["']/, "'./fs-stub.js'"));

const { discardScratch, sweepScratchFiles } = await import(pathToFileURL(js).href);
const stub = await import(pathToFileURL(join(out, 'fs-stub.js')).href);

let passed = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push(`${name}\n      expected: ${e}\n      actual:   ${a}`);
    console.log(`  FAIL ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const APP = 'file:///var/mobile/Containers/Data/Application/AAAAAAAA-1111';
const DOCS = `${APP}/Documents/`;
const CACHE = `${APP}/Library/Caches/`;
const TMP = `${APP}/tmp/`;
const ANDROID_DOCS = 'file:///data/user/0/com.mklshane.SpotOn/files/';
const ANDROID_CACHE = 'file:///data/user/0/com.mklshane.SpotOn/cache/';

const NOW = Date.now() / 1000;
const HOUR = 3600;

// ------------------------------------------------------- discardScratch: what it removes
stub.reset(DOCS, CACHE);
await discardScratch(`${TMP}FA1B-photo.jpeg`);
eq('a VisionCamera still in tmp/ is removed', stub.deleted, [`${TMP}FA1B-photo.jpeg`]);

stub.reset(DOCS, CACHE);
await discardScratch(`${CACHE}ImageManipulator/upright.jpg`);
eq('an ImageManipulator temp is removed', stub.deleted, [`${CACHE}ImageManipulator/upright.jpg`]);

stub.reset(DOCS, CACHE);
await discardScratch(`${CACHE}ImagePicker/pick.jpg`);
eq("an ImagePicker copy is removed (it is not the library original)", stub.deleted, [`${CACHE}ImagePicker/pick.jpg`]);

// iOS resolves /var through its /private symlink; VisionCamera hands us the resolved spelling.
stub.reset(DOCS, CACHE);
await discardScratch(`file:///private/var/mobile/Containers/Data/Application/AAAAAAAA-1111/tmp/x.jpeg`);
eq('a /private/var still is recognised and removed', stub.deleted, [`${TMP}x.jpeg`]);

stub.reset(DOCS, CACHE);
await discardScratch(`/var/mobile/Containers/Data/Application/AAAAAAAA-1111/tmp/bare.jpeg`);
eq('a bare path with no file:// scheme is removed', stub.deleted, [`${TMP}bare.jpeg`]);

stub.reset(DOCS, CACHE);
await discardScratch(`${TMP}a.jpg`, null, undefined, `${CACHE}b.jpg`);
eq('variadic call skips null/undefined and removes the rest', stub.deleted, [`${TMP}a.jpg`, `${CACHE}b.jpg`]);

// ------------------------------------- THE CONTAINMENT PROPERTY: what it must never remove
stub.reset(DOCS, CACHE);
await discardScratch(`${DOCS}screenings/scan-1.jpg`);
eq('a PERSISTED SCREENING is never removed', stub.deleted, []);

stub.reset(DOCS, CACHE);
await discardScratch(`${DOCS}SQLite/spoton.db`);
eq('the history database is never removed', stub.deleted, []);

stub.reset(DOCS, CACHE);
await discardScratch('ph://ABCD-1234/L0/001', 'https://example.com/a.jpg', 'asset:///lesion.jpg', 'screenings/scan-1.jpg');
eq('photo-library, remote, bundled and relative URIs are all ignored', stub.deleted, []);

stub.reset(DOCS, CACHE);
await discardScratch('file:///var/mobile/Containers/Data/Application/BBBBBBBB-2222/tmp/x.jpg');
eq('a scratch path in a FOREIGN container is not ours to remove', stub.deleted, []);

// Android's documentDirectory has no `Documents/` segment. A naive replace would derive
// documentDirectory itself as "tmp" and authorise deleting the entire scan history.
stub.reset(ANDROID_DOCS, ANDROID_CACHE);
await discardScratch(`${ANDROID_DOCS}screenings/scan-1.jpg`);
eq('ANDROID: a failed tmp derivation cannot alias documentDirectory', stub.deleted, []);

stub.reset(ANDROID_DOCS, ANDROID_CACHE);
await discardScratch(`${ANDROID_CACHE}ImageManipulator/upright.jpg`);
eq('ANDROID: the cache root still sweeps normally', stub.deleted, [`${ANDROID_CACHE}ImageManipulator/upright.jpg`]);

// A missing documentDirectory (web/SSR) must degrade to "delete nothing", not "delete anything".
stub.reset(null, null);
await discardScratch(`${TMP}x.jpg`, `${DOCS}screenings/scan-1.jpg`);
eq('no directories configured means no deletions at all', stub.deleted, []);

// ------------------------------------------------------------------ sweepScratchFiles
const staleTree = () => ({
  [CACHE]: {
    'loose-stale.jpg': { size: 1_000_000, mtime: NOW - 48 * HOUR },
    'loose-fresh.jpg': { size: 1_000_000, mtime: NOW - 1 * HOUR },
    'spoton_classifier_D7_float32.tflite': { size: 30_000_000, mtime: NOW - 48 * HOUR },
    ImageManipulator: { dir: true, mtime: NOW - 48 * HOUR },
  },
  [TMP]: { 'still.jpeg': { size: 4_000_000, mtime: NOW - 48 * HOUR } },
  [`${CACHE}ImageManipulator/`]: {
    'crop-stale.jpg': { size: 800_000, mtime: NOW - 48 * HOUR },
    'crop-fresh.jpg': { size: 800_000, mtime: NOW - 1 * HOUR },
  },
  // ImagePicker/ deliberately absent — a fresh install has never created it.
});

stub.reset(DOCS, CACHE, staleTree());
const freed = await sweepScratchFiles();
eq('sweep removes only the stale files', stub.deleted.sort(), [
  `${CACHE}ImageManipulator/crop-stale.jpg`,
  `${CACHE}loose-stale.jpg`,
  `${TMP}still.jpeg`,
].sort());
eq('sweep reports the bytes it reclaimed', freed, 1_000_000 + 4_000_000 + 800_000);

stub.reset(DOCS, CACHE, staleTree());
await sweepScratchFiles();
eq(
  'sweep keeps the dev-mode .tflite download regardless of age',
  stub.deleted.includes(`${CACHE}spoton_classifier_D7_float32.tflite`),
  false,
);
eq(
  'sweep never unlinks a subdirectory itself',
  stub.deleted.includes(`${CACHE}ImageManipulator`),
  false,
);

// The age floor is what keeps the sweep off a capture that is still in flight.
stub.reset(DOCS, CACHE, staleTree());
await sweepScratchFiles({ maxAgeMs: 72 * HOUR * 1000 });
eq('a longer max age spares everything', stub.deleted, []);

// A directory that has never been created makes readDirectoryAsync throw. That must skip the one
// directory, not abandon the sweep — pinned with the FIRST root missing, so an uncaught throw
// would cost every later directory too.
stub.reset(DOCS, CACHE, {
  [TMP]: { 'still.jpeg': { size: 4_000_000, mtime: NOW - 48 * HOUR } },
  [`${CACHE}ImageManipulator/`]: { 'crop-stale.jpg': { size: 800_000, mtime: NOW - 48 * HOUR } },
});
await sweepScratchFiles();
eq('an unreadable directory skips itself, not the rest of the sweep', stub.deleted.sort(), [
  `${CACHE}ImageManipulator/crop-stale.jpg`,
  `${TMP}still.jpeg`,
].sort());

// documentDirectory is never even enumerated, whatever it contains.
stub.reset(DOCS, CACHE, {
  ...staleTree(),
  [DOCS]: { 'ancient.jpg': { size: 999, mtime: 0 } },
  [`${DOCS}screenings/`]: { 'scan-1.jpg': { size: 400_000, mtime: 0 } },
});
await sweepScratchFiles();
eq(
  'sweep never touches documentDirectory, however stale its contents',
  stub.deleted.some((u) => u.startsWith(DOCS)),
  false,
);

// ---------------------------------------------------------------------------- report
console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ ${passed} passed`);

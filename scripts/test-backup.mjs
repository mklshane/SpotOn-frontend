/**
 * Regression tests for back up / restore (src/lib/backup/core.ts).
 *
 * A backup is the only copy of a user's history once the app is gone, so the failure modes are
 * all silent and all permanent: a photo path that restores pointing nowhere, rows that land under
 * the wrong account, another account's screenings leaking into a file, a restored scan re-entering
 * the research upload queue. These pin each of those against the REAL schema (parsed out of
 * db.ts, never retyped) in an in-process SQLite, mirroring what backup.ts does on a device.
 *
 * Compiles the real module with the project's own tsc, like test-research-core.mjs. The output
 * goes under node_modules/.cache so its @noble / fflate imports resolve. The app encrypts with
 * expo-crypto's native AES-GCM; here Node's WebCrypto stands in for it (same algorithm, same
 * nonce/tag/AAD layout), so a file sealed by either opens with the other.
 *
 * Run:  npm run test:backup
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = join(ROOT, 'node_modules/.cache/test-backup');
mkdirSync(out, { recursive: true });
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/backup/core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022',
    '--lib', 'es2022,dom', '--moduleResolution', 'bundler', '--skipLibCheck'],
  { cwd: ROOT, stdio: 'inherit' },
);
const B = await import(pathToFileURL(join(out, 'core.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}
async function rejects(promiseOrFn, code) {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    return 'resolved';
  } catch (e) {
    return e?.code === code ? true : `${e?.code ?? e}`;
  }
}

// ---------------------------------------------------------------- real schema
const dbSrc = readFileSync(join(ROOT, 'src/data/db.ts'), 'utf8');
const start = dbSrc.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
const SCHEMA = dbSrc.slice(start, dbSrc.indexOf('`;', start));
const SCHEMA_VERSION = Number(/const SCHEMA_VERSION = (\d+)/.exec(dbSrc)[1]);

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}
const columns = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));

// ---------------------------------------------------------------- fixtures
const ALICE = 'user-alice';
const BOB = 'user-bob';
const random = (n) => new Uint8Array(randomBytes(n));
const gcm = (op) => async (key, nonce, data, aad) => {
  const k = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, [op]);
  return new Uint8Array(await webcrypto.subtle[op]({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, k, data));
};
const cipher = { random, encrypt: gcm('encrypt'), decrypt: gcm('decrypt') };

function screening(id, userId, extra = {}) {
  return {
    id, created_at: '2026-10-01T00:00:00Z', image_uri: `screenings/${userId}/${id}.jpg`, source: 'camera',
    answers_json: '{}', probs_json: '{}', top_class: 'BENIGN', top_confidence: 0.9, attempt: 1,
    model_version: 'm', input_size: 224, normalization: 'n', inference_ms: 5, class_weight: 1, cs: 0.1,
    symptom_score_raw: 0, symptom_score: 0, tps: 0.1, tier: 'low', safety_floor_applied: 0,
    confidence_qualifier: 0, user_id: userId, lesion_id: 'les-1',
    images_json: JSON.stringify([
      { uri: `screenings/${userId}/${id}.jpg`, index: 0 },
      { uri: `file:///var/old-container/Documents/screenings/${userId}/${id}-1.jpg`, index: 1 },
    ]),
    research_status: 'sent', research_shared_at: '2026-10-02T00:00:00Z', research_attempts: 1,
    ...extra,
  };
}
function insert(db, table, row) {
  const { sql, params } = B.insertStatement(table, row);
  return db.prepare(sql).run(...params);
}

const src = freshDb();
insert(src, 'lesions', { id: 'les-1', created_at: 'x', updated_at: 'x', label: 'Left arm', user_id: ALICE, screening_count: 2 });
insert(src, 'screenings', screening('scan-1', ALICE));
insert(src, 'screenings', screening('scan-2', ALICE, { followup_of: 'scan-1' }));
insert(src, 'screenings', screening('scan-bob', BOB, { lesion_id: null }));
insert(src, 'saved_items', { user_id: ALICE, kind: 'doctor', item_id: 'd1', name: 'Dr A', saved_at: 'x' });
insert(src, 'saved_items', { user_id: BOB, kind: 'doctor', item_id: 'd2', name: 'Dr B', saved_at: 'x' });

/** What buildBackup() does, against node:sqlite. */
function exportFor(db, userId, schemaVersion = SCHEMA_VERSION) {
  const screenings = db.prepare('SELECT * FROM screenings WHERE user_id = ?').all(userId);
  const lesions = db.prepare('SELECT * FROM lesions WHERE user_id = ?').all(userId);
  const savedItems = db.prepare('SELECT * FROM saved_items WHERE user_id = ?').all(userId);
  const photos = new Map();
  for (const [name] of B.photosToBackUp(screenings)) photos.set(name, random(2048 + name.length));
  return {
    manifest: {
      format: B.BACKUP_FORMAT, schemaVersion, appVersion: '1.0.0', exportedAt: 'x',
      sourceAccountId: userId, sourceEmail: 'a@x', counts: {},
    },
    data: { screenings, lesions, savedItems, prefs: { product_tour_status: 'done', research_prompt_version: '9' } },
    photos,
  };
}

/** What restoreBackup() does, against node:sqlite. Returns the photo files it would write. */
function restoreInto(db, contents, userId) {
  const ids = (t) => new Set(db.prepare(`SELECT id FROM ${t}`).all().map((r) => r.id));
  const plan = B.planRestore(
    contents, userId,
    { screenings: columns(db, 'screenings'), lesions: columns(db, 'lesions'), saved_items: columns(db, 'saved_items') },
    { screeningIds: ids('screenings'), lesionIds: ids('lesions') },
  );
  db.exec('BEGIN');
  for (const r of plan.lesions) insert(db, 'lesions', r);
  for (const r of plan.screenings) insert(db, 'screenings', r);
  for (const r of plan.savedItems) insert(db, 'saved_items', r);
  db.exec('COMMIT');
  return plan;
}

// ---------------------------------------------------------------- 1. export scope
const aliceBackup = exportFor(src, ALICE);
check('export holds only the account\'s screenings', aliceBackup.data.screenings.every((r) => r.user_id === ALICE) && aliceBackup.data.screenings.length === 2);
check('export holds only the account\'s saved items', aliceBackup.data.savedItems.length === 1);
check('photos found for image_uri and images_json (incl. stale absolute path)',
  [...aliceBackup.photos.keys()].sort().join() === 'scan-1-1.jpg,scan-1.jpg,scan-2-1.jpg,scan-2.jpg',
  [...aliceBackup.photos.keys()].join());

// ---------------------------------------------------------------- 2. photo name guard
check('photoFileName: relative scoped', B.photoFileName('screenings/u/a.jpg') === 'a.jpg');
check('photoFileName: legacy flat', B.photoFileName('screenings/a.jpg') === 'a.jpg');
check('photoFileName: foreign cache path', B.photoFileName('file:///cache/ImagePicker/a.jpg') === null);
check('photoFileName: traversal', B.photoFileName('screenings/u/..') === null && B.photoFileName('screenings/../../x') === null);

// ---------------------------------------------------------------- 3. seal / open round trip
const archive = B.packArchive(aliceBackup);
const sealed = await B.seal(archive, 'correct horse', cipher);
const opened = await B.open(sealed, 'correct horse', cipher);
const back = B.unpackArchive(opened, SCHEMA_VERSION);
check('round trip: rows identical', JSON.stringify(back.data.screenings) === JSON.stringify(aliceBackup.data.screenings));
check('round trip: photo bytes identical',
  [...aliceBackup.photos].every(([n, b]) => Buffer.compare(Buffer.from(back.photos.get(n) ?? []), Buffer.from(b)) === 0));
check('ciphertext does not contain plaintext rows', !Buffer.from(sealed).includes(Buffer.from('Left arm')));

check('wrong password', (await rejects(B.open(sealed, 'wrong horse', cipher), 'wrong_password')) === true);
const flipped = sealed.slice();
flipped[flipped.length - 40] ^= 1;
check('tampered ciphertext is refused', (await rejects(B.open(flipped, 'correct horse', cipher), 'wrong_password')) === true);
const headerEdit = sealed.slice();
headerEdit[20] ^= 1;
const headerRes = await rejects(B.open(headerEdit, 'correct horse', cipher), 'bad_file');
check('tampered header is refused', headerRes === true || headerRes === 'wrong_password', String(headerRes));
check('non-backup file', (await rejects(B.open(new TextEncoder().encode('%PDF-1.4 hello'), 'x', cipher), 'bad_file')) === true);
check('newer schema refused',
  (await rejects(() => B.unpackArchive(B.packArchive({ ...aliceBackup, manifest: { ...aliceBackup.manifest, schemaVersion: SCHEMA_VERSION + 1 } }), SCHEMA_VERSION), 'newer_version')) === true);
const truncated = archive.subarray(0, archive.length - 10);
check('truncated photo data refused', (await rejects(() => B.unpackArchive(truncated, SCHEMA_VERSION), 'bad_file')) === true);
check('garbage archive refused', (await rejects(() => B.unpackArchive(random(64), SCHEMA_VERSION), 'bad_file')) === true);
check('newer format refused',
  (await rejects(() => B.unpackArchive(B.packArchive({ ...aliceBackup, manifest: { ...aliceBackup.manifest, format: 99 } }), SCHEMA_VERSION), 'newer_version')) === true);

// ---------------------------------------------------------------- 4. restore into a new account
const phone = freshDb();
const plan = restoreInto(phone, back, BOB);
const rows = phone.prepare('SELECT * FROM screenings ORDER BY id').all();
check('restore: all screenings added', rows.length === 2 && plan.screenings.length === 2);
check('restore: re-owned to target account', rows.every((r) => r.user_id === BOB));
check('restore: lesion re-owned', phone.prepare('SELECT user_id FROM lesions').get().user_id === BOB);
check('restore: saved item re-owned', phone.prepare('SELECT user_id FROM saved_items').get().user_id === BOB);
check('restore: image_uri points at target folder', rows.every((r) => r.image_uri === `screenings/${BOB}/${r.id}.jpg`), rows[0].image_uri);
const imgs = JSON.parse(rows[0].images_json);
check('restore: images_json re-pointed (stale absolute path too)',
  imgs.every((i) => i.uri.startsWith(`screenings/${BOB}/`)) && imgs[1].index === 1, rows[0].images_json);
check('restore: one photo write per referenced file', plan.photos.size === 4);
check('restore: research state cleared',
  rows.every((r) => r.research_status === null && r.research_shared_at === null && r.research_attempts === 0));
check('restore: links kept', rows.find((r) => r.id === 'scan-2').followup_of === 'scan-1' && rows[0].lesion_id === 'les-1');
check('restore: only whitelisted prefs', plan.prefs.length === 1 && plan.prefs[0][0] === 'product_tour_status');
const savedExtras = { ...back, data: { ...back.data, savedItems: back.data.savedItems.map((r) => ({ ...r, evil: 1 })) } };
check('restore: unknown columns dropped', !('evil' in B.planRestore(savedExtras, BOB,
  { screenings: columns(phone, 'screenings'), lesions: columns(phone, 'lesions'), saved_items: columns(phone, 'saved_items') },
  { screeningIds: new Set(), lesionIds: new Set() }).savedItems[0]));

// ---------------------------------------------------------------- 5. restoring twice is harmless
const again = restoreInto(phone, back, BOB);
check('restore twice: no duplicates', phone.prepare('SELECT COUNT(*) n FROM screenings').get().n === 2);
check('restore twice: reported as skipped', again.skipped.screenings === 2 && again.skipped.lesions === 1);
check('restore twice: no photo overwrites', again.photos.size === 0);

// ---------------------------------------------------------------- 6. older backup (v19: no research columns)
const old = exportFor(src, ALICE, 19);
for (const r of old.data.screenings) {
  delete r.research_status;
  delete r.research_shared_at;
  delete r.research_attempts;
}
const oldPhone = freshDb();
restoreInto(oldPhone, B.unpackArchive(B.packArchive(old), SCHEMA_VERSION), ALICE);
const oldRows = oldPhone.prepare('SELECT research_attempts, research_status FROM screenings').all();
check('older backup imports with defaults', oldRows.length === 2 && oldRows.every((r) => r.research_attempts === 0));

// ---------------------------------------------------------------- 7. hostile values
check('insertStatement: non-scalar becomes NULL',
  JSON.stringify(B.insertStatement('t', { a: { x: 1 }, b: true, c: 'ok', d: Infinity }).params) === '[null,1,"ok",null]');

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);

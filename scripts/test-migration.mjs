/**
 * Migration harness for src/data/db.ts.
 *
 * The migrate() loop is NOT transactional and tolerates only the literal string "duplicate column",
 * so a database killed mid-upgrade has to recover on the next open. That property is invisible to
 * tsc and painful to discover in the field — a user whose upgrade was interrupted gets a database
 * that never converges. This replays the REAL SCHEMA / MIGRATION_V* strings (parsed out of db.ts,
 * never retyped) against an in-process SQLite and asserts:
 *
 *   1. a fresh install produces the full schema
 *   2. every prior user_version upgrades cleanly, with all rows linked and no orphans
 *   3. re-opening an already-migrated database is a no-op (idempotent replay)
 *   4. a kill at ANY statement boundary still converges on the next open
 *   5. the upgraded schema is column-for-column identical to a fresh install
 *
 * Run: npm run test:migration
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// argv[2] overrides the source under test, so the harness itself can be exercised against a
// deliberately broken copy of db.ts (see the self-check note at the bottom of this file).
const DB_TS =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'db.ts');
const src = readFileSync(DB_TS, 'utf8');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- parse db.ts
/**
 * Read `const NAME = <template literal | array literal>;` out of the source.
 * `scope` supplies constants the literal references — MIGRATION_V4 is defined in terms of SCHEMA.
 */
function grab(name, scope = {}) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const open = src[from];
  let i = from + 1;
  if (open === '`') {
    while (src[i] !== '`' || src[i - 1] === '\\') i++;
  } else if (open === '[') {
    let depth = 1;
    while (depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        const q = c;
        i++;
        while (src[i] !== q || src[i - 1] === '\\') i++;
      } else if (c === '[') depth++;
      else if (c === ']') depth--;
      i++;
    }
    i--;
  } else {
    return null;
  }
  const keys = Object.keys(scope);
  return new Function(...keys, `return ${src.slice(from, i + 1)};`)(...keys.map((k) => scope[k]));
}

const SCHEMA = grab('SCHEMA');
const SCHEMA_VERSION = Number(/const SCHEMA_VERSION = (\d+)/.exec(src)[1]);
const MIGRATIONS = [];
for (let v = 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v] = grab(`MIGRATION_V${v}`, { SCHEMA }) ?? [];

/** The statement list getDb() + migrate() apply, in order, for a database at `fromVersion`. */
function plan(fromVersion) {
  const out = splitStatements(SCHEMA);
  for (let v = 1; v <= SCHEMA_VERSION; v++) {
    if (fromVersion < v) for (const stmt of MIGRATIONS[v]) out.push(...splitStatements(stmt));
  }
  return out;
}

/** execAsync accepts multi-statement strings; split so a "kill" can land at any boundary. */
function splitStatements(sql) {
  return sql
    .split(/;\s*(?=(?:--|CREATE|ALTER|INSERT|UPDATE|PRAGMA|DROP)\b)/)
    .map((s) => s.trim().replace(/;$/, ''))
    .filter(Boolean);
}

/** Apply statements the way migrate() does: individually, tolerating only "duplicate column". */
function apply(db, stmts, limit = Infinity) {
  let applied = 0;
  for (const stmt of stmts.slice(0, limit)) {
    try {
      db.exec(stmt);
      applied++;
    } catch (e) {
      if (!String(e).includes('duplicate column')) throw new Error(`${e}\n  in: ${stmt.slice(0, 120)}`);
    }
  }
  return applied;
}

// ---------------------------------------------------------------- fixtures
/** A pre-V10 database: the screenings table as it stood at v9, with three rows. */
const V9_SCREENINGS = `
CREATE TABLE screenings (
  id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL,
  mark_x REAL, mark_y REAL, mark_z REAL, mark_region TEXT, mark_view TEXT,
  image_uri TEXT NOT NULL, source TEXT NOT NULL, answers_json TEXT NOT NULL,
  probs_json TEXT NOT NULL, top_class TEXT NOT NULL, top_confidence REAL NOT NULL,
  attempt INTEGER NOT NULL, model_version TEXT NOT NULL, input_size INTEGER NOT NULL,
  normalization TEXT NOT NULL, temperature REAL NOT NULL DEFAULT 1.0, inference_ms INTEGER NOT NULL,
  first_attempt_json TEXT, class_weight REAL NOT NULL, cs REAL NOT NULL,
  symptom_score_raw REAL NOT NULL, symptom_score REAL NOT NULL, tps REAL NOT NULL, tier TEXT NOT NULL,
  safety_floor_applied INTEGER NOT NULL, confidence_qualifier INTEGER NOT NULL,
  malignant_score REAL NOT NULL DEFAULT 0, malignant_gate_applied INTEGER NOT NULL DEFAULT 0,
  scale_unstable INTEGER NOT NULL DEFAULT 0, classifier_refined INTEGER NOT NULL DEFAULT 0,
  detector_used INTEGER NOT NULL DEFAULT 0);
INSERT INTO screenings VALUES
 ('scan-1','2026-03-01T00:00:00Z',0.1,0.2,0.3,'Left forearm','front','f://a.jpg','camera','{}','{}','BENIGN',0.8,1,'D7',260,'imagenet',1.0,900,NULL,0,0,0,0,0.0,'low',0,0,0.1,0,0,0,1),
 ('scan-2','2026-05-01T00:00:00Z',NULL,NULL,NULL,NULL,NULL,'f://b.jpg','gallery','{}','{}','MEL',0.7,1,'D7',260,'imagenet',1.0,900,NULL,5,3.5,2,0.55,4.05,'high',0,0,0.8,1,0,0,1),
 ('scan-3','2026-07-01T00:00:00Z',0.4,0.5,0.6,'Back','back','f://c.jpg','camera','{}','{}','BCC',0.6,2,'D7',260,'imagenet',1.0,900,NULL,3,1.8,1,0.27,2.07,'moderate',1,1,0.6,1,0,0,0);
`;
const SEEDED_SCREENINGS = 3;
/**
 * The schema version `V9_SCREENINGS` actually represents. Upgrade paths are only tested from
 * versions at or below this — claiming a higher starting version would skip the very migrations
 * this fixture still needs, and "test" a state that cannot exist in the field.
 * Bump this (and the DDL above) only when adding a fixture for a later version.
 */
const FIXTURE_VERSION = 9;

function v9Database() {
  const db = new DatabaseSync(':memory:');
  db.exec(V9_SCREENINGS);
  return db;
}

const count = (db, sql) => db.prepare(sql).get()?.n ?? 0;
const columns = (db, table) =>
  db
    .prepare(`SELECT name, type FROM pragma_table_info(?) ORDER BY name`)
    .all(table)
    .map((r) => `${r.name}:${r.type}`)
    .join(',');

/** Every screening linked, every link resolving to a real lesion row. */
function assertLinked(db, label, expectedScreenings = SEEDED_SCREENINGS) {
  const screenings = count(db, 'SELECT COUNT(*) AS n FROM screenings');
  const lesions = count(db, 'SELECT COUNT(*) AS n FROM lesions');
  const unlinked = count(db, 'SELECT COUNT(*) AS n FROM screenings WHERE lesion_id IS NULL');
  const orphans = count(
    db,
    'SELECT COUNT(*) AS n FROM screenings s LEFT JOIN lesions l ON l.id = s.lesion_id WHERE l.id IS NULL',
  );
  check(`${label}: screenings preserved`, screenings === expectedScreenings, `got ${screenings}`);
  check(`${label}: one lesion per screening`, lesions === expectedScreenings, `got ${lesions}`);
  check(`${label}: no unlinked screenings`, unlinked === 0, `got ${unlinked}`);
  check(`${label}: no orphaned lesion_id`, orphans === 0, `got ${orphans}`);
}

// ---------------------------------------------------------------- tests
console.log(`db.ts SCHEMA_VERSION = ${SCHEMA_VERSION}\n`);

// 0) MIGRATION_V4 slices SCHEMA at the first occurrence of its marker text. Any earlier occurrence
// — including inside a comment — silently truncates the replayed statement for v<4 upgrades.
{
  const MARKER = 'CREATE TABLE IF NOT EXISTS screenings';
  const first = SCHEMA.indexOf(MARKER);
  check('MIGRATION_V4 marker appears exactly once in SCHEMA', first === SCHEMA.lastIndexOf(MARKER));
  check(
    'MIGRATION_V4 starts at the screenings CREATE TABLE',
    (MIGRATIONS[4]?.[0] ?? '').trimStart().startsWith(MARKER),
  );
  check('lesions table is defined above the screenings block', SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS lesions') < first);
}

// 1) fresh install
const fresh = new DatabaseSync(':memory:');
apply(fresh, plan(0));
const freshTables = fresh
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);
for (const t of ['facilities', 'doctors', 'booking_links', 'telemedicine_platforms', 'sync_meta', 'screenings', 'lesions']) {
  check(`fresh install creates ${t}`, freshTables.includes(t));
}
const freshScreeningCols = columns(fresh, 'screenings');
const freshLesionCols = columns(fresh, 'lesions');
for (const c of ['lesion_id', 'user_id', 'followup_of', 'answers_carried', 'answers_source_id']) {
  check(`fresh install: screenings.${c}`, freshScreeningCols.includes(`${c}:`));
}

// 2) upgrade from every prior version
for (let from = 4; from <= FIXTURE_VERSION; from++) {
  const db = v9Database();
  apply(db, plan(from));
  assertLinked(db, `upgrade v${from}→v${SCHEMA_VERSION}`);
  check(
    `upgrade v${from}: schema matches fresh install`,
    columns(db, 'screenings') === freshScreeningCols && columns(db, 'lesions') === freshLesionCols,
  );
  db.close();
}

// 3) idempotent replay — opening an already-migrated database changes nothing
{
  const db = v9Database();
  apply(db, plan(FIXTURE_VERSION));
  const before = db.prepare('SELECT id, lesion_id FROM screenings ORDER BY id').all();
  apply(db, plan(FIXTURE_VERSION)); // a second open before user_version is trusted
  apply(db, plan(SCHEMA_VERSION)); // and a normal post-upgrade open
  assertLinked(db, 'idempotent replay');
  const after = db.prepare('SELECT id, lesion_id FROM screenings ORDER BY id').all();
  check('idempotent replay: linkage unchanged', JSON.stringify(before) === JSON.stringify(after));
  db.close();
}

// 4) killed mid-upgrade at EVERY statement boundary, then reopened
{
  const stmts = plan(FIXTURE_VERSION);
  let recovered = 0;
  const broken = [];
  for (let cut = 1; cut <= stmts.length; cut++) {
    const db = v9Database();
    try {
      apply(db, stmts, cut); // interrupted upgrade — user_version never stamped
      apply(db, stmts); // next open replays from the same version
      const unlinked = count(db, 'SELECT COUNT(*) AS n FROM screenings WHERE lesion_id IS NULL');
      const lesions = count(db, 'SELECT COUNT(*) AS n FROM lesions');
      if (unlinked === 0 && lesions === SEEDED_SCREENINGS) recovered++;
      else broken.push(`cut=${cut} (lesions=${lesions}, unlinked=${unlinked})`);
    } catch (e) {
      broken.push(`cut=${cut} threw ${String(e).slice(0, 80)}`);
    }
    db.close();
  }
  check(
    `kill-and-reopen converges at all ${stmts.length} statement boundaries`,
    broken.length === 0,
    broken.slice(0, 3).join('; '),
  );
  console.log(`  (${recovered}/${stmts.length} cut points recovered)`);
}

// 5) the backfill must never duplicate a lesion, however many times it replays
{
  const db = v9Database();
  for (let i = 0; i < 5; i++) apply(db, plan(FIXTURE_VERSION));
  check(
    'repeated backfill creates no duplicate lesions',
    count(db, 'SELECT COUNT(*) AS n FROM lesions') === SEEDED_SCREENINGS,
  );
  db.close();
}

console.log(`\nmigration: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);

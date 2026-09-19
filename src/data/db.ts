/**
 * Local SQLite database - the offline mirror of the directory.
 *
 * Arrays (services, specialties) and JSON (opening hours) are stored as TEXT;
 * booleans as INTEGER 0/1/NULL. The repositories parse these back on read.
 */
import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

import { DB_NAME } from "../config";
import { accountStorageKey } from "../lib/account-scope";
import { STORAGE_KEYS } from "../lib/storage-keys";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facilities (
  id              TEXT PRIMARY KEY NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  address         TEXT NOT NULL,
  city            TEXT NOT NULL,
  province        TEXT NOT NULL,
  region          TEXT,
  latitude        REAL NOT NULL,
  longitude       REAL NOT NULL,
  services        TEXT NOT NULL DEFAULT '[]',
  has_philhealth  INTEGER,
  fee_min         INTEGER,
  fee_max         INTEGER,
  status          TEXT,
  phone           TEXT,
  website         TEXT,
  booking_url     TEXT,
  facility_type   TEXT,
  google_maps_url TEXT,
  google_rating   REAL,
  weekday_hours   TEXT,
  weekend_hours   TEXT,
  description     TEXT,
  photo_url       TEXT,
  photo_attribution TEXT,
  department_info TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facilities_city ON facilities(city);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(type);
CREATE INDEX IF NOT EXISTS idx_facilities_status ON facilities(status);

CREATE TABLE IF NOT EXISTS doctors (
  id                  TEXT PRIMARY KEY NOT NULL,
  name                TEXT NOT NULL,
  title               TEXT,
  pds_certified       INTEGER,
  specialties         TEXT NOT NULL DEFAULT '[]',
  specialties_display TEXT,
  status              TEXT,
  city                TEXT,
  region              TEXT,
  phone               TEXT,
  website             TEXT,
  google_maps_url     TEXT,
  photo_url           TEXT,
  description         TEXT,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doctors_city ON doctors(city);

CREATE TABLE IF NOT EXISTS booking_links (
  id                 TEXT PRIMARY KEY NOT NULL,
  doctor_id          TEXT NOT NULL,
  platform_id        TEXT NOT NULL,
  url                TEXT NOT NULL,
  consultation_fee   INTEGER,
  rating             REAL,
  review_count       INTEGER,
  is_introductory_fee INTEGER NOT NULL,
  available_text     TEXT,
  is_active          INTEGER NOT NULL,
  last_verified      TEXT,
  next_available     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_booking_links_doctor ON booking_links(doctor_id);

-- Which facilities a doctor practises at. Server-side this is the doctor_facility
-- join table; it reaches /sync from migration 013 onward.
CREATE TABLE IF NOT EXISTS doctor_facility (
  id          TEXT PRIMARY KEY NOT NULL,
  doctor_id   TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  is_primary  INTEGER,
  schedule    TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_doctor_facility_doctor ON doctor_facility(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_facility_facility ON doctor_facility(facility_id);

CREATE TABLE IF NOT EXISTS telemedicine_platforms (
  id                 TEXT PRIMARY KEY NOT NULL,
  slug               TEXT NOT NULL,
  name               TEXT NOT NULL,
  website            TEXT NOT NULL,
  booking_url        TEXT,
  description        TEXT,
  is_dedicated_derma INTEGER NOT NULL,
  is_active          INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

-- Tracked lesions. MUST stay ABOVE the screenings block, and nothing above that block may repeat
-- the marker text MIGRATION_V4 searches for: v4 replays SCHEMA.slice(SCHEMA.indexOf(<marker>)),
-- and indexOf takes the FIRST match, so an earlier occurrence (even inside a comment) makes v4
-- replay a truncated statement. A table added *below* the block would instead be silently absorbed
-- into v4. Both are harmless in effect (IF NOT EXISTS, and execAsync(SCHEMA) runs unconditionally
-- before migrate) but confusing to inherit - see scripts/test-migration.mjs, which catches both.
CREATE TABLE IF NOT EXISTS lesions (
  id                TEXT PRIMARY KEY NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  label             TEXT,
  mark_x            REAL,
  mark_y            REAL,
  mark_z            REAL,
  mark_region       TEXT,
  mark_view         TEXT,
  mark_mesh         TEXT,
  screening_count   INTEGER NOT NULL DEFAULT 0,
  first_screened_at TEXT,
  last_screened_at  TEXT,
  last_screening_id TEXT,
  last_tier         TEXT,
  archived          INTEGER NOT NULL DEFAULT 0,
  user_id           TEXT
);
CREATE INDEX IF NOT EXISTS idx_lesions_updated  ON lesions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesions_archived ON lesions(archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS screenings (
  id                   TEXT PRIMARY KEY NOT NULL,
  created_at           TEXT NOT NULL,
  mark_x               REAL,
  mark_y               REAL,
  mark_z               REAL,
  mark_region          TEXT,
  mark_view            TEXT,
  mark_mesh            TEXT,
  image_uri            TEXT NOT NULL,
  source               TEXT NOT NULL,
  answers_json         TEXT NOT NULL,
  probs_json           TEXT NOT NULL,
  top_class            TEXT NOT NULL,
  top_confidence       REAL NOT NULL,
  attempt              INTEGER NOT NULL,
  model_version        TEXT NOT NULL,
  input_size           INTEGER NOT NULL,
  normalization        TEXT NOT NULL,
  temperature          REAL NOT NULL DEFAULT 1.0,
  inference_ms         INTEGER NOT NULL,
  first_attempt_json   TEXT,
  class_weight         REAL NOT NULL,
  cs                   REAL NOT NULL,
  symptom_score_raw    REAL NOT NULL,
  symptom_score        REAL NOT NULL,
  tps                  REAL NOT NULL,
  tier                 TEXT NOT NULL,
  safety_floor_applied INTEGER NOT NULL,
  confidence_qualifier INTEGER NOT NULL,
  malignant_score      REAL NOT NULL DEFAULT 0,
  malignant_gate_applied INTEGER NOT NULL DEFAULT 0,
  scale_unstable       INTEGER NOT NULL DEFAULT 0,
  classifier_refined   INTEGER NOT NULL DEFAULT 0,
  detector_used        INTEGER NOT NULL DEFAULT 0,
  lesion_id            TEXT,
  user_id              TEXT,
  followup_of          TEXT,
  answers_carried      INTEGER NOT NULL DEFAULT 0,
  answers_source_id    TEXT,
  images_json          TEXT,
  image_count          INTEGER NOT NULL DEFAULT 1,
  per_image_json       TEXT,
  image_disagreement   INTEGER NOT NULL DEFAULT 0,
  aggregate_method     TEXT NOT NULL DEFAULT 'single'
);
CREATE INDEX IF NOT EXISTS idx_screenings_created ON screenings(created_at DESC);
`;
// NOTE: idx_screenings_lesion is created by MIGRATION_V10, NOT here. On an upgrading database the
// CREATE TABLE above is a no-op (the table already exists without lesion_id), so indexing that
// column here would run before the ALTER that adds it and throw "no such column" - which migrate()
// does not tolerate. Any future index over a migration-added column belongs in its migration.

// Bump when adding ALTERs below. Fresh installs get the full SCHEMA and are
// stamped with the current version; existing databases replay the ALTERs.
const SCHEMA_VERSION = 16;

// version-2 columns (migration 011 server-side). Each statement is applied
// individually and "duplicate column" is tolerated, so a partially-migrated
// database (killed mid-upgrade) recovers on the next open.
const MIGRATION_V2 = [
  "ALTER TABLE facilities ADD COLUMN booking_url TEXT",
  "ALTER TABLE facilities ADD COLUMN facility_type TEXT",
  "ALTER TABLE facilities ADD COLUMN description TEXT",
  "ALTER TABLE facilities ADD COLUMN photo_url TEXT",
  "ALTER TABLE facilities ADD COLUMN photo_attribution TEXT",
  "ALTER TABLE doctors ADD COLUMN description TEXT",
  "ALTER TABLE booking_links ADD COLUMN next_available TEXT",
];

// v3 - hospital derm-department findings, rendered as "Name (Department)".
const MIGRATION_V3 = ["ALTER TABLE facilities ADD COLUMN department_info TEXT"];

// v4 - on-device screening records (questionnaire + classification + triage audit
// trail). The table lives in the base SCHEMA (CREATE IF NOT EXISTS is idempotent),
// so upgrading databases just need the statements replayed.
const MIGRATION_V4 = [
  SCHEMA.slice(SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS screenings")),
];

// v5 - record the confidence-calibration temperature per screening, so records made
// under different T values stay auditable (T scales the confidence that drives CS/TPS).
const MIGRATION_V5 = [
  "ALTER TABLE screenings ADD COLUMN temperature REAL NOT NULL DEFAULT 1.0",
];

// v6 - Malignant Gate: the summed MEL+SCC+BCC softmax mass and whether it floored the tier.
// Pre-v6 rows default to 0/0, which reads correctly as "gate did not run" (it shipped with D4).
const MIGRATION_V6 = [
  "ALTER TABLE screenings ADD COLUMN malignant_score REAL NOT NULL DEFAULT 0",
  "ALTER TABLE screenings ADD COLUMN malignant_gate_applied INTEGER NOT NULL DEFAULT 0",
];

// v7 - scale-consistency check: whether the predicted class survived re-cropping. Drives the
// rescan/floor path, so it belongs in the audit trail. Pre-v7 rows default to 0 ("not checked").
const MIGRATION_V7 = [
  "ALTER TABLE screenings ADD COLUMN scale_unstable INTEGER NOT NULL DEFAULT 0",
];

// v8 - confidence-gated zoom refinement: whether the result was re-classified on a lesion-centered
// crop. Belongs in the audit trail (it changes which pixels produced the answer). Pre-v8 rows
// default to 0 ("not refined").
const MIGRATION_V8 = [
  "ALTER TABLE screenings ADD COLUMN classifier_refined INTEGER NOT NULL DEFAULT 0",
];

// v9 - detector-canonical crop: whether the YOLO detector localized the lesion and the classifier
// ran on its crop (vs the full-frame fallback). Part of the audit trail; pre-v9 rows default to 0.
const MIGRATION_V9 = [
  "ALTER TABLE screenings ADD COLUMN detector_used INTEGER NOT NULL DEFAULT 0",
];

// v10 - lesion tracking. The `lesions` table itself is in the base SCHEMA above (execAsync(SCHEMA)
// runs unconditionally before migrate, so existing databases get it too); this adds the linkage
// columns and backfills one lesion per pre-existing screening.
//
// NOT backfilled by mark proximity, deliberately: the mark is where the user tapped a stylized
// mannequin, not a measurement, so clustering would merge two genuinely different moles on the same
// forearm - the exact error lesion tracking exists to prevent. One-lesion-per-screening reproduces
// today's semantics (history.tsx already renders one marker per screening), so it is not a regression.
//
// The backfill is REPLAYABLE: the lesion id is derived from the screening id and both statements are
// guarded on `lesion_id IS NULL`, so a database killed mid-upgrade recovers on the next open - the
// same property the duplicate-column tolerance gives the ALTERs (the loop is not transactional).
const MIGRATION_V10 = [
  "ALTER TABLE screenings ADD COLUMN lesion_id TEXT",
  "ALTER TABLE screenings ADD COLUMN user_id TEXT",
  "ALTER TABLE screenings ADD COLUMN followup_of TEXT",
  "ALTER TABLE screenings ADD COLUMN answers_carried INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE screenings ADD COLUMN answers_source_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_screenings_lesion ON screenings(lesion_id, created_at DESC)",
  `INSERT OR IGNORE INTO lesions
     (id, created_at, updated_at, label, mark_x, mark_y, mark_z, mark_region, mark_view,
      screening_count, first_screened_at, last_screened_at, last_screening_id, last_tier, archived)
   SELECT 'lesion-' || s.id, s.created_at, s.created_at, NULL,
          s.mark_x, s.mark_y, s.mark_z, s.mark_region, s.mark_view,
          1, s.created_at, s.created_at, s.id, s.tier, 0
   FROM screenings s WHERE s.lesion_id IS NULL`,
  "UPDATE screenings SET lesion_id = 'lesion-' || id WHERE lesion_id IS NULL",
];

// v11 - multi-image screenings (1–3 photos of one lesion). `image_uri` stays NOT NULL and always
// holds images[0].uri, so every existing consumer (history rows, result hero, report/PDF) keeps
// working untouched and pre-v11 rows need no backfill - screening-repo synthesizes `images` from
// `image_uri` when `images_json` is null.
//
// `per_image_json` records each photo's own classification even when pooling is disabled
// (MULTI_IMAGE_AGGREGATION_ENABLED, default false - see synth/eval/MULTIVIEW_EVAL.md). That is
// deliberate: it accumulates exactly the field data a future held-out refit of MALIGNANT_THRESHOLD
// would need, at no behavioural cost today.
const MIGRATION_V11 = [
  "ALTER TABLE screenings ADD COLUMN images_json TEXT",
  "ALTER TABLE screenings ADD COLUMN image_count INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE screenings ADD COLUMN per_image_json TEXT",
  "ALTER TABLE screenings ADD COLUMN image_disagreement INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE screenings ADD COLUMN aggregate_method TEXT NOT NULL DEFAULT 'single'",
];

// v12 - doctor practice locations (server migration 013), plus the booking_links.updated_at
// column that has been in the /sync payload and in api/types.ts since 011 but was never in
// this schema, so repositories.ts always read it back as undefined.
//
// The `doctor_facility` table itself lives in the base SCHEMA above (execAsync(SCHEMA) runs
// unconditionally before migrate), so upgrading databases only need the index statements -
// but they are listed here too because CREATE INDEX on a table that an old database is
// getting for the first time must not run before that CREATE TABLE. Both are IF NOT EXISTS,
// so replaying them is free.
const MIGRATION_V12 = [
  "ALTER TABLE booking_links ADD COLUMN updated_at TEXT",
  "CREATE INDEX IF NOT EXISTS idx_doctor_facility_doctor ON doctor_facility(doctor_id)",
  "CREATE INDEX IF NOT EXISTS idx_doctor_facility_facility ON doctor_facility(facility_id)",
];

// v13 - doctors.status (server migration 013). The collector wrote 258 clinic records into
// the doctors table; they are soft-excluded server-side and hidden here by the same predicate
// facilities already use, so a doctor row is never deleted and an exclusion stays reversible.
const MIGRATION_V13 = ["ALTER TABLE doctors ADD COLUMN status TEXT"];

// v14 - screening photo paths become relative to the document directory.
//
// iOS re-maps the data container to a new UUID on every install, so the absolute
// `file:///var/.../<UUID>/Documents/screenings/scan-1.jpg` these rows held stopped resolving the
// first time the app was reinstalled: history survived (SQLite opens by name and resolves the
// container at runtime) while every thumbnail, result hero, and report photo went blank against
// files that were still sitting on disk. Storing `screenings/scan-1.jpg` and joining with the
// live documentDirectory on read makes that structurally impossible - see data/image-paths.ts.
//
// Idempotent by construction: the rewritten value has no leading slash, so instr() finds nothing
// on a replay and the UPDATE matches no rows. Written against '/screenings/' rather than any
// container prefix because documentDirectory differs per platform and per install.
//
// Only image_uri is rewritten. images_json holds the same paths inside a JSON blob, and picking
// them apart in SQL buys nothing: toRecord() already normalizes every image URI on read, which
// also covers rows this migration never sees (written by an older install, restored from backup).
const MIGRATION_V14 = [
  `UPDATE screenings
      SET image_uri = substr(image_uri, instr(image_uri, '/screenings/') + 1)
    WHERE instr(image_uri, '/screenings/') > 0`,
];

// v15 - account-scoped history. The columns were added in v10, but reads never filtered them and
// the scan flow never populated them. Indexes make the now-mandatory account predicates cheap.
// They live in a migration (not the base SCHEMA) because an upgrading pre-v10 screenings table does
// not have user_id until MIGRATION_V10 runs.
const MIGRATION_V15 = [
  "CREATE INDEX IF NOT EXISTS idx_screenings_user_created ON screenings(user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_lesions_user_updated ON lesions(user_id, archived, updated_at DESC)",
];

// v16 - which body mesh a mark was placed on ('male' | 'female'). The body map gained a female
// mesh, and the two differ in proportion, so a stored point only sits on the surface of the mesh it
// came from. NULL on every pre-v16 row, which is correct rather than a gap to backfill: until v16
// there was only the male mesh, and readers treat NULL as 'male'.
const MIGRATION_V16 = [
  "ALTER TABLE lesions ADD COLUMN mark_mesh TEXT",
  "ALTER TABLE screenings ADD COLUMN mark_mesh TEXT",
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  const pending = [
    ...(version < 2 ? MIGRATION_V2 : []),
    ...(version < 3 ? MIGRATION_V3 : []),
    ...(version < 4 ? MIGRATION_V4 : []),
    ...(version < 5 ? MIGRATION_V5 : []),
    ...(version < 6 ? MIGRATION_V6 : []),
    ...(version < 7 ? MIGRATION_V7 : []),
    ...(version < 8 ? MIGRATION_V8 : []),
    ...(version < 9 ? MIGRATION_V9 : []),
    ...(version < 10 ? MIGRATION_V10 : []),
    ...(version < 11 ? MIGRATION_V11 : []),
    ...(version < 12 ? MIGRATION_V12 : []),
    ...(version < 13 ? MIGRATION_V13 : []),
    ...(version < 14 ? MIGRATION_V14 : []),
    ...(version < 15 ? MIGRATION_V15 : []),
    ...(version < 16 ? MIGRATION_V16 : []),
  ];
  for (const stmt of pending) {
    try {
      await db.execAsync(stmt);
    } catch (e) {
      if (!String(e).includes("duplicate column")) throw e;
    }
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * What went wrong with a database write, in the terms a user can act on.
 *
 * Every value maps to a different instruction, which is the whole point: the screening-save error
 * screen used to show the "close the other tab" copy for ALL of them, including a signed-out
 * session and a transaction collision, and told users to do something that could not help.
 */
export type DbErrorKind = 'locked' | 'poisoned' | 'busy' | 'full' | 'signed-out' | 'unknown';

function messageOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.cause ? ` <- ${messageOf(e.cause)}` : ''}`;
  // DOMException-shaped rejections are not Errors in every runtime; read the same two fields.
  const o = e as { name?: unknown; message?: unknown } | null;
  if (o && typeof o === 'object' && (typeof o.name === 'string' || typeof o.message === 'string')) {
    return `${o.name ?? ''}: ${o.message ?? ''}`;
  }
  return String(e);
}

/**
 * The web build stores SQLite in OPFS via wa-sqlite's AccessHandlePoolVFS, which takes an
 * EXCLUSIVE sync access handle per file:
 *
 *   NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' ...
 *   Access Handles cannot be created if there is another open Access Handle
 *
 * A second page instance on the origin therefore cannot use the database - a second tab does it,
 * and on iOS Safari a bfcached previous instance can still hold the handle after the user
 * navigates back.
 *
 * Reported 2026-09-08 as "We couldn't analyze this photo". Classification had actually SUCCEEDED
 * and only the save threw, but analysis.tsx rendered both failures identically. Verified by
 * controlled experiment: two tabs fail, one tab succeeds, same photo and build.
 *
 * Closing the other tab is NOT enough to recover the page - see the 'poisoned' kind below.
 */
export function isDatabaseLockedOut(e: unknown): boolean {
  return /NoModificationAllowedError|createSyncAccessHandle|Access Handles/i.test(messageOf(e));
}

/**
 * Classify a failure from any database operation.
 *
 * Each pattern is traced to the code that emits it, in node_modules, so this stays checkable:
 *
 * - `poisoned`  expo-sqlite/web/worker.ts maybeInitAsync() assigns `_sqlite3` BEFORE awaiting
 *               `AccessHandlePoolVFS.create()`. Once that create rejects (the lock above), the
 *               `if (!_sqlite3)` guard skips the retry block forever and every later call throws
 *               a bare 'Invalid VFS state'. Nulling `dbPromise` cannot help: the worker, not this
 *               module, is the thing that is stuck. Only a page reload recovers.
 * - `busy`      expo-sqlite's withTransactionAsync is a bare BEGIN/COMMIT on the shared
 *               connection with no queueing. Overlapping transactions make the second BEGIN throw.
 *               withDbTransaction below is what prevents this; the kind stays for anything that
 *               slips past it (another tab, a native SQLITE_BUSY).
 * - `full`      OPFS quota, or AccessHandlePoolVFS running out of pool files ('cannot create
 *               file' -> SQLITE_CANTOPEN 'unable to open database file'). The pool is fixed at 6
 *               and only topped up when it is completely empty, so this does not self-heal.
 * - `signed-out` the account-scope guards in scan-history.tsx / screening-repo.ts / lesion-repo.ts.
 */
export function classifyDbError(e: unknown): DbErrorKind {
  const msg = messageOf(e);
  if (/Invalid VFS state|Failed to initialize (AccessHandlePoolVFS|MemoryVFS|wa-sqlite)/i.test(msg)) {
    return 'poisoned';
  }
  if (isDatabaseLockedOut(e)) return 'locked';
  if (/signed out|belong to (an authenticated|the same authenticated) account|without an account id/i.test(msg)) {
    return 'signed-out';
  }
  if (/QuotaExceeded|SQLITE_FULL|database or disk is full|disk I\/O error|unable to open database file|cannot create file/i.test(msg)) {
    return 'full';
  }
  if (/transaction within a transaction|database is locked|database table is locked|SQLITE_BUSY/i.test(msg)) {
    return 'busy';
  }
  return 'unknown';
}

/**
 * True when the database in use is in-memory: everything works for this page, and NOTHING survives
 * a reload. Read by the UI, which owes the user an explicit warning - an app whose history silently
 * looks empty is indistinguishable from one that lost it, and this one tracks moles over months.
 */
let ephemeral = false;
let ephemeralReason: string | null = null;

export function isDatabaseEphemeral(): boolean {
  return ephemeral;
}

/** Why persistence is unavailable, for the diagnostic line. Null when the database is durable. */
export function databaseEphemeralReason(): string | null {
  return ephemeralReason;
}

async function openAndMigrate(name: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  // No-op under AccessHandlePoolVFS (it has no shared-memory implementation, so SQLite stays in a
  // rollback-journal mode) but still worth having on device.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync(SCHEMA);
  await migrate(db);
  return db;
}

/**
 * Open (once) and initialize the database. Safe to call from anywhere.
 *
 * On web, persistent storage is unavailable in several completely ordinary situations - a second
 * tab holding the OPFS sync access handles, Safari private browsing, OPFS turned off - and the app
 * used to have no database at all in any of them. A user would get through the whole scan, wait
 * for the model, and lose the result at the last step. An in-memory database is a poor substitute
 * for durable history, but it is enormously better than refusing to finish a screening, so it is
 * what we fall back to (paired with an explicit "this will not be saved" warning in the UI).
 *
 * This depends on the patch in patches/expo-sqlite+56.0.5.patch: stock expo-sqlite poisons its
 * worker on the first VFS failure and then rejects ':memory:' too.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await openAndMigrate(DB_NAME);
        ephemeral = false;
        ephemeralReason = null;
        return db;
      } catch (e) {
        // Native has a real filesystem; a failure there is a genuine fault worth surfacing, and
        // silently switching a device user to a throwaway database would hide data loss.
        if (Platform.OS !== "web") throw e;
        console.warn("[db] persistent storage unavailable, using an in-memory database", e);
        const db = await openAndMigrate(":memory:");
        ephemeral = true;
        ephemeralReason = `${classifyDbError(e)}: ${messageOf(e)}`;
        return db;
      }
    })().catch((e) => {
      dbPromise = null; // a later call can retry - the worker is no longer poisoned by one failure
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Serialize every transaction in the app onto one queue.
 *
 * `withTransactionAsync` issues a bare BEGIN ... COMMIT on the SHARED connection and does no
 * queueing of its own, so two overlapping callers corrupt each other: the second BEGIN throws
 * "cannot start a transaction within a transaction", and whichever one hits the catch first runs
 * a ROLLBACK that unwinds the OTHER one's work.
 *
 * That is not theoretical. Opening the Clinics tab starts `runSync()` fire-and-forget
 * (app/(tabs)/directory.tsx) and it keeps running after the tab unmounts - a first-run full
 * directory download over mobile data, eight transactions per page, easily outliving the minute
 * or two a user spends on the body map and questionnaire. The screening save at the end of that
 * flow landed in the middle of it and the user lost a completed analysis.
 *
 * `withExclusiveTransactionAsync` would be the library's answer, but it throws outright on web
 * (expo-sqlite SQLiteDatabase.ts: 'withExclusiveTransactionAsync is not supported on web'), and
 * web is exactly where this bites. Hence a plain FIFO.
 *
 * Everything that opens a transaction must come through here - `npm run check:transactions`
 * (scripts/check-transactions.mjs) fails the build on a direct `withTransactionAsync` call
 * anywhere outside this file.
 */
let txnChain: Promise<unknown> = Promise.resolve();

export function withDbTransaction(task: () => Promise<void>): Promise<void> {
  // Chain on the settled result, never the rejection, so one failed transaction cannot wedge the
  // queue for the rest of the session.
  const run = txnChain.then(
    async () => {
      const db = await getDb();
      await db.withTransactionAsync(task);
    },
    async () => {
      const db = await getDb();
      await db.withTransactionAsync(task);
    },
  );
  txnChain = run.catch(() => {});
  return run;
}

/**
 * Run statements that must not interleave with a transaction (temp-table setup, DDL) on the same
 * queue, without opening a transaction of their own.
 */
export function withDbLock<T>(task: () => Promise<T>): Promise<T> {
  const run = txnChain.then(task, task);
  txnChain = run.catch(() => {});
  return run;
}

/** Read a value from the sync_meta key/value store. */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

/** Write a value to the sync_meta key/value store. */
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

const LEGACY_HISTORY_OWNER_KEY = "account_history_legacy_owner";

/**
 * Assign history written by builds that left user_id NULL to one stable account exactly once.
 *
 * There is no account identifier in those legacy rows, so the only safe compatibility choice is
 * the authenticated account present during the first post-upgrade history load. Once claimed, a
 * later account can never inherit the rows. New writes reject a missing user id at the repository
 * boundary, so this migration cannot accumulate more unowned data.
 */
export async function claimLegacyHistory(userId: string): Promise<void> {
  if (!userId) throw new Error("Cannot claim legacy history without an account id");
  const db = await getDb();
  await withDbTransaction(async () => {
    const owner = await db.getFirstAsync<{ value: string | null }>(
      "SELECT value FROM sync_meta WHERE key = ?",
      LEGACY_HISTORY_OWNER_KEY,
    );
    if (owner?.value) return;

    await db.runAsync("UPDATE screenings SET user_id = ? WHERE user_id IS NULL", userId);
    await db.runAsync("UPDATE lesions SET user_id = ? WHERE user_id IS NULL", userId);
    for (const key of [
      STORAGE_KEYS.reengagementRemindersEnabled,
      STORAGE_KEYS.selfCheckReminderDueAt,
      STORAGE_KEYS.selfCheckReminderNotificationId,
      STORAGE_KEYS.selfCheckReminderLesionId,
    ]) {
      const legacy = await db.getFirstAsync<{ value: string | null }>(
        "SELECT value FROM sync_meta WHERE key = ?",
        key,
      );
      if (legacy) {
        await db.runAsync(
          "INSERT OR IGNORE INTO sync_meta (key, value) VALUES (?, ?)",
          accountStorageKey(userId, key),
          legacy.value,
        );
        await db.runAsync("DELETE FROM sync_meta WHERE key = ?", key);
      }
    }
    await db.runAsync(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
      LEGACY_HISTORY_OWNER_KEY,
      userId,
    );
  });
}

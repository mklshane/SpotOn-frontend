/**
 * Local SQLite database — the offline mirror of the directory.
 *
 * Arrays (services, specialties) and JSON (opening hours) are stored as TEXT;
 * booleans as INTEGER 0/1/NULL. The repositories parse these back on read.
 */
import * as SQLite from "expo-sqlite";

import { DB_NAME } from "../config";

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
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_links_doctor ON booking_links(doctor_id);

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

CREATE TABLE IF NOT EXISTS screenings (
  id                   TEXT PRIMARY KEY NOT NULL,
  created_at           TEXT NOT NULL,
  mark_x               REAL,
  mark_y               REAL,
  mark_z               REAL,
  mark_region          TEXT,
  mark_view            TEXT,
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
  classifier_refined   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_screenings_created ON screenings(created_at DESC);
`;

// Bump when adding ALTERs below. Fresh installs get the full SCHEMA and are
// stamped with the current version; existing databases replay the ALTERs.
const SCHEMA_VERSION = 8;

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

// v3 — hospital derm-department findings, rendered as "Name (Department)".
const MIGRATION_V3 = ["ALTER TABLE facilities ADD COLUMN department_info TEXT"];

// v4 — on-device screening records (questionnaire + classification + triage audit
// trail). The table lives in the base SCHEMA (CREATE IF NOT EXISTS is idempotent),
// so upgrading databases just need the statements replayed.
const MIGRATION_V4 = [
  SCHEMA.slice(SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS screenings")),
];

// v5 — record the confidence-calibration temperature per screening, so records made
// under different T values stay auditable (T scales the confidence that drives CS/TPS).
const MIGRATION_V5 = [
  "ALTER TABLE screenings ADD COLUMN temperature REAL NOT NULL DEFAULT 1.0",
];

// v6 — Malignant Gate: the summed MEL+SCC+BCC softmax mass and whether it floored the tier.
// Pre-v6 rows default to 0/0, which reads correctly as "gate did not run" (it shipped with D4).
const MIGRATION_V6 = [
  "ALTER TABLE screenings ADD COLUMN malignant_score REAL NOT NULL DEFAULT 0",
  "ALTER TABLE screenings ADD COLUMN malignant_gate_applied INTEGER NOT NULL DEFAULT 0",
];

// v7 — scale-consistency check: whether the predicted class survived re-cropping. Drives the
// rescan/floor path, so it belongs in the audit trail. Pre-v7 rows default to 0 ("not checked").
const MIGRATION_V7 = [
  "ALTER TABLE screenings ADD COLUMN scale_unstable INTEGER NOT NULL DEFAULT 0",
];

// v8 — confidence-gated zoom refinement: whether the result was re-classified on a lesion-centered
// crop. Belongs in the audit trail (it changes which pixels produced the answer). Pre-v8 rows
// default to 0 ("not refined").
const MIGRATION_V8 = [
  "ALTER TABLE screenings ADD COLUMN classifier_refined INTEGER NOT NULL DEFAULT 0",
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

/** Open (once) and initialize the database. Safe to call from anywhere. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync(SCHEMA);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
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

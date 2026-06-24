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
  google_maps_url TEXT,
  google_rating   REAL,
  weekday_hours   TEXT,
  weekend_hours   TEXT,
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
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Open (once) and initialize the database. Safe to call from anywhere. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync(SCHEMA);
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

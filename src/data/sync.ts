/**
 * Offline sync — pulls the directory from the backend `/sync` feed into SQLite.
 *
 * Strategy: call /sync?since=<cursor>. Upsert all four collections. While any
 * collection reports has_more, advance the cursor to the SMALLEST next_cursor
 * among collections that still have more (so no collection is skipped) and repeat.
 * Upserts are idempotent, so re-seeing a row across pages is harmless. When all
 * collections are drained, store the response's `synced_at` as the next `since`.
 *
 * Change timestamps: doctors/facilities use updated_at; booking_links/platforms
 * use created_at (no updated_at on those tables). Hard deletes aren't tracked, so
 * a periodic full resync (clear the cursor) reconciles removals.
 */
import { api } from "../api/client";
import type {
  BookingLinkSync,
  DoctorSync,
  FacilitySync,
  PlatformSync,
  SyncResponse,
} from "../api/types";
import { SYNC_PAGE_LIMIT } from "../config";
import { getDb, getMeta, setMeta } from "./db";

const CURSOR_KEY = "sync_cursor";
const LAST_SYNC_KEY = "last_synced_at";

const bit = (v: boolean | null | undefined): number | null =>
  v === null || v === undefined ? null : v ? 1 : 0;

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

async function upsertFacilities(items: FacilitySync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const f of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO facilities
         (id,name,type,address,city,province,region,latitude,longitude,services,
          has_philhealth,fee_min,fee_max,status,phone,website,google_maps_url,
          google_rating,weekday_hours,weekend_hours,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          f.id, f.name, f.type, f.address, f.city, f.province, f.region,
          f.latitude, f.longitude, json(f.services), bit(f.has_philhealth),
          f.fee_min, f.fee_max, f.status, f.phone, f.website, f.google_maps_url,
          f.google_rating, json(f.weekday_hours), json(f.weekend_hours), f.updated_at,
        ],
      );
    }
  });
}

async function upsertDoctors(items: DoctorSync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const d of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO doctors
         (id,name,title,pds_certified,specialties,specialties_display,city,region,
          phone,website,google_maps_url,photo_url,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          d.id, d.name, d.title, bit(d.pds_certified), json(d.specialties),
          d.specialties_display, d.city, d.region, d.phone, d.website,
          d.google_maps_url, d.photo_url, d.updated_at,
        ],
      );
    }
  });
}

async function upsertBookingLinks(items: BookingLinkSync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const b of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO booking_links
         (id,doctor_id,platform_id,url,consultation_fee,rating,review_count,
          is_introductory_fee,available_text,is_active,last_verified,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.id, b.doctor_id, b.platform_id, b.url, b.consultation_fee, b.rating,
          b.review_count, bit(b.is_introductory_fee), b.available_text,
          bit(b.is_active), b.last_verified, b.created_at,
        ],
      );
    }
  });
}

async function upsertPlatforms(items: PlatformSync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO telemedicine_platforms
         (id,slug,name,website,booking_url,description,is_dedicated_derma,
          is_active,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          p.id, p.slug, p.name, p.website, p.booking_url, p.description,
          bit(p.is_dedicated_derma), bit(p.is_active), p.created_at,
        ],
      );
    }
  });
}

export interface SyncResult {
  pages: number;
  counts: { facilities: number; doctors: number; booking_links: number; platforms: number };
  syncedAt: string;
}

/**
 * Run an incremental sync. Pass `full: true` to ignore the stored cursor and
 * re-pull everything (reconciles deletions).
 */
export async function runSync(opts: { full?: boolean } = {}): Promise<SyncResult> {
  let cursor = opts.full ? null : await getMeta(CURSOR_KEY);
  const counts = { facilities: 0, doctors: 0, booking_links: 0, platforms: 0 };
  let pages = 0;
  let syncedAt = new Date().toISOString();

  // Safety bound so a pathological loop can't run forever.
  for (let guard = 0; guard < 1000; guard++) {
    const resp = await api.get<SyncResponse>("/sync", {
      since: cursor ?? undefined,
      limit: SYNC_PAGE_LIMIT,
    });
    pages++;
    syncedAt = resp.synced_at;

    await upsertFacilities(resp.facilities.items);
    await upsertDoctors(resp.doctors.items);
    await upsertBookingLinks(resp.booking_links.items);
    await upsertPlatforms(resp.telemedicine_platforms.items);

    counts.facilities += resp.facilities.items.length;
    counts.doctors += resp.doctors.items.length;
    counts.booking_links += resp.booking_links.items.length;
    counts.platforms += resp.telemedicine_platforms.items.length;

    const more = [
      resp.facilities,
      resp.doctors,
      resp.booking_links,
      resp.telemedicine_platforms,
    ]
      .filter((c) => c.has_more && c.next_cursor)
      .map((c) => c.next_cursor as string);

    if (more.length === 0) break;
    cursor = more.reduce((min, c) => (c < min ? c : min)); // smallest next_cursor
  }

  await setMeta(CURSOR_KEY, syncedAt);
  await setMeta(LAST_SYNC_KEY, new Date().toISOString());
  return { pages, counts, syncedAt };
}

/** ISO timestamp of the last successful sync, or null if never synced. */
export function getLastSyncedAt(): Promise<string | null> {
  return getMeta(LAST_SYNC_KEY);
}

/** True if the local mirror has never been seeded. */
export async function needsInitialSync(): Promise<boolean> {
  return (await getMeta(CURSOR_KEY)) === null;
}

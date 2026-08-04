/**
 * Offline sync — pulls the directory from the backend `/sync` feed into SQLite.
 *
 * Strategy: call /sync?since=<cursor>. Upsert every collection. While any
 * collection reports has_more, advance the cursor to the SMALLEST next_cursor
 * among collections that still have more (so no collection is skipped) and repeat.
 * Upserts are idempotent, so re-seeing a row across pages is harmless. When all
 * collections are drained, store the response's `synced_at` as the next `since`.
 *
 * Change timestamps: doctors/facilities/booking_links use updated_at; platforms
 * use created_at (no updated_at on that table). Hard deletes aren't tracked by
 * the server, so a FULL sync additionally sweeps local rows the server did not
 * return — see runSync/sweepDeleted.
 */
import { api } from "../api/client";
import type {
  BookingLinkSync,
  DoctorFacilitySync,
  DoctorSync,
  FacilitySync,
  PlatformSync,
  SyncResponse,
} from "../api/types";
import { SYNC_PAGE_LIMIT } from "../config";
import { getDb, getMeta, setMeta } from "./db";

const CURSOR_KEY = "sync_cursor";
const LAST_SYNC_KEY = "last_synced_at";

// Bump to force every already-installed device through one full, sweeping sync.
// Needed because deletions were previously unrecoverable: an install that synced
// before a row was removed server-side kept showing it forever, and no
// incremental sync could ever clear it.
const RECONCILE_KEY = "sync_reconcile_version";
const RECONCILE_VERSION = "1";

const bit = (v: boolean | null | undefined): number | null =>
  v === null || v === undefined ? null : v ? 1 : 0;

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

/** A row the server has soft-deleted (migration 014). */
type Tombstoned = { id: string; deleted_at?: string | null };

/**
 * Split a synced collection into rows to upsert and rows to purge.
 *
 * /sync deliberately RETURNS tombstones — that is how a client finds out a row
 * is gone. Before 014 a deletion was simply never mentioned again, so it stayed
 * on the device forever (deleted pathology labs were still listed in the app).
 */
function partition<T extends Tombstoned>(items: T[]): { live: T[]; dead: string[] } {
  const live: T[] = [];
  const dead: string[] = [];
  for (const it of items) {
    if (it.deleted_at) dead.push(it.id);
    else live.push(it);
  }
  return { live, dead };
}

/** Delete tombstoned rows locally. Chunked to stay under SQLite's parameter cap. */
async function purge(table: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await db.runAsync(
        `DELETE FROM ${table} WHERE id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      );
    }
  });
}

async function upsertFacilities(items: FacilitySync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const f of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO facilities
         (id,name,type,facility_type,address,city,province,region,latitude,longitude,
          services,has_philhealth,fee_min,fee_max,status,phone,website,booking_url,
          google_maps_url,google_rating,weekday_hours,weekend_hours,description,
          photo_url,photo_attribution,department_info,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          f.id, f.name, f.type, f.facility_type, f.address, f.city, f.province,
          f.region, f.latitude, f.longitude, json(f.services), bit(f.has_philhealth),
          f.fee_min, f.fee_max, f.status, f.phone, f.website, f.booking_url,
          f.google_maps_url, f.google_rating, json(f.weekday_hours),
          json(f.weekend_hours), f.description, f.photo_url, f.photo_attribution,
          json(f.department_info), f.updated_at,
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
         (id,name,title,pds_certified,specialties,specialties_display,status,city,region,
          phone,website,google_maps_url,photo_url,description,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          d.id, d.name, d.title, bit(d.pds_certified), json(d.specialties),
          d.specialties_display, d.status, d.city, d.region, d.phone, d.website,
          d.google_maps_url, d.photo_url, d.description, d.updated_at,
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
          is_introductory_fee,available_text,is_active,last_verified,
          next_available,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.id, b.doctor_id, b.platform_id, b.url, b.consultation_fee, b.rating,
          b.review_count, bit(b.is_introductory_fee), b.available_text,
          bit(b.is_active), b.last_verified, b.next_available, b.created_at,
          b.updated_at,
        ],
      );
    }
  });
}

async function upsertDoctorFacilities(items: DoctorFacilitySync[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const l of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO doctor_facility
         (id,doctor_id,facility_id,is_primary,schedule,updated_at)
         VALUES (?,?,?,?,?,?)`,
        [l.id, l.doctor_id, l.facility_id, bit(l.is_primary), l.schedule, l.updated_at],
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

/**
 * Delete local rows the server did not mention during a completed full pass.
 *
 * The id set is staged in a temp table rather than inlined as a NOT IN (?,?,…)
 * list: there are thousands of ids, and SQLite caps host parameters per
 * statement, so the inline form would throw once the directory grew.
 *
 * A collection that came back completely empty is skipped. Legitimately-empty is
 * indistinguishable here from a server or schema fault, and wiping a table on
 * that ambiguity is the more damaging reading.
 */
async function sweepDeleted(seen: Record<string, Set<string>>): Promise<number> {
  const db = await getDb();
  let removed = 0;
  for (const [table, ids] of Object.entries(seen)) {
    if (ids.size === 0) continue;
    await db.execAsync(
      "CREATE TEMP TABLE IF NOT EXISTS _seen_ids (id TEXT PRIMARY KEY); DELETE FROM _seen_ids;",
    );
    await db.withTransactionAsync(async () => {
      for (const id of ids) {
        await db.runAsync("INSERT OR IGNORE INTO _seen_ids (id) VALUES (?)", id);
      }
    });
    const before = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}`,
    );
    await db.runAsync(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM _seen_ids)`,
    );
    const after = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}`,
    );
    const gone = (before?.n ?? 0) - (after?.n ?? 0);
    if (gone > 0) console.warn(`[sync] swept ${gone} stale row(s) from ${table}`);
    removed += gone;
  }
  await db.execAsync("DROP TABLE IF EXISTS _seen_ids;");
  return removed;
}

export interface SyncResult {
  pages: number;
  counts: {
    facilities: number;
    doctors: number;
    doctor_facilities: number;
    booking_links: number;
    platforms: number;
    purged: number; // rows removed because the server tombstoned them (014)
  };
  syncedAt: string;
}

/**
 * Run an incremental sync. Pass `full: true` to ignore the stored cursor,
 * re-pull everything, and sweep away rows the server no longer has.
 *
 * The sweep exists because /sync carries no tombstones: a hard-deleted row was
 * simply never mentioned again, and since every write here is INSERT OR REPLACE,
 * it survived on the device forever. That is not hypothetical — pathology labs
 * deleted server-side were still listed in the app's Clinics tab.
 *
 * Mark-and-sweep rather than clear-then-refill: the ids seen during the pass are
 * collected, and the delete only runs once every collection has drained. A sync
 * that dies halfway therefore leaves the old data intact instead of wiping the
 * directory and leaving the user with a blank screen offline.
 */
export async function runSync(opts: { full?: boolean } = {}): Promise<SyncResult> {
  const full = opts.full ?? false;
  let cursor = full ? null : await getMeta(CURSOR_KEY);
  const counts = {
    facilities: 0,
    doctors: 0,
    doctor_facilities: 0,
    booking_links: 0,
    platforms: 0,
    purged: 0,
  };
  let pages = 0;
  let syncedAt = new Date().toISOString();

  // Only populated on a full pass — an incremental pass sees only what changed,
  // so sweeping against it would delete the entire unchanged directory.
  const seen: Record<string, Set<string>> = {
    facilities: new Set(),
    doctors: new Set(),
    doctor_facility: new Set(),
    booking_links: new Set(),
    telemedicine_platforms: new Set(),
  };
  let drained = false;

  // Safety bound so a pathological loop can't run forever.
  for (let guard = 0; guard < 1000; guard++) {
    const resp = await api.get<SyncResponse>("/sync", {
      since: cursor ?? undefined,
      limit: SYNC_PAGE_LIMIT,
    });
    pages++;
    syncedAt = resp.synced_at;

    const fac = partition(resp.facilities.items);
    const doc = partition(resp.doctors.items);
    const dfa = partition(resp.doctor_facilities.items);
    const bl = partition(resp.booking_links.items);
    const plat = partition(resp.telemedicine_platforms.items);

    await upsertFacilities(fac.live);
    await upsertDoctors(doc.live);
    await upsertDoctorFacilities(dfa.live);
    await upsertBookingLinks(bl.live);
    await upsertPlatforms(plat.live);

    await purge("facilities", fac.dead);
    await purge("doctors", doc.dead);
    await purge("doctor_facility", dfa.dead);
    await purge("booking_links", bl.dead);
    await purge("telemedicine_platforms", plat.dead);

    counts.facilities += fac.live.length;
    counts.doctors += doc.live.length;
    counts.doctor_facilities += dfa.live.length;
    counts.booking_links += bl.live.length;
    counts.platforms += plat.live.length;
    counts.purged +=
      fac.dead.length + doc.dead.length + dfa.dead.length +
      bl.dead.length + plat.dead.length;

    // Tombstones are deliberately NOT marked as seen — a full pass must let the
    // sweep remove them too, not resurrect them as "known to the server".
    if (full) {
      for (const f of fac.live) seen.facilities.add(f.id);
      for (const d of doc.live) seen.doctors.add(d.id);
      for (const l of dfa.live) seen.doctor_facility.add(l.id);
      for (const b of bl.live) seen.booking_links.add(b.id);
      for (const p of plat.live) seen.telemedicine_platforms.add(p.id);
    }

    const more = [
      resp.facilities,
      resp.doctors,
      resp.doctor_facilities,
      resp.booking_links,
      resp.telemedicine_platforms,
    ]
      .filter((c) => c.has_more && c.next_cursor)
      .map((c) => c.next_cursor as string);

    if (more.length === 0) {
      drained = true;
      break;
    }
    cursor = more.reduce((min, c) => (c < min ? c : min)); // smallest next_cursor
  }

  // Guard-exit means paging never finished, so `seen` is incomplete and sweeping
  // it would delete live rows.
  if (full && drained) {
    await sweepDeleted(seen);
    // Only stamped after a pass that actually completed, so an interrupted
    // reconcile is retried on the next launch.
    await setMeta(RECONCILE_KEY, RECONCILE_VERSION);
  }

  await setMeta(CURSOR_KEY, syncedAt);
  await setMeta(LAST_SYNC_KEY, new Date().toISOString());
  return { pages, counts, syncedAt };
}

/**
 * True if this install has never run a sweeping full sync at the current
 * reconcile version — i.e. it may still hold rows deleted server-side.
 */
export async function needsReconcile(): Promise<boolean> {
  return (await getMeta(RECONCILE_KEY)) !== RECONCILE_VERSION;
}

/** ISO timestamp of the last successful sync, or null if never synced. */
export function getLastSyncedAt(): Promise<string | null> {
  return getMeta(LAST_SYNC_KEY);
}

/** True if the local mirror has never been seeded. */
export async function needsInitialSync(): Promise<boolean> {
  return (await getMeta(CURSOR_KEY)) === null;
}

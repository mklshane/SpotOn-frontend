/**
 * Read layer over the local SQLite mirror. All reads come from here so the UI
 * never talks to SQLite directly. Stored TEXT/INTEGER columns are parsed back to
 * arrays / booleans / objects.
 */
import type {
  BookingLinkSync,
  DepartmentInfo,
  DoctorSync,
  FacilitySync,
  HoursPeriod,
  PlatformSync,
} from "../api/types";
import { getDb } from "./db";

// ---- row shapes as stored in SQLite (arrays/json as TEXT, bools as 0/1) -------

interface FacilityRow {
  id: string; name: string; type: string; facility_type: string | null;
  address: string; city: string;
  province: string; region: string | null; latitude: number; longitude: number;
  services: string; has_philhealth: number | null; fee_min: number | null;
  fee_max: number | null; status: string | null; phone: string | null;
  website: string | null; booking_url: string | null;
  google_maps_url: string | null;
  google_rating: number | null; weekday_hours: string | null;
  weekend_hours: string | null; description: string | null;
  photo_url: string | null; photo_attribution: string | null;
  department_info: string | null; updated_at: string;
}

interface DoctorRow {
  id: string; name: string; title: string | null; pds_certified: number | null;
  specialties: string; specialties_display: string | null; status: string | null;
  city: string | null;
  region: string | null; phone: string | null; website: string | null;
  google_maps_url: string | null; photo_url: string | null;
  description: string | null; updated_at: string;
}

const toBool = (v: number | null): boolean | null =>
  v === null || v === undefined ? null : v !== 0;

const arr = (v: string | null): string[] => {
  if (!v) return [];
  try {
    return JSON.parse(v) as string[];
  } catch {
    return [];
  }
};

const hours = (v: string | null): HoursPeriod | null => {
  if (!v) return null;
  try {
    const p = JSON.parse(v) as HoursPeriod;
    // Guard against empty/partial objects ({}), which would render as
    // "Hours unavailable" rows instead of hiding the section.
    if (typeof p?.open !== "string" || typeof p?.close !== "string") return null;
    return p;
  } catch {
    return null;
  }
};

const dept = (v: string | null): DepartmentInfo | null => {
  if (!v) return null;
  try {
    return JSON.parse(v) as DepartmentInfo;
  } catch {
    return null;
  }
};

function toFacility(r: FacilityRow): FacilitySync {
  return {
    id: r.id, name: r.name, type: r.type, facility_type: r.facility_type,
    address: r.address, city: r.city,
    province: r.province, region: r.region, latitude: r.latitude,
    longitude: r.longitude, services: arr(r.services),
    has_philhealth: toBool(r.has_philhealth), fee_min: r.fee_min,
    fee_max: r.fee_max, status: r.status, phone: r.phone, website: r.website,
    booking_url: r.booking_url,
    google_maps_url: r.google_maps_url, google_rating: r.google_rating,
    weekday_hours: hours(r.weekday_hours), weekend_hours: hours(r.weekend_hours),
    description: r.description, photo_url: r.photo_url,
    photo_attribution: r.photo_attribution,
    department_info: dept(r.department_info),
    updated_at: r.updated_at,
  };
}

function toDoctor(r: DoctorRow): DoctorSync {
  return {
    id: r.id, name: r.name, title: r.title,
    pds_certified: toBool(r.pds_certified), specialties: arr(r.specialties),
    specialties_display: r.specialties_display, status: r.status,
    city: r.city, region: r.region,
    phone: r.phone, website: r.website, google_maps_url: r.google_maps_url,
    photo_url: r.photo_url, description: r.description, updated_at: r.updated_at,
  };
}

// ---- facilities ---------------------------------------------------------------

export interface FacilityQuery {
  q?: string; // name search
  service?: string; // single service tag (one of SERVICES)
  city?: string;
  type?: string; // collector type, e.g. dermatology_clinic
  hasBookingUrl?: boolean; // only facilities with an online booking page
  includeExcluded?: boolean; // default false — hide status='excluded'
  limit?: number;
  offset?: number;
}

function facilityWhere(query: FacilityQuery): { clause: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!query.includeExcluded) where.push("(status IS NULL OR status != 'excluded')");
  if (query.q) {
    // "Search clinics or area…" — match the clinic's own name/address as well
    // as where it's located, so typing a place (e.g. "Lipa") finds clinics
    // there, and typing a clinic's actual name or street still works too.
    where.push("(name LIKE ? OR address LIKE ? OR city LIKE ? OR province LIKE ?)");
    params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.city) {
    where.push("city LIKE ?");
    params.push(`%${query.city}%`);
  }
  if (query.type) {
    where.push("type = ?");
    params.push(query.type);
  }
  if (query.service) {
    // services is a JSON array string like ["dermoscopy","excision"]
    where.push("services LIKE ?");
    params.push(`%"${query.service}"%`);
  }
  if (query.hasBookingUrl) {
    where.push("booking_url IS NOT NULL AND booking_url != ''");
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listFacilities(query: FacilityQuery = {}): Promise<FacilitySync[]> {
  const db = await getDb();
  const { clause, params } = facilityWhere(query);
  const rows = await db.getAllAsync<FacilityRow>(
    `SELECT * FROM facilities ${clause} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, query.limit ?? 50, query.offset ?? 0],
  );
  return rows.map(toFacility);
}

export async function countFacilities(query: FacilityQuery = {}): Promise<number> {
  const db = await getDb();
  const { clause, params } = facilityWhere(query);
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM facilities ${clause}`,
    params,
  );
  return row?.n ?? 0;
}

/** One facility by id, or null if it is excluded (see getDoctor for why). */
export async function getFacility(id: string): Promise<FacilitySync | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<FacilityRow>(
    "SELECT * FROM facilities WHERE id = ? AND (status IS NULL OR status != 'excluded')",
    id,
  );
  return row ? toFacility(row) : null;
}

// ---- distance / nearest (computed on-device) ---------------------------------

const R = 6_371_000; // earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points. */
export function distanceMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const lat1 = rad(aLat);
  const lat2 = rad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface FacilityWithDistance extends FacilitySync {
  distance_m: number;
}

/**
 * Facilities near a point, sorted ascending by distance. Prefilters with a
 * bounding box in SQL (cheap), then sorts the candidates by exact haversine.
 */
export async function nearbyFacilities(
  lat: number,
  lng: number,
  opts: { radiusM?: number; limit?: number } & FacilityQuery = {},
): Promise<FacilityWithDistance[]> {
  const radiusM = opts.radiusM ?? 15_000;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos(rad(lat)) || 1);

  const db = await getDb();
  const { clause, params } = facilityWhere({ ...opts, limit: undefined, offset: undefined });
  const bbox = `${clause ? `${clause} AND` : "WHERE"} latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`;
  const rows = await db.getAllAsync<FacilityRow>(
    `SELECT * FROM facilities ${bbox}`,
    [...params, lat - dLat, lat + dLat, lng - dLng, lng + dLng],
  );

  return rows
    .map(toFacility)
    .map((f) => ({ ...f, distance_m: distanceMeters(lat, lng, f.latitude, f.longitude) }))
    .filter((f) => f.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, opts.limit ?? 50);
}

// ---- doctors ------------------------------------------------------------------

export interface DoctorQuery {
  q?: string;
  specialty?: string;
  city?: string;
  pdsCertified?: boolean;
  hasBookingLink?: boolean; // only doctors with ≥1 active booking link
  includeExcluded?: boolean; // default false — hide status='excluded'
  limit?: number;
  offset?: number;
}

export async function listDoctors(query: DoctorQuery = {}): Promise<DoctorSync[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  // Same predicate as facilityWhere: the collector filed 258 clinics as doctors,
  // and they are soft-excluded rather than deleted.
  if (!query.includeExcluded) where.push("(status IS NULL OR status != 'excluded')");
  if (query.q) { where.push("name LIKE ?"); params.push(`%${query.q}%`); }
  if (query.city) { where.push("city LIKE ?"); params.push(`%${query.city}%`); }
  if (query.specialty) { where.push("specialties LIKE ?"); params.push(`%"${query.specialty}"%`); }
  if (query.pdsCertified !== undefined) { where.push("pds_certified = ?"); params.push(query.pdsCertified ? 1 : 0); }
  if (query.hasBookingLink) {
    where.push(
      "EXISTS (SELECT 1 FROM booking_links bl WHERE bl.doctor_id = doctors.id AND bl.is_active = 1)",
    );
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await db.getAllAsync<DoctorRow>(
    `SELECT * FROM doctors ${clause} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, query.limit ?? 50, query.offset ?? 0],
  );
  return rows.map(toDoctor);
}

/**
 * One doctor by id, or null if it is excluded.
 *
 * The list already filters, but a deep link or a stale navigation param can
 * carry an id straight here — the detail screen renders "Doctor not found",
 * which is the right answer for a record the directory has hidden.
 */
export async function getDoctor(id: string): Promise<DoctorSync | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DoctorRow>(
    "SELECT * FROM doctors WHERE id = ? AND (status IS NULL OR status != 'excluded')",
    id,
  );
  return row ? toDoctor(row) : null;
}

/** A facility a doctor practises at, plus the schedule recorded for that pairing. */
export interface DoctorPractice {
  facility: FacilitySync;
  is_primary: boolean | null;
  schedule: string | null;
}

/**
 * Facilities a doctor practises at, primary first.
 *
 * Excluded facilities are filtered out with the same rule the clinic list uses,
 * so a doctor never links through to a clinic the directory has hidden.
 */
export async function getDoctorPractices(doctorId: string): Promise<DoctorPractice[]> {
  const db = await getDb();
  // f.* keeps the row shape identical to every other facility read, so the same
  // toFacility() parses it; the two df_* aliases carry the edge's own columns.
  type PracticeRow = FacilityRow & {
    df_is_primary: number | null;
    df_schedule: string | null;
  };
  const rows = await db.getAllAsync<PracticeRow>(
    `SELECT f.*, df.is_primary AS df_is_primary, df.schedule AS df_schedule
       FROM doctor_facility df
       JOIN facilities f ON f.id = df.facility_id
      WHERE df.doctor_id = ?
        AND (f.status IS NULL OR f.status != 'excluded')
      ORDER BY (df.is_primary IS NULL OR df.is_primary = 0), f.name`,
    doctorId,
  );
  return rows.map((r) => ({
    facility: toFacility(r),
    is_primary: toBool(r.df_is_primary),
    schedule: r.df_schedule ?? null,
  }));
}

export interface BookingLinkWithPlatform extends BookingLinkSync {
  platform: PlatformSync | null;
}

/** Active booking links for a doctor, best (highest-rated) first, with platform. */
export async function getDoctorBookingLinks(
  doctorId: string,
): Promise<BookingLinkWithPlatform[]> {
  const db = await getDb();
  const links = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM booking_links WHERE doctor_id = ? AND is_active = 1
     ORDER BY (rating IS NULL), rating DESC`,
    doctorId,
  );
  const platforms = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM telemedicine_platforms",
  );
  const byId = new Map(platforms.map((p) => [p.id as string, toPlatform(p)]));
  return links.map((l) => ({
    id: l.id as string,
    doctor_id: l.doctor_id as string,
    platform_id: l.platform_id as string,
    url: l.url as string,
    consultation_fee: (l.consultation_fee as number) ?? null,
    rating: (l.rating as number) ?? null,
    review_count: (l.review_count as number) ?? null,
    is_introductory_fee: !!(l.is_introductory_fee as number),
    available_text: (l.available_text as string) ?? null,
    is_active: !!(l.is_active as number),
    last_verified: (l.last_verified as string) ?? null,
    next_available: (l.next_available as string) ?? null,
    created_at: l.created_at as string,
    updated_at: (l.updated_at as string) ?? null,
    platform: byId.get(l.platform_id as string) ?? null,
  }));
}

function toPlatform(p: Record<string, unknown>): PlatformSync {
  return {
    id: p.id as string,
    slug: p.slug as string,
    name: p.name as string,
    website: p.website as string,
    booking_url: (p.booking_url as string) ?? null,
    description: (p.description as string) ?? null,
    is_dedicated_derma: !!(p.is_dedicated_derma as number),
    is_active: !!(p.is_active as number),
    created_at: p.created_at as string,
  };
}

export async function listPlatforms(): Promise<PlatformSync[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM telemedicine_platforms WHERE is_active = 1 ORDER BY name",
  );
  return rows.map(toPlatform);
}

/** Row counts per table — useful for a sync/debug screen. */
export async function getCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const tables = ["facilities", "doctors", "booking_links", "telemedicine_platforms"];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = row?.n ?? 0;
  }
  return out;
}

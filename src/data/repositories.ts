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
import { likeContains, normalizeUrl, summarizeDerms, type DermSummary } from "../lib/directory-core";
import { getDb } from "./db";

/**
 * A column folded the way foldSearch() folds the query: SQLite's lower() is ASCII-only, so the
 * common accented letters are replaced by hand ("Las Piñas" must match a typed "las pinas").
 */
const fold = (col: string) =>
  ["ñ:n", "Ñ:n", "á:a", "é:e", "É:e", "í:i", "ó:o", "ú:u"].reduce(
    (expr, pair) => `REPLACE(${expr}, '${pair[0]}', '${pair[2]}')`,
    `lower(${col})`,
  );
/** `<folded col> LIKE ? ESCAPE '\'` - pair with likeContains(q). */
const likeFolded = (col: string) => `${fold(col)} LIKE ? ESCAPE '\\'`;

/** null = no limit (SQLite LIMIT -1). */
const sqlLimit = (limit: number | null | undefined, fallback: number) =>
  limit === null ? -1 : limit ?? fallback;

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
  department_info: string | null; derm_status: string | null; concerns: string | null;
  pds_skin_cancer_center: number | null; updated_at: string;
}

interface DoctorRow {
  id: string; name: string; title: string | null; pds_certified: number | null;
  specialties: string; specialties_display: string | null; status: string | null;
  city: string | null;
  region: string | null; phone: string | null; website: string | null;
  google_maps_url: string | null; photo_url: string | null;
  description: string | null; concerns: string | null; updated_at: string;
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
    derm_status: (r.derm_status as FacilitySync["derm_status"]) ?? null,
    concerns: arr(r.concerns),
    pds_skin_cancer_center: toBool(r.pds_skin_cancer_center),
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
    photo_url: r.photo_url, description: r.description, concerns: arr(r.concerns),
    updated_at: r.updated_at,
  };
}

// ---- facilities ---------------------------------------------------------------

export type FacilityKind = "hospital" | "clinic";

/** Collector types that are hospitals; everything else that is live is a clinic. */
export const HOSPITAL_TYPES = ["private_hospital", "government_hospital", "medical_center"] as const;

export interface FacilityQuery {
  q?: string; // name search
  service?: string; // single service tag (one of SERVICES)
  city?: string;
  type?: string; // collector type, e.g. dermatology_clinic
  kind?: FacilityKind; // hospitals vs clinics (groups the collector types)
  concern?: string; // single patient concern (one of CONCERNS, server migration 016)
  /** Only places with a dermatologist in clinic on one of these days (Mon=1 .. Sun=64). */
  dayMask?: number;
  hasBookingUrl?: boolean; // only facilities with an online booking page
  includeExcluded?: boolean; // default false - hide status='excluded'
  /** Row cap; null = every match. */
  limit?: number | null;
  offset?: number;
}

function facilityWhere(query: FacilityQuery): { clause: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!query.includeExcluded) where.push("(status IS NULL OR status != 'excluded')");
  if (query.q) {
    // "Search clinics or area…" - match the clinic's own name/address as well
    // as where it's located, so typing a place (e.g. "Lipa") finds clinics
    // there, and typing a clinic's actual name or street still works too.
    // A dermatologist's name finds the places they hold clinic ("Songco" -> Mediatrix, Asian
    // Hospital, Makati Med): patients often know the doctor, not the clinic.
    const pattern = likeContains(query.q);
    // department_info is matched too: its department name is shown as part of the title
    // ("Makati Medical Center (Dermatology & Phototherapy Center)"), so people search for it.
    where.push(`(${likeFolded("name")} OR ${likeFolded("address")} OR ${likeFolded("city")} OR ${likeFolded("province")}
      OR ${likeFolded("COALESCE(department_info, '')")}
      OR EXISTS (SELECT 1 FROM doctor_facility qdf JOIN doctors qd ON qd.id = qdf.doctor_id
                  WHERE qdf.facility_id = facilities.id
                    AND (qd.status IS NULL OR qd.status != 'excluded')
                    AND ${likeFolded("qd.name")}))`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (query.city) {
    where.push("city LIKE ?");
    params.push(`%${query.city}%`);
  }
  if (query.type) {
    where.push("type = ?");
    params.push(query.type);
  }
  if (query.kind) {
    const placeholders = HOSPITAL_TYPES.map(() => "?").join(",");
    where.push(`type ${query.kind === "hospital" ? "IN" : "NOT IN"} (${placeholders})`);
    params.push(...HOSPITAL_TYPES);
  }
  if (query.concern) {
    // concerns is a JSON array string like ["acne","skin_cancer_mole_check"]
    where.push("concerns LIKE ?");
    params.push(`%"${query.concern}"%`);
  }
  if (query.dayMask) {
    // A clinic day lives on the doctor<->facility edge, not on the facility.
    where.push(`EXISTS (SELECT 1 FROM doctor_facility df
                          JOIN doctors d ON d.id = df.doctor_id
                         WHERE df.facility_id = facilities.id
                           AND (df.schedule_days & ?) != 0
                           AND (d.status IS NULL OR d.status != 'excluded'))`);
    params.push(query.dayMask);
  }
  if (query.service) {
    // services is a JSON array string like ["dermoscopy","excision"]
    where.push("services LIKE ?");
    params.push(`%"${query.service}"%`);
  }
  if (query.hasBookingUrl) {
    // Bookable online: the clinic's own booking page, or a dermatologist here with an active link.
    where.push(`((booking_url IS NOT NULL AND booking_url != '')
      OR EXISTS (SELECT 1 FROM doctor_facility bdf
                   JOIN doctors bd ON bd.id = bdf.doctor_id
                   JOIN booking_links bl ON bl.doctor_id = bd.id AND bl.is_active = 1
                   JOIN telemedicine_platforms bp ON bp.id = bl.platform_id AND bp.is_active = 1
                  WHERE bdf.facility_id = facilities.id
                    AND (bd.status IS NULL OR bd.status != 'excluded')))`);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listFacilities(query: FacilityQuery = {}): Promise<FacilitySync[]> {
  const db = await getDb();
  const { clause, params } = facilityWhere(query);
  const rows = await db.getAllAsync<FacilityRow>(
    `SELECT * FROM facilities ${clause} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, sqlLimit(query.limit, 50), query.offset ?? 0],
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
 * Metres from a point to each doctor's NEAREST practice (doctor_facility -> facility with
 * coordinates). Doctors with no mapped practice are absent from the map. One pass over
 * ~1.7k links, so cheap enough to run on every location fix.
 */
export async function nearestPracticeMeters(lat: number, lng: number): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ doctor_id: string; latitude: number; longitude: number }>(
    `SELECT df.doctor_id, f.latitude, f.longitude
       FROM doctor_facility df JOIN facilities f ON f.id = df.facility_id
      WHERE f.latitude IS NOT NULL AND f.longitude IS NOT NULL
        AND (f.status IS NULL OR f.status != 'excluded')`,
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const d = distanceMeters(lat, lng, r.latitude, r.longitude);
    const prev = out.get(r.doctor_id);
    if (prev === undefined || d < prev) out.set(r.doctor_id, d);
  }
  return out;
}

/**
 * Per facility: how many live dermatologists are linked and the union of their clinic days.
 * One read of the ~1.7k doctor_facility edges, folded in JS - drives the list cards' "3
 * dermatologists · in today" line and the "Derm in today" filter.
 */
export async function facilityDermSummary(): Promise<Map<string, DermSummary>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ facility_id: string; schedule_days: number | null; bookable: number }>(
    `SELECT df.facility_id, df.schedule_days,
            EXISTS (SELECT 1 FROM booking_links bl
                      JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
                     WHERE bl.doctor_id = d.id AND bl.is_active = 1) AS bookable
       FROM doctor_facility df JOIN doctors d ON d.id = df.doctor_id
      WHERE (d.status IS NULL OR d.status != 'excluded')`,
  );
  return summarizeDerms(rows);
}

/** What a doctor list card shows besides the doctor row itself. */
export interface DoctorCardInfo {
  /** Display name of the primary (else first) live practice. */
  practiceName: string | null;
  /** Union of clinic days across live practices (Mon=1 .. Sun=64). */
  daysMask: number;
  /** Has an active booking link on an active platform. */
  bookable: boolean;
  /** Has an active online-consult link (018). */
  online: boolean;
}

/** DoctorCardInfo for every doctor, from two reads - cheap enough to run once per list load. */
export async function doctorCardInfo(): Promise<Map<string, DoctorCardInfo>> {
  const db = await getDb();
  const practices = await db.getAllAsync<{ doctor_id: string; name: string; schedule_days: number | null; is_primary: number | null }>(
    `SELECT df.doctor_id, f.name, df.schedule_days, df.is_primary
       FROM doctor_facility df JOIN facilities f ON f.id = df.facility_id
      WHERE (f.status IS NULL OR f.status != 'excluded')
      ORDER BY (df.is_primary IS NULL OR df.is_primary = 0), f.name`,
  );
  const bookable = await db.getAllAsync<{ doctor_id: string; online: number | null }>(
    `SELECT bl.doctor_id, MAX(COALESCE(bl.offers_online, 0)) AS online FROM booking_links bl
       JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
      WHERE bl.is_active = 1
      GROUP BY bl.doctor_id`,
  );
  const out = new Map<string, DoctorCardInfo>();
  for (const r of practices) {
    const prev = out.get(r.doctor_id);
    out.set(r.doctor_id, {
      practiceName: prev?.practiceName ?? r.name,
      daysMask: (prev?.daysMask ?? 0) | (r.schedule_days ?? 0),
      bookable: false,
      online: false,
    });
  }
  for (const { doctor_id, online } of bookable) {
    const prev = out.get(doctor_id);
    out.set(doctor_id, {
      practiceName: prev?.practiceName ?? null,
      daysMask: prev?.daysMask ?? 0,
      bookable: true,
      online: online === 1,
    });
  }
  return out;
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
  /** Only doctors in clinic on one of these days at a live facility (Mon=1 .. Sun=64). */
  dayMask?: number;
  /** Only doctors with an active online-consult booking link on an active platform (018). */
  offersOnline?: boolean;
  includeExcluded?: boolean; // default false - hide status='excluded'
  /** Row cap; null = every match. */
  limit?: number | null;
  offset?: number;
}

export async function listDoctors(query: DoctorQuery = {}): Promise<DoctorSync[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  // Same predicate as facilityWhere: the collector filed 258 clinics as doctors,
  // and they are soft-excluded rather than deleted.
  if (!query.includeExcluded) where.push("(status IS NULL OR status != 'excluded')");
  if (query.q) { where.push(likeFolded("name")); params.push(likeContains(query.q)); }
  if (query.city) { where.push("city LIKE ?"); params.push(`%${query.city}%`); }
  if (query.specialty) { where.push("specialties LIKE ?"); params.push(`%"${query.specialty}"%`); }
  if (query.pdsCertified !== undefined) { where.push("pds_certified = ?"); params.push(query.pdsCertified ? 1 : 0); }
  if (query.hasBookingLink) {
    // Same platform rule as getDoctorBookingLinks: a link on a deactivated platform isn't shown.
    where.push(
      `EXISTS (SELECT 1 FROM booking_links bl
                 JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
                WHERE bl.doctor_id = doctors.id AND bl.is_active = 1)`,
    );
  }
  if (query.offersOnline) {
    where.push(
      `EXISTS (SELECT 1 FROM booking_links bl
                 JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
                WHERE bl.doctor_id = doctors.id AND bl.is_active = 1 AND bl.offers_online = 1)`,
    );
  }
  if (query.dayMask) {
    where.push(`EXISTS (SELECT 1 FROM doctor_facility df JOIN facilities f ON f.id = df.facility_id
                         WHERE df.doctor_id = doctors.id AND (df.schedule_days & ?) != 0
                           AND (f.status IS NULL OR f.status != 'excluded'))`);
    params.push(query.dayMask);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await db.getAllAsync<DoctorRow>(
    `SELECT * FROM doctors ${clause} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, sqlLimit(query.limit, 50), query.offset ?? 0],
  );
  return rows.map(toDoctor);
}

/**
 * One doctor by id, or null if it is excluded.
 *
 * The list already filters, but a deep link or a stale navigation param can
 * carry an id straight here - the detail screen renders "Doctor not found",
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
  schedule_days: number | null;
  room: string | null;
  phone: string | null; // the clinic room's own line, when known
  verified_at: string | null;
  consultation_fee: number | null; // PHP, this doctor at this clinic (018)
}

/** The doctor_facility columns every practice read carries, aliased df_*. */
const DF_COLUMNS = `df.is_primary AS df_is_primary, df.schedule AS df_schedule,
  df.schedule_days AS df_schedule_days, df.room AS df_room, df.phone AS df_phone,
  df.verified_at AS df_verified_at, df.consultation_fee AS df_consultation_fee`;
type DfColumns = {
  df_is_primary: number | null; df_schedule: string | null; df_schedule_days: number | null;
  df_room: string | null; df_phone: string | null; df_verified_at: string | null;
  df_consultation_fee: number | null;
};
const edge = (r: DfColumns) => ({
  schedule: r.df_schedule ?? null,
  schedule_days: r.df_schedule_days ?? null,
  room: r.df_room ?? null,
  phone: r.df_phone ?? null,
  verified_at: r.df_verified_at ?? null,
  consultation_fee: r.df_consultation_fee ?? null,
});

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
  type PracticeRow = FacilityRow & DfColumns;
  const rows = await db.getAllAsync<PracticeRow>(
    `SELECT f.*, ${DF_COLUMNS}
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
    ...edge(r),
  }));
}

/** A doctor practising at a facility, with that edge's own schedule. */
export interface FacilityDoctor {
  doctor: DoctorSync;
  is_primary: boolean;
  schedule: string | null;
  schedule_days: number | null;
  room: string | null;
  phone: string | null;
  verified_at: string | null;
  consultation_fee: number | null;
  /** True when the doctor has at least one active booking link on an active platform. */
  bookable: boolean;
}

/**
 * Doctors at a clinic - the reverse of getDoctorPractices over the same synced doctor_facility
 * edge, which the clinic page never used. Primary-practice doctors first, then bookable, then name.
 */
export async function getFacilityDoctors(facilityId: string): Promise<FacilityDoctor[]> {
  const db = await getDb();
  type Row = DoctorRow & DfColumns & { bookable: number };
  const rows = await db.getAllAsync<Row>(
    `SELECT d.*, ${DF_COLUMNS},
            EXISTS (SELECT 1 FROM booking_links bl
                      JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
                     WHERE bl.doctor_id = d.id AND bl.is_active = 1) AS bookable
       FROM doctor_facility df
       JOIN doctors d ON d.id = df.doctor_id
      WHERE df.facility_id = ?
        AND (d.status IS NULL OR d.status != 'excluded')
      ORDER BY (df.is_primary IS NULL OR df.is_primary = 0), bookable DESC, d.name`,
    facilityId,
  );
  return rows.map((r) => ({
    doctor: toDoctor(r),
    is_primary: toBool(r.df_is_primary) === true,
    ...edge(r),
    bookable: r.bookable === 1,
  }));
}

/** One way to book a dermatologist online: the doctor, their best booking link and its platform. */
export interface OnlineBookingOption {
  doctor: DoctorSync;
  url: string;
  fee: number | null;
  platformName: string;
  /** The link books a video consult (offers_online, 018), not just an in-clinic slot. */
  online: boolean;
  /** Metres to the doctor's nearest practice; null without a location or a mapped practice. */
  distance: number | null;
}

/**
 * Doctors with an active booking link on an active platform, one option per doctor. Each doctor's
 * best link is a video-consult one if any, then the cheapest known fee, then the best rating.
 * With `coords` the doctors come nearest-practice first (unmapped ones last); without, video
 * consults first, then fee and rating. `onlineOnly` keeps video-consult links only - the result
 * screen's offer for patients with no dermatologist within reach.
 */
export async function onlineBookingOptions({
  limit = 3,
  onlineOnly = false,
  coords = null,
}: { limit?: number; onlineOnly?: boolean; coords?: { latitude: number; longitude: number } | null } = {}): Promise<OnlineBookingOption[]> {
  const db = await getDb();
  type Row = DoctorRow & {
    bl_url: string; bl_fee: number | null; bl_rating: number | null; bl_online: number | null; p_name: string;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT d.*, bl.url AS bl_url, bl.consultation_fee AS bl_fee, bl.rating AS bl_rating,
            bl.offers_online AS bl_online, p.name AS p_name
       FROM booking_links bl
       JOIN telemedicine_platforms p ON p.id = bl.platform_id AND p.is_active = 1
       JOIN doctors d ON d.id = bl.doctor_id
      WHERE bl.is_active = 1 ${onlineOnly ? "AND bl.offers_online = 1" : ""}
        AND (d.status IS NULL OR d.status != 'excluded')
      ORDER BY (bl.offers_online = 1) DESC, (bl.consultation_fee IS NULL), bl.consultation_fee,
               (bl.rating IS NULL), bl.rating DESC`,
  );
  const dist = coords ? await nearestPracticeMeters(coords.latitude, coords.longitude) : null;
  const out: OnlineBookingOption[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      doctor: toDoctor(r),
      url: r.bl_url,
      fee: r.bl_fee ?? null,
      platformName: r.p_name,
      online: r.bl_online === 1,
      distance: dist?.get(r.id) ?? null,
    });
  }
  // Stable sort: equal distances (and the unmapped tail) keep the SQL order.
  if (dist) out.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  return out.slice(0, limit);
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
  // A link on a deactivated (or unsynced) platform rendered as an anonymous "Booking platform"
  // card pointing at a service SpotOn no longer vouches for - leave those out.
  return links
    .filter((l) => byId.get(l.platform_id as string)?.is_active === true)
    .map((l) => ({
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
    offers_online: toBool((l.offers_online as number) ?? null),
    created_at: l.created_at as string,
    updated_at: (l.updated_at as string) ?? null,
    platform: byId.get(l.platform_id as string) ?? null,
  }));
}

/** First bookable slot still in the future, as epoch ms. */
function futureSlotMs(link: BookingLinkSync): number | null {
  if (!link.next_available) return null;
  const at = new Date(link.next_available).getTime();
  return Number.isFinite(at) && at > Date.now() ? at : null;
}

/**
 * Best booking link first: a known upcoming slot beats none (soonest wins), then rating. Links
 * without a usable URL are dropped. Shared by the doctor page and the clinic page's Book button.
 */
export function rankBookingLinks<T extends BookingLinkSync>(links: T[]): T[] {
  return links
    .filter((l) => normalizeUrl(l.url) != null)
    .sort((a, b) => {
      const sa = futureSlotMs(a) ?? Infinity;
      const sb = futureSlotMs(b) ?? Infinity;
      if (sa !== sb) return sa - sb;
      return (b.rating ?? -1) - (a.rating ?? -1);
    });
}

/** The doctor's best booking link (see rankBookingLinks), or null. */
export async function getBestBookingLink(doctorId: string): Promise<BookingLinkWithPlatform | null> {
  return rankBookingLinks(await getDoctorBookingLinks(doctorId))[0] ?? null;
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

/** Row counts per table - useful for a sync/debug screen. */
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

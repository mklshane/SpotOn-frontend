export interface HoursPeriod {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

/** Hospital dermatology-department findings (hospitals only, else null). */
export interface DepartmentInfo {
  has_derm_department?: boolean | null;
  department_name?: string | null;
  opd_notes?: string | null;
}

export interface FacilitySync {
  id: string;
  name: string;
  type: string; // dermatology_clinic | private_hospital | government_hospital | medical_center
  // Legacy rows may still carry retired kinds (pathology_lab, oncology_center); those
  // are status='excluded' and filtered out before they ever reach a screen.
  facility_type: string | null; // advisory: medical | aesthetic | mixed | unknown
  address: string;
  city: string;
  province: string;
  region: string | null;
  latitude: number;
  longitude: number;
  services: string[];
  has_philhealth: boolean | null;
  fee_min: number | null;
  fee_max: number | null;
  status: string | null; // verified | unverified | pending | rejected | excluded
  phone: string | null;
  website: string | null;
  booking_url: string | null; // clinic-level online booking page
  google_maps_url: string | null;
  google_rating: number | null;
  weekday_hours: HoursPeriod | null;
  weekend_hours: HoursPeriod | null;
  description: string | null;
  photo_url: string | null;
  photo_attribution: string | null; // must be displayed with the photo (Google policy)
  department_info: DepartmentInfo | null;
  updated_at: string; // ISO 8601
  deleted_at?: string | null; // tombstone: purge locally (014)
}

export interface DoctorSync {
  id: string;
  name: string;
  title: string | null;
  pds_certified: boolean | null;
  specialties: string[];
  specialties_display: string | null;
  status: string | null; // 'excluded' rows are hidden from the directory (013)
  city: string | null;
  region: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  photo_url: string | null;
  description: string | null; // short professional bio
  updated_at: string;
  deleted_at?: string | null; // tombstone: purge locally (014)
}

/** Which facilities a doctor practises at (server table: doctor_facility). */
export interface DoctorFacilitySync {
  id: string;
  doctor_id: string;
  facility_id: string;
  is_primary: boolean | null;
  schedule: string | null; // free text, e.g. "Monday to Saturday | 10:00 AM - 07:00 PM"
  updated_at: string;
  deleted_at?: string | null; // tombstone: purge locally (014)
}

export interface BookingLinkSync {
  id: string;
  doctor_id: string;
  platform_id: string;
  url: string;
  consultation_fee: number | null;
  rating: number | null;
  review_count: number | null;
  is_introductory_fee: boolean;
  available_text: string | null;
  is_active: boolean;
  last_verified: string | null;
  next_available: string | null; // first bookable slot (ISO 8601)
  created_at: string;
  updated_at: string | null; // change timestamp (server cursor)
  deleted_at?: string | null; // tombstone: purge locally (014)
}

export interface PlatformSync {
  id: string;
  slug: string;
  name: string;
  website: string;
  booking_url: string | null;
  description: string | null;
  is_dedicated_derma: boolean;
  is_active: boolean;
  created_at: string;
  deleted_at?: string | null; // tombstone: purge locally (014)
}

export interface SyncCollection<T> {
  items: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface SyncResponse {
  synced_at: string;
  doctors: SyncCollection<DoctorSync>;
  facilities: SyncCollection<FacilitySync>;
  doctor_facilities: SyncCollection<DoctorFacilitySync>;
  booking_links: SyncCollection<BookingLinkSync>;
  telemedicine_platforms: SyncCollection<PlatformSync>;
}

export interface MetaResponse {
  services: string[];
  specialties: string[];
}

// Matches backend Literal in api/app/schemas/user.py.
export type Sex =
  | "male"
  | "female"
  | "intersex"
  | "other"
  | "prefer_not_to_say";

// Mirrors backend UserOut (GET /me).
export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  date_of_birth: string | null; // ISO date "YYYY-MM-DD"
  sex: string | null;
  fitzpatrick_skin_type: number | null;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  consent_data_privacy: boolean;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
}

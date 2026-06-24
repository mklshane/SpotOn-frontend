/**
 * Types mirroring the backend `/sync` payload (api/app/schemas/sync.py) and the
 * directory `/meta` endpoint. Kept in sync with the server schemas by hand.
 */

export interface HoursPeriod {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export interface FacilitySync {
  id: string;
  name: string;
  type: string; // dermatology_clinic | pathology_lab | private_hospital | ...
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
  google_maps_url: string | null;
  google_rating: number | null;
  weekday_hours: HoursPeriod | null;
  weekend_hours: HoursPeriod | null;
  updated_at: string; // ISO 8601
  // NOTE: booking_url / facility_type exist in the DB but are not yet exposed by
  // the /sync schema — add them server-side when needed.
}

export interface DoctorSync {
  id: string;
  name: string;
  title: string | null;
  pds_certified: boolean | null;
  specialties: string[];
  specialties_display: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  photo_url: string | null;
  updated_at: string;
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
  created_at: string;
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
  booking_links: SyncCollection<BookingLinkSync>;
  telemedicine_platforms: SyncCollection<PlatformSync>;
}

export interface MetaResponse {
  services: string[];
  specialties: string[];
}

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

// Matches backend Literal in api/app/schemas/user.py.
export type Sex = 'male' | 'female' | 'intersex' | 'other' | 'prefer_not_to_say';

// Mirrors backend UserOut (GET /me).
export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  date_of_birth: string | null; // ISO date "YYYY-MM-DD"
  sex: string | null;
  fitzpatrick_skin_type: number | null;
  is_active: boolean;
  is_verified: boolean;
  consent_data_privacy: boolean;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
}

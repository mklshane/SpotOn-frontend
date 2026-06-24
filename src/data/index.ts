/** Offline data layer — public surface for the rest of the app. */
export { getDb, getMeta, setMeta } from "./db";
export {
  runSync,
  getLastSyncedAt,
  needsInitialSync,
  type SyncResult,
} from "./sync";
export {
  listFacilities,
  countFacilities,
  getFacility,
  nearbyFacilities,
  distanceMeters,
  listDoctors,
  getDoctor,
  getDoctorBookingLinks,
  listPlatforms,
  getCounts,
  type FacilityQuery,
  type FacilityWithDistance,
  type DoctorQuery,
  type BookingLinkWithPlatform,
} from "./repositories";

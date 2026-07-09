/**
 * App configuration.
 *
 * API_BASE_URL points at the FastAPI backend. On a physical device, `localhost`
 * won't reach your dev machine — set EXPO_PUBLIC_API_BASE_URL to your machine's
 * LAN IP (e.g. http://192.168.1.50:8000) in a `.env` file. See `.env.example`.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");

/** Per-collection page size for /sync (server caps at 5000). */
export const SYNC_PAGE_LIMIT = 1000;

/** Local SQLite database file name. */
export const DB_NAME = "spoton.db";

/**
 * MapTiler key for the MapLibre style URL. Client-safe (restrict by bundle id in
 * MapTiler's dashboard) — set in `.env`, gitignored. Empty string when unset, which
 * `MAP_AVAILABLE` (src/lib/maplibre.ts) treats as "map not ready".
 */
export const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? "";

export const MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "";

/** Fallback map center/zoom when location is denied or unavailable — Metro Manila. */
export const MAP_DEFAULT = {
  latitude: 14.5995,
  longitude: 120.9842,
  zoom: 11,
} as const;

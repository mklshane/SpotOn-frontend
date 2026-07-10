import { MAP_STYLE_URL } from '@/config';
import { getMeta, setMeta } from '@/data/db';

import { MAP_AVAILABLE, OfflineManager } from './maplibre';

/** Not per-area — once any pack is downloaded, this is a permanent no-op for the app's lifetime. */
const DOWNLOADED_KEY = 'map_offline_pack_downloaded';
const RADIUS_M = 25_000;

let inFlight: Promise<void> | null = null;

/**
 * Downloads a bounded MapTiler tile pack (~25km, zoom 10-15) around `coords` so
 * the map renders offline afterwards. No-op if the native map isn't linked yet,
 * or if a pack has already been cached once (best-effort, not re-validated,
 * and not scoped to `coords` — only the first call in the app's lifetime ever
 * downloads anything). Concurrent calls share one in-flight attempt so rapid
 * successive location fixes can't kick off duplicate downloads.
 */
export function downloadAreaPack(coords: { latitude: number; longitude: number }): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run(coords).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(coords: { latitude: number; longitude: number }): Promise<void> {
  if (!MAP_AVAILABLE) return;
  if ((await getMeta(DOWNLOADED_KEY)) === '1') return;

  const dLat = RADIUS_M / 111_320;
  const dLng = RADIUS_M / (111_320 * Math.cos((coords.latitude * Math.PI) / 180) || 1);
  const bounds: [number, number, number, number] = [
    coords.longitude - dLng,
    coords.latitude - dLat,
    coords.longitude + dLng,
    coords.latitude + dLat,
  ];

  try {
    await OfflineManager.createPack(
      { mapStyle: MAP_STYLE_URL, bounds, minZoom: 10, maxZoom: 15 },
      () => {},
      () => {},
    );
    await setMeta(DOWNLOADED_KEY, '1');
  } catch (err) {
    // Best-effort — offline caching is a nice-to-have, never block the UI on it.
    console.warn('[map-offline] pack download failed', err);
  }
}

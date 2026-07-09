import { MAP_STYLE_URL } from '@/config';
import { getMeta, setMeta } from '@/data/db';

import { MAP_AVAILABLE, OfflineManager } from './maplibre';

const DOWNLOADED_KEY = 'map_offline_pack_downloaded';
const RADIUS_M = 25_000;
const RADIUS_DEG = RADIUS_M / 111_320;

/**
 * Downloads a bounded MapTiler tile pack (~25km, zoom 10-15) around `coords` so
 * the map renders offline afterwards. No-op if the native map isn't linked yet,
 * or if a pack has already been cached once (best-effort, not re-validated here).
 */
export async function downloadAreaPack(coords: { latitude: number; longitude: number }): Promise<void> {
  if (!MAP_AVAILABLE) return;
  if ((await getMeta(DOWNLOADED_KEY)) === '1') return;

  const bounds: [number, number, number, number] = [
    coords.longitude - RADIUS_DEG,
    coords.latitude - RADIUS_DEG,
    coords.longitude + RADIUS_DEG,
    coords.latitude + RADIUS_DEG,
  ];

  try {
    await OfflineManager.createPack(
      { mapStyle: MAP_STYLE_URL, bounds, minZoom: 10, maxZoom: 15 },
      () => {},
      () => {},
    );
    await setMeta(DOWNLOADED_KEY, '1');
  } catch {
    // Best-effort — offline caching is a nice-to-have, never block the UI on it.
  }
}

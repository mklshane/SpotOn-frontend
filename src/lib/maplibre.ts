/**
 * Guarded MapLibre re-exports. The native module isn't linked until a dev build
 * runs `expo prebuild`; importing it before then throws (it calls
 * `requireNativeComponent` at module-eval time). Every map render checks
 * `MAP_AVAILABLE` and falls back to a list instead of crashing the JS bundle —
 * add the MapTiler key and run one dev build and the map lights up with no code
 * change (see docs/DIRECTORY_SCREEN.md §7).
 */
import { MAP_STYLE_URL } from '@/config';

let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('@maplibre/maplibre-react-native');
} catch {
  mod = null;
}

export const MAP_AVAILABLE = Boolean(mod) && MAP_STYLE_URL.length > 0;

/** Aliased — `Map` is a JS global. */
export const MapLibreMap = mod?.Map;
export const Camera = mod?.Camera;
export const UserLocation = mod?.UserLocation;
export const GeoJSONSource = mod?.GeoJSONSource;
export const Layer = mod?.Layer;
export const Marker = mod?.Marker;
export const OfflineManager = mod?.OfflineManager;

export type { CameraRef, LngLat, LngLatBounds } from '@maplibre/maplibre-react-native';

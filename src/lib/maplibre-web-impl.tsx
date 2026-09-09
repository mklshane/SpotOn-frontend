/**
 * Web map, backed by maplibre-gl.
 *
 * `@maplibre/maplibre-react-native` is a native module, so on web `maplibre.ts` resolves
 * MAP_AVAILABLE to false and the directory falls back to a list with "the map needs a dev
 * build". Browsers don't need a dev build - maplibre-gl is the same renderer, so this module
 * reimplements the handful of declarative components ClinicMap.tsx uses on top of it and the
 * map simply appears.
 *
 * Only the surface ClinicMap and map-offline actually consume is implemented; widen
 * deliberately rather than trying to mirror the whole native API.
 */
import type * as MapLibre from 'maplibre-gl';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { MAP_STYLE_URL } from '@/config';

/** The style URL is the real gate on web - no native module to be missing. */
export const MAP_AVAILABLE = MAP_STYLE_URL.length > 0;

/**
 * maplibre-gl is loaded as a prebuilt UMD script at runtime, NOT imported.
 *
 * Metro cannot bundle it: maplibre parses tiles in a Web Worker, and through Metro's bundling of
 * the ESM build that worker never answers. The map then fetches its style, renders nothing,
 * requests zero tiles, and emits no error at all - a silently blank map that looks like a CSS or
 * sizing bug. Verified 2026-09-08: a map built straight from the bundled constructor into a bare
 * 300x300 div also never fired `load`, while the same style in the UMD build loaded immediately.
 *
 * scripts/copy-litert-wasm.mjs stages dist/maplibre-gl.{js,css} into public/maplibre/, so this is
 * same-origin - no CDN in the request path for a health app, and no COEP complications.
 */
const MAPLIBRE_JS = '/maplibre/maplibre-gl.js';
const MAPLIBRE_CSS = '/maplibre/maplibre-gl.css';

type MapLibreModule = typeof MapLibre;

let lib: MapLibreModule | null = null;
let libPromise: Promise<MapLibreModule> | null = null;

/**
 * The loaded library. Safe to call from any component rendered below <MapLibreMap>, because
 * those only mount once the map exists, which in turn requires the script to have loaded.
 */
function ml(): MapLibreModule {
  if (!lib) throw new Error('maplibre-gl is not loaded yet');
  return lib;
}

function loadMapLibre(): Promise<MapLibreModule> {
  if (!libPromise) {
    libPromise = new Promise<MapLibreModule>((resolve, reject) => {
      const existing = (globalThis as unknown as { maplibregl?: MapLibreModule }).maplibregl;
      if (existing) {
        lib = existing;
        return resolve(existing);
      }

      if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = MAPLIBRE_CSS;
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = MAPLIBRE_JS;
      script.async = true;
      script.onload = () => {
        const loaded = (globalThis as unknown as { maplibregl?: MapLibreModule }).maplibregl;
        if (loaded) {
          lib = loaded;
          resolve(loaded);
        } else {
          reject(new Error('maplibre-gl loaded but exposed no global'));
        }
      };
      script.onerror = () => reject(new Error(`could not load ${MAPLIBRE_JS}`));
      document.head.appendChild(script);
    }).catch((e) => {
      libPromise = null; // let a later mount retry
      throw e;
    });
  }
  return libPromise;
}

export type LngLat = [number, number];
export type LngLatBounds = [number, number, number, number];

export type CameraRef = {
  zoomTo: (zoom: number, opts?: { duration?: number }) => void;
  easeTo: (opts: { center?: LngLat; zoom?: number; duration?: number }) => void;
  fitBounds: (
    ne: LngLat | LngLatBounds,
    sw?: LngLat,
    padding?: number | number[],
    duration?: number,
  ) => void;
};

const MapCtx = createContext<MapLibre.Map | null>(null);
/** Layers declared inside a <GeoJSONSource> need to know which source to bind to. */
const SourceCtx = createContext<string | null>(null);

type MapProps = {
  style?: unknown;
  mapStyle?: string;
  logo?: boolean;
  compass?: boolean;
  scaleBar?: boolean;
  onPress?: () => void;
  onRegionDidChange?: (e: { nativeEvent: { zoom: number } }) => void;
  children?: ReactNode;
};

export function MapLibreMap({
  mapStyle,
  compass = false,
  onPress,
  onRegionDidChange,
  children,
}: MapProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapLibre.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    let m: MapLibre.Map | null = null;
    let ro: ResizeObserver | null = null;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !host.current) return;
        m = new maplibregl.Map({
          container: host.current,
          style: mapStyle || MAP_STYLE_URL,
          center: [0, 0],
          zoom: 2,
          attributionControl: false,
        });
        if (compass) m.addControl(new maplibregl.NavigationControl({ showZoom: false }), 'top-right');
        // Style/tile failures are silent otherwise - a blank map with no clue why.
        m.on('error', (e) => console.warn('[map]', (e as { error?: Error }).error?.message ?? e));
        // Children mount against a live style; adding a source before 'load' throws.
        m.on('load', () => {
          // react-native-web lays the container out after the map is constructed, so the map can
          // come up believing it has no size - in which case it renders the style background and
          // never requests a single tile.
          m?.resize();
          if (!cancelled) setMap(m);
        });
        // Keep it correct through orientation changes and the sheet resizing the map pane.
        ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m?.resize()) : null;
        if (ro && host.current) ro.observe(host.current);
      })
      .catch((e) => console.warn('[map] maplibre-gl failed to load', e));

    return () => {
      cancelled = true;
      ro?.disconnect();
      setMap(null);
      m?.remove();
    };
    // Style/compass changes would mean a different map; remount rather than mutate.
  }, [mapStyle, compass]);

  useEffect(() => {
    if (!map) return;
    const press = () => onPress?.();
    const moved = () => onRegionDidChange?.({ nativeEvent: { zoom: map.getZoom() } });
    map.on('click', press);
    map.on('moveend', moved);
    return () => {
      map.off('click', press);
      map.off('moveend', moved);
    };
  }, [map, onPress, onRegionDidChange]);

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <MapCtx.Provider value={map}>{map ? children : null}</MapCtx.Provider>
    </div>
  );
}

export const Camera = forwardRef<CameraRef, { initialViewState?: { center: LngLat; zoom: number } }>(
  function Camera({ initialViewState }, ref) {
    const map = useContext(MapCtx);
    const applied = useRef(false);

    useEffect(() => {
      if (!map || !initialViewState || applied.current) return;
      applied.current = true; // "initial" - later prop changes must not yank the user's view
      map.jumpTo({ center: initialViewState.center, zoom: initialViewState.zoom });
    }, [map, initialViewState]);

    useImperativeHandle(
      ref,
      (): CameraRef => ({
        zoomTo: (zoom, opts) => map?.easeTo({ zoom, duration: opts?.duration ?? 300 }),
        easeTo: (opts) =>
          map?.easeTo({ center: opts.center, zoom: opts.zoom, duration: opts.duration ?? 300 }),
        fitBounds: (ne, sw, padding, duration) => {
          if (!map) return;
          // Native takes (ne, sw); a 4-tuple [w,s,e,n] is also accepted here for convenience.
          const bounds = Array.isArray(ne) && ne.length === 4
            ? new (ml().LngLatBounds)([ne[0], ne[1]], [ne[2], ne[3]])
            : new (ml().LngLatBounds)(sw as LngLat, ne as LngLat);
          const pad = typeof padding === 'number' ? padding : 40;
          map.fitBounds(bounds, { padding: pad, duration: duration ?? 400 });
        },
      }),
      [map],
    );
    return null;
  },
);

/** Blue dot for the browser's geolocation, mirroring the native UserLocation puck. */
export function UserLocation() {
  const map = useContext(MapCtx);
  useEffect(() => {
    if (!map || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const el = document.createElement('div');
    el.style.cssText =
      'width:14px;height:14px;border-radius:50%;background:#2E7DF7;border:2px solid #fff;box-shadow:0 0 0 4px rgba(46,125,247,0.25);';
    const marker = new (ml().Marker)({ element: el });
    let placed = false;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        marker.setLngLat([pos.coords.longitude, pos.coords.latitude]);
        if (!placed) {
          marker.addTo(map);
          placed = true;
        }
      },
      () => {}, // permission denied is normal; the map is still useful without the dot
      { enableHighAccuracy: false, maximumAge: 30_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(watch);
      marker.remove();
    };
  }, [map]);
  return null;
}

type SourceProps = {
  id: string;
  data: GeoJSON.FeatureCollection | GeoJSON.Feature;
  onPress?: (e: {
    stopPropagation?: () => void;
    nativeEvent?: { features?: GeoJSON.Feature[] };
  }) => void;
  children?: ReactNode;
};

export function GeoJSONSource({ id, data, onPress, children }: SourceProps) {
  const map = useContext(MapCtx);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data as never });
    return () => {
      // Layers must go before their source, or removeSource throws.
      for (const layer of map.getStyle()?.layers ?? []) {
        if ((layer as { source?: string }).source === id) {
          try { map.removeLayer(layer.id); } catch { /* style already torn down */ }
        }
      }
      try { map.removeSource(id); } catch { /* ditto */ }
    };
    // `data` is deliberately excluded: it is pushed by setData below, and rebuilding the
    // source on every data change would drop the layers bound to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);

  useEffect(() => {
    const src = map?.getSource(id) as MapLibre.GeoJSONSource | undefined;
    src?.setData(data as never);
  }, [map, id, data]);

  useEffect(() => {
    if (!map || !onPress) return;
    const handler = (e: MapLibre.MapMouseEvent) => {
      const features = map
        .queryRenderedFeatures(e.point)
        .filter((f: MapLibre.MapGeoJSONFeature) => (f as { source?: string }).source === id);
      if (!features.length) return;
      // maplibre has no stopPropagation on the map click; the caller's own guard flag handles it.
      onPress({
        stopPropagation: () => {},
        nativeEvent: { features: features as unknown as GeoJSON.Feature[] },
      });
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, id, onPress]);

  // Children render immediately; each Layer waits for this source to exist on its own, because
  // React runs child effects BEFORE the parent's - so the source is not added yet at this point.
  return <SourceCtx.Provider value={id}>{children}</SourceCtx.Provider>;
}

type LayerProps = {
  id: string;
  type: 'circle' | 'symbol' | 'line' | 'fill';
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

export function Layer({ id, type, filter, paint, layout }: LayerProps) {
  const map = useContext(MapCtx);
  const source = useContext(SourceCtx);

  useEffect(() => {
    if (!map || !source) return;
    let cancelled = false;

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    const add = () => {
      if (cancelled || map.getLayer(id) || !map.getSource(source)) return false;
      // Only include optional keys when they have a value: maplibre validates the spec and
      // rejects `layout: undefined` outright ("object expected, undefined found"), which
      // silently drops the layer - the pins just never appear.
      const spec: Record<string, unknown> = { id, type, source };
      if (paint) spec.paint = paint;
      if (layout) spec.layout = layout;
      if (filter) spec.filter = filter;
      map.addLayer(spec as never);
      map.on('mouseenter', id, onEnter); // pins should feel clickable
      map.on('mouseleave', id, onLeave);
      return true;
    };

    // React runs this child effect before the parent GeoJSONSource has added the source, so on
    // the first pass `add` is a no-op and we wait for maplibre to tell us the source exists.
    const added = add();
    if (!added) map.on('sourcedata', add);

    return () => {
      cancelled = true;
      map.off('sourcedata', add);
      try {
        if (map.getLayer(id)) {
          map.off('mouseenter', id, onEnter);
          map.off('mouseleave', id, onLeave);
          map.removeLayer(id);
        }
      } catch { /* style gone */ }
    };
    // paint/layout/filter are deliberately excluded: they are pushed imperatively below, so
    // re-adding the layer for a colour change would needlessly rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, source, id, type]);

  useEffect(() => {
    if (!map || !map.getLayer(id)) return;
    if (filter) map.setFilter(id, filter as never);
    for (const [k, v] of Object.entries(paint ?? {})) map.setPaintProperty(id, k as never, v as never);
  }, [map, id, filter, paint]);

  return null;
}

type MarkerProps = {
  lngLat: LngLat;
  anchor?: string;
  offset?: [number, number];
  children?: ReactNode;
};

export function Marker({ lngLat, anchor = 'center', offset, children }: MarkerProps) {
  const map = useContext(MapCtx);
  // One stable DOM node per marker, portalled into so React keeps owning the subtree.
  const el = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const d = document.createElement('div');
    // Without this the marker swallows drags meant for the map.
    d.style.pointerEvents = 'auto';
    return d;
  }, []);

  useEffect(() => {
    if (!map || !el) return;
    const marker = new (ml().Marker)({
      element: el,
      anchor: anchor as MapLibre.PositionAnchor,
      offset,
    })
      .setLngLat(lngLat)
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, el, anchor, offset, lngLat]);

  return el ? createPortal(children, el) : null;
}

/**
 * Offline tile packs are a native-only feature. The browser's HTTP cache already keeps recently
 * viewed tiles, so this no-ops rather than pretending to download a pack - map-offline.ts treats
 * a rejection as best-effort and only logs it.
 */
export const OfflineManager = {
  async createPack(): Promise<void> {
    // Intentionally does nothing on web.
  },
};

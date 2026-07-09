import { useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { MAP_DEFAULT, MAP_STYLE_URL } from '@/config';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  MAP_AVAILABLE,
  MapLibreMap,
  Marker,
  UserLocation,
} from '@/lib/maplibre';

import { ClinicPreviewCard } from './ClinicPreviewCard';

export type ClinicMapProps = {
  facilities: (FacilitySync | FacilityWithDistance)[];
  coords: { latitude: number; longitude: number } | null;
  selectedId: string | null;
  onSelectFacility: (id: string | null) => void;
  /** Screen-space distance from the bottom to keep floating controls clear of the collapsed sheet. */
  bottomInset: number;
};

const SCREEN_W = Dimensions.get('window').width;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
// A same-tap on a pin bubbles from GeoJSONSource.onPress up to Map.onPress despite
// stopPropagation() (native bubbling quirk) — this window suppresses the bubbled
// "clear selection" call. See docs/DIRECTORY_SCREEN.md §5 "Pin -> preview card".
const SOURCE_PRESS_GUARD_MS = 250;

export function ClinicMap({ facilities, coords, selectedId, onSelectFacility, bottomInset }: ClinicMapProps) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  const lastSourcePressAt = useRef(0);
  const [zoom, setZoom] = useState(coords ? 13 : MAP_DEFAULT.zoom);

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.id === selectedId) ?? null,
    [facilities, selectedId],
  );

  const featureCollection = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: facilities.map((f) => ({
        type: 'Feature' as const,
        properties: { id: f.id },
        geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] },
      })),
    }),
    [facilities],
  );

  const nearestArea = useMemo(() => {
    const first = facilities[0];
    return first ? `${first.city}, ${first.province}` : null;
  }, [facilities]);

  const applyZoom = (delta: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    cameraRef.current?.zoomTo(next, { duration: 200 });
    setZoom(next);
  };

  if (!MAP_AVAILABLE) {
    return (
      <View style={[styles.fallback, { backgroundColor: theme.elementBg }]}>
        <Icon name="building.2.fill" size={32} tintColor={theme.muted} />
        <ThemedText type="footnote" themeColor="muted" style={styles.fallbackText}>
          The map needs a dev build to render — clinics still list below.
        </ThemedText>
      </View>
    );
  }

  const initialCenter: [number, number] = coords
    ? [coords.longitude, coords.latitude]
    : [MAP_DEFAULT.longitude, MAP_DEFAULT.latitude];

  return (
    <View style={styles.fill}>
      <MapLibreMap
        style={styles.fill}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        compass={false}
        scaleBar={false}
        onPress={() => {
          if (Date.now() - lastSourcePressAt.current < SOURCE_PRESS_GUARD_MS) return;
          onSelectFacility(null);
        }}>
        <Camera ref={cameraRef} initialViewState={{ center: initialCenter, zoom }} />
        <UserLocation />

        <GeoJSONSource
          id="clinics"
          data={featureCollection}
          onPress={(e: { stopPropagation?: () => void; nativeEvent?: { features?: GeoJSON.Feature[] } }) => {
            lastSourcePressAt.current = Date.now();
            e.stopPropagation?.();
            const feature = e.nativeEvent?.features?.[0];
            const id = feature?.properties?.id as string | undefined;
            if (id) onSelectFacility(id);
          }}>
          <Layer
            type="circle"
            id="clinics-pins"
            filter={['!=', ['get', 'id'], selectedId ?? '']}
            paint={{
              'circle-radius': 9,
              'circle-color': theme.brand,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
          <Layer
            type="circle"
            id="clinics-pin-selected"
            filter={['==', ['get', 'id'], selectedId ?? '']}
            paint={{
              'circle-radius': 13,
              'circle-color': theme.brandPressed,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>

        {selectedFacility ? (
          <Marker lngLat={[selectedFacility.longitude, selectedFacility.latitude]} anchor="bottom" offset={[0, -18]}>
            <View style={{ width: Math.min(SCREEN_W - 32, 320) }}>
              <ClinicPreviewCard facility={selectedFacility} onClose={() => onSelectFacility(null)} />
            </View>
          </Marker>
        ) : null}
      </MapLibreMap>

      <View style={[styles.zoomStack, { bottom: bottomInset, backgroundColor: theme.surface }]}>
        <Pressable onPress={() => applyZoom(1)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in">
          <Icon name="plus" size={18} tintColor={theme.text} />
        </Pressable>
        <View style={[styles.zoomDivider, { backgroundColor: theme.hairline }]} />
        <Pressable onPress={() => applyZoom(-1)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out">
          <Icon name="minus" size={18} tintColor={theme.text} />
        </Pressable>
      </View>

      {nearestArea ? (
        <View style={[styles.areaChip, { bottom: bottomInset, backgroundColor: theme.surface }]}>
          <Icon name="mappin.circle.fill" size={14} tintColor={theme.brand} />
          <ThemedText type="caption" themeColor="text" style={styles.areaText} numberOfLines={1}>
            {nearestArea}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingHorizontal: Space.xxxl },
  fallbackText: { textAlign: 'center' },
  zoomStack: {
    position: 'absolute',
    right: Space.base,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Elevation.md,
  },
  zoomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth },
  areaChip: {
    position: 'absolute',
    left: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 32,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    maxWidth: SCREEN_W * 0.5,
    ...Elevation.sm,
  },
  areaText: { fontWeight: '600' },
});

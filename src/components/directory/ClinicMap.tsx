import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { MAP_DEFAULT, MAP_STYLE_URL } from "@/config";
import { Elevation, Radius, Space } from "@/constants/theme";
import type { FacilityWithDistance } from "@/data/repositories";
import { useTheme } from "@/hooks/use-theme";
import {
  Camera,
  GeoJSONSource,
  Layer,
  MAP_AVAILABLE,
  MapLibreMap,
  Marker,
  UserLocation,
  type CameraRef,
} from "@/lib/maplibre";

import { ClinicPreviewCard } from "./ClinicPreviewCard";

export type ClinicMapProps = {
  facilities: (FacilitySync | FacilityWithDistance)[];
  coords: { latitude: number; longitude: number } | null;
  selectedId: string | null;
  onSelectFacility: (id: string | null) => void;
  /**
   * Live top-edge Y position (screen space) of the clinics bottom sheet, kept
   * updated by `BottomSheet`'s own `animatedPosition` as it's dragged or
   * snapped. Drives the floating controls' `bottom` offset so they track the
   * sheet's actual current position rather than a fixed collapsed-height guess.
   */
  sheetPosition: SharedValue<number>;
  /** The active search query — a change here (once `facilities` catches up) re-centers the camera on the results. */
  query: string;
};

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const DEVICE_LOCATION_ZOOM = 13;
// Breathing room kept between the floating controls and the sheet's top edge.
const FLOATING_CONTROLS_GAP = -30;

export function ClinicMap({
  facilities,
  coords,
  selectedId,
  onSelectFacility,
  sheetPosition,
  query,
}: ClinicMapProps) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  // Re-center on search results: fit the camera once per distinct non-empty query,
  // as soon as that query's results have arrived — tracked by the query string
  // itself so it converges correctly regardless of how many renders land in
  // between. Filter/sort-only changes reuse the same query and are skipped
  // since it's already marked fit.
  //
  // `facilities` (ClinicsView's async fetch result) and `query` (synchronous
  // debounced state) land on DIFFERENT renders — on the render where `query`
  // first changes, `facilities` is still the PREVIOUS query's stale results.
  // Fitting to those under the new query's name would both show the wrong
  // place and mark the new query as "already fit", permanently blocking the
  // real (possibly empty) results from ever correcting it. `prevQueryRef`
  // detects that render and defers fitting to the next one, where `facilities`
  // has caught up.
  const lastFitQueryRef = useRef<string | null>(null);
  const prevQueryRef = useRef(query);
  // Tracks whether we've already recentered on the device's GPS fix once it
  // resolves. `coords` starts null and arrives asynchronously (permission
  // prompt + GPS fix) — well after the map has already mounted with the
  // `MAP_DEFAULT` (Manila) fallback baked into `initialViewState`, which is a
  // one-time seed, not a reactive prop. Without this effect, a resolved
  // `coords` never has any path back into the camera.
  const hasCenteredOnDeviceRef = useRef(false);
  // A same-tap on a pin bubbles from GeoJSONSource.onPress up to Map.onPress despite
  // stopPropagation() (native bubbling quirk) — GeoJSONSource fires first (it's the
  // child), so it flags the bubble here for Map.onPress to consume and ignore, exactly
  // once, regardless of how long the bubble takes to arrive. See
  // docs/DIRECTORY_SCREEN.md §5 "Pin -> preview card".
  const suppressNextMapPress = useRef(false);
  const [zoom, setZoom] = useState(
    coords ? DEVICE_LOCATION_ZOOM : MAP_DEFAULT.zoom,
  );

  useEffect(() => {
    const trimmed = query.trim();
    const queryJustChanged = query !== prevQueryRef.current;
    prevQueryRef.current = query;

    if (!trimmed) {
      lastFitQueryRef.current = null; // cleared search — the next search should fit again
      return;
    }
    if (lastFitQueryRef.current === trimmed) return;
    if (queryJustChanged) return; // facilities is still the previous query's — wait for it to catch up
    lastFitQueryRef.current = trimmed;

    if (facilities.length === 0) {
      // A confirmed-empty result for this exact query — reset to a wide view
      // instead of leaving the camera parked wherever an earlier keystroke's
      // (different, non-empty) search last left it, which reads as "recentered
      // to the wrong place" rather than "no clinics found here".
      cameraRef.current?.easeTo({
        center: [MAP_DEFAULT.longitude, MAP_DEFAULT.latitude],
        zoom: 5,
        duration: 600,
      });
      return;
    }

    if (facilities.length === 1) {
      const [only] = facilities;
      cameraRef.current?.easeTo({
        center: [only.longitude, only.latitude],
        zoom: 14,
        duration: 600,
      });
      return;
    }

    const lats = facilities.map((f) => f.latitude);
    const lngs = facilities.map((f) => f.longitude);
    const bounds: [number, number, number, number] = [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
    cameraRef.current?.fitBounds(bounds, {
      padding: { top: 80, right: 60, bottom: 80, left: 60 },
      duration: 600,
    });
  }, [query, facilities]);

  // Recenter on the device's real GPS fix as soon as it resolves. Runs at
  // most once — after that, the user (or a search) owns the camera and this
  // shouldn't fight them for it. Skipped if a search is already active/fit,
  // so a location fix that resolves late doesn't yank the map away from
  // search results the user is already looking at.
  useEffect(() => {
    if (!coords || hasCenteredOnDeviceRef.current) return;
    if (query.trim() || lastFitQueryRef.current) return;
    hasCenteredOnDeviceRef.current = true;
    cameraRef.current?.easeTo({
      center: [coords.longitude, coords.latitude],
      zoom: DEVICE_LOCATION_ZOOM,
      duration: 600,
    });
    setZoom(DEVICE_LOCATION_ZOOM);
  }, [coords, query]);

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.id === selectedId) ?? null,
    [facilities, selectedId],
  );

  // Distance from the screen bottom up to the sheet's current top edge, plus
  // a fixed gap — recomputed on the UI thread every time `sheetPosition`
  // changes, so the controls track the sheet through drags, not just settled
  // snap points.
  const floatingControlsStyle = useAnimatedStyle(() => ({
    bottom: SCREEN_H - sheetPosition.value + FLOATING_CONTROLS_GAP,
  }));

  const featureCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: facilities.map((f) => ({
        type: "Feature" as const,
        properties: { id: f.id },
        geometry: {
          type: "Point" as const,
          coordinates: [f.longitude, f.latitude],
        },
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
        <ThemedText
          type="footnote"
          themeColor="muted"
          style={styles.fallbackText}
        >
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
          Keyboard.dismiss();
          if (suppressNextMapPress.current) {
            suppressNextMapPress.current = false;
            return;
          }
          onSelectFacility(null);
        }}
        onRegionDidChange={(e: { nativeEvent: { zoom: number } }) =>
          setZoom(e.nativeEvent.zoom)
        }
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: initialCenter, zoom }}
        />
        <UserLocation />

        <GeoJSONSource
          id="clinics"
          data={featureCollection}
          onPress={(e: {
            stopPropagation?: () => void;
            nativeEvent?: { features?: GeoJSON.Feature[] };
          }) => {
            suppressNextMapPress.current = true;
            e.stopPropagation?.();
            const feature = e.nativeEvent?.features?.[0];
            const id = feature?.properties?.id as string | undefined;
            if (id) onSelectFacility(id);
          }}
        >
          <Layer
            type="circle"
            id="clinics-pins"
            filter={["!=", ["get", "id"], selectedId ?? ""]}
            paint={{
              "circle-radius": 9,
              "circle-color": theme.brand,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#FFFFFF",
            }}
          />
          <Layer
            type="circle"
            id="clinics-pin-selected"
            filter={["==", ["get", "id"], selectedId ?? ""]}
            paint={{
              "circle-radius": 13,
              "circle-color": theme.brandPressed,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#FFFFFF",
            }}
          />
        </GeoJSONSource>

        {selectedFacility ? (
          <Marker
            lngLat={[selectedFacility.longitude, selectedFacility.latitude]}
            anchor="bottom"
            offset={[0, -18]}
          >
            <View style={{ width: Math.min(SCREEN_W - 32, 320) }}>
              <ClinicPreviewCard
                facility={selectedFacility}
                onClose={() => onSelectFacility(null)}
              />
            </View>
          </Marker>
        ) : null}
      </MapLibreMap>

      <Animated.View
        style={[
          styles.zoomStack,
          floatingControlsStyle,
          { backgroundColor: theme.surface },
        ]}
      >
        <Pressable
          onPress={() => applyZoom(1)}
          style={styles.zoomBtn}
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
        >
          <Icon name="plus" size={18} tintColor={theme.text} />
        </Pressable>
        <View
          style={[styles.zoomDivider, { backgroundColor: theme.hairline }]}
        />
        <Pressable
          onPress={() => applyZoom(-1)}
          style={styles.zoomBtn}
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
        >
          <Icon name="minus" size={18} tintColor={theme.text} />
        </Pressable>
      </Animated.View>

      {nearestArea ? (
        <Animated.View
          style={[
            styles.areaChip,
            floatingControlsStyle,
            { backgroundColor: theme.surface },
          ]}
        >
          <Icon name="mappin.circle.fill" size={14} tintColor={theme.brand} />
          <ThemedText
            type="caption"
            themeColor="text"
            style={styles.areaText}
            numberOfLines={1}
          >
            {nearestArea}
          </ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Space.sm,
    paddingHorizontal: Space.xxxl,
  },
  fallbackText: { textAlign: "center" },
  zoomStack: {
    position: "absolute",
    right: Space.base,
    borderRadius: Radius.md,
    overflow: "hidden",
    ...Elevation.md,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomDivider: { height: StyleSheet.hairlineWidth },
  areaChip: {
    position: "absolute",
    left: Space.base,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.xs,
    height: 32,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    maxWidth: SCREEN_W * 0.5,
    ...Elevation.sm,
  },
  areaText: { fontWeight: "600" },
});

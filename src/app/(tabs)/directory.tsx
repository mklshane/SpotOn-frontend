import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicsView } from "@/components/directory/ClinicsView";
import {
  DirectorySegments,
  type DirectorySegment,
} from "@/components/directory/DirectorySegments";
import { DoctorsView } from "@/components/directory/DoctorsView";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { SearchBar } from "@/components/ui/search-bar";
import { Radius, Space } from "@/constants/theme";
import { needsInitialSync, needsReconcile, runSync } from "@/data/sync";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useTheme } from "@/hooks/use-theme";

export default function DirectoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useConnectivity();

  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<DirectorySegment>("clinics");
  const [query, setQuery] = useState("");

  // Allow deep links like /directory?segment=doctors to land on a segment.
  useEffect(() => {
    if (params.segment === "doctors" || params.segment === "clinics")
      setSegment(params.segment);
  }, [params.segment]);
  const debouncedQuery = useDebouncedValue(query, 250);
  const [overlayH, setOverlayH] = useState(0);

  useEffect(() => {
    (async () => {
      if (await needsInitialSync()) {
        // First-ever sync — if this fails offline-first screens fall back to an
        // empty local DB with no distinct "sync failed" signal, so at least log it.
        await runSync({ full: true }).catch((err) =>
          console.warn("[directory] initial sync failed", err),
        );
      } else if (await needsReconcile()) {
        // One-off full pass so an install that predates delete-sweeping drops
        // rows removed server-side (deleted pathology labs were still listed).
        runSync({ full: true }).catch((err) =>
          console.warn("[directory] reconcile sync failed", err),
        );
      } else {
        runSync().catch(() => {});
      }
    })();
  }, []);

  const onOverlayLayout = (e: LayoutChangeEvent) =>
    setOverlayH(e.nativeEvent.layout.height);

  // Rendered as a prop rather than a sibling: it needs to sit INSIDE each
  // view's own stacking order (between its map and its bottom sheet), not
  // beside it — see the comment on `ClinicsViewProps.header` for why zIndex
  // alone can't make a sheet cover a sibling of its parent.
  const header = (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingTop: insets.top }]}
      onLayout={onOverlayLayout}
    >
      <DirectorySegments
        value={segment}
        onChange={(next) => {
          setSegment(next);
          setQuery("");
        }}
      />
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={
          segment === "clinics" ? "Search clinics or area…" : "Search doctors…"
        }
        elevation="md"
      />
      {!isOnline ? (
        <View
          style={[styles.offlineChip, { backgroundColor: theme.brandTint }]}
        >
          <Icon name="wifi.slash" size={12} tintColor={theme.brand} />
          <ThemedText
            type="caption"
            themeColor="brand"
            style={styles.offlineLabel}
          >
            Offline — showing cached results
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {segment === "clinics" ? (
        <ClinicsView
          query={debouncedQuery}
          topInset={overlayH}
          header={header}
        />
      ) : (
        <DoctorsView query={debouncedQuery} topInset={overlayH} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Space.xl,
    gap: Space.md,
    paddingBottom: Space.md,
  },
  offlineChip: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  offlineLabel: { fontWeight: "600" },
});

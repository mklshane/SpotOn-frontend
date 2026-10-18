import { t, useLocale } from '@/lib/i18n';
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicsView } from "@/components/directory/ClinicsView";
import {
  DirectorySegments,
  type DirectorySegment,
} from "@/components/directory/DirectorySegments";
import { DoctorsView } from "@/components/directory/DoctorsView";
import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { Entrance, EntranceProvider } from "@/components/ui/entrance";
import { SearchBar } from "@/components/ui/search-bar";
import { Radius, Space } from "@/constants/theme";
import { needsInitialSync, needsReconcile, runSync } from "@/data/sync";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocation } from "@/hooks/use-location";
import { isConcern } from "@/lib/concerns";
import { flushPendingReports } from "@/lib/directory-reports";
import { useTheme } from "@/hooks/use-theme";

export default function DirectoryScreen() {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useConnectivity();

  // One GPS request for both tabs (each used to run its own).
  const location = useLocation();
  const params = useLocalSearchParams<{ segment?: string; concern?: string; at?: string }>();
  // /directory?concern=skin_cancer_mole_check&at=<ms> - a scan result opens the directory
  // pre-filtered; `at` differs per visit so the concern re-applies even after being cleared.
  const initialConcern = isConcern(params.concern) ? params.concern : null;
  const [segment, setSegment] = useState<DirectorySegment>("clinics");
  const [query, setQuery] = useState("");

  // Deep links like /directory?segment=doctors land on a segment; a concern link (scan result)
  // lands on Clinics. Keyed on the link's `at` nonce too, so a second scan switches back even if
  // the user moved to the Dermatologists tab. Adjusted during render, not in an effect.
  const linkKey = `${params.segment ?? ""}:${initialConcern ?? ""}:${params.at ?? ""}`;
  const [appliedLink, setAppliedLink] = useState("::");
  if (linkKey !== appliedLink) {
    setAppliedLink(linkKey);
    if (params.segment === "doctors" || params.segment === "clinics") setSegment(params.segment);
    else if (initialConcern) setSegment("clinics");
  }
  const debouncedQuery = useDebouncedValue(query, 250);
  const [overlayH, setOverlayH] = useState(0);

  // Bumped whenever a sync settles, so the lists re-read SQLite. They query once on mount, and the
  // first-ever sync starts at that same moment: without this a fresh install showed "No clinics
  // found" until the tab was reopened, and later syncs never reached an open list. A failed sync
  // bumps it too - the pages it did apply are valid rows.
  const [syncVersion, setSyncVersion] = useState(0);
  const synced = () => setSyncVersion((v) => v + 1);
  // Surfaced to the lists so an empty DB after a failed download says "not downloaded yet - Try
  // again" instead of "No clinics found. Try a different search or filter."
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncing, setSyncing] = useState(true);

  const startSync = useCallback(async () => {
    setSyncFailed(false);
    setSyncing(true);
    const full = (await needsInitialSync()) || (await needsReconcile());
    return runSync(full ? { full: true } : undefined)
      // A sync that reached the server means we're online: send reports queued while offline.
      .then(() => flushPendingReports().catch(() => 0))
      .catch((err) => {
        // First-ever / reconcile passes are full syncs: if this fails offline-first screens fall
        // back to an empty local DB, so it has to reach the UI, not just the console.
        console.warn("[directory] sync failed", err);
        setSyncFailed(true);
      })
      .finally(() => {
        setSyncing(false);
        synced();
      });
  }, []);

  useEffect(() => {
    // Initial sync: plain promise chain (not startSync) so no state is set synchronously here.
    (async () => {
      const full = (await needsInitialSync()) || (await needsReconcile());
      await runSync(full ? { full: true } : undefined)
        .then(() => flushPendingReports().catch(() => 0))
        .catch((err) => {
          console.warn("[directory] sync failed", err);
          setSyncFailed(true);
        });
      setSyncing(false);
      synced();
    })();
  }, []);
  const retrySync = useCallback(() => {
    startSync();
  }, [startSync]);

  const onOverlayLayout = (e: LayoutChangeEvent) =>
    setOverlayH(e.nativeEvent.layout.height);

  // Rendered as a prop rather than a sibling: for ClinicsView it needs to sit
  // INSIDE its own stacking order (between its map and its bottom sheet), not
  // beside it - see the comment on `ClinicsViewProps.header` for why zIndex
  // alone can't make a sheet cover a sibling of its parent. DoctorsView has
  // no map/sheet to stack against, but it still takes the same prop so the
  // header (and its onLayout, which drives `overlayH`) stays mounted and
  // measured on both segments instead of vanishing when segment !== 'clinics'.
  const header = (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingTop: insets.top + (Platform.OS === "web" ? Space.xl : 0) }]}
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
          segment === "clinics" ? t("Search clinic, city or doctor…") : t("Search dermatologists…")
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
            {t("Offline - showing cached results")}</ThemedText>
        </View>
      ) : null}
    </View>
  );

  return (
    <EntranceProvider screen="directory">
      <Entrance index={0} style={styles.fill}>
      <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {/* Switching back to Clinics doesn't refetch GPS from scratch and visibly pan from a default location.*/}
      <View
        style={[
          StyleSheet.absoluteFill,
          segment !== "clinics" && styles.hidden,
        ]}
      >
        <ClinicsView
          query={segment === "clinics" ? debouncedQuery : ""}
          syncFailed={syncFailed}
          syncing={syncing}
          onRetrySync={retrySync}
          syncVersion={syncVersion}
          topInset={overlayH}
          header={header}
          initialConcern={initialConcern}
          initialConcernKey={params.at ?? null}
          coords={location.coords}
          locationStatus={location.status}
          onRequestLocation={location.retry}
        />
      </View>
      <View
        style={[
          StyleSheet.absoluteFill,
          segment !== "doctors" && styles.hidden,
        ]}
      >
        <DoctorsView
          query={segment === "doctors" ? debouncedQuery : ""}
          syncFailed={syncFailed}
          syncing={syncing}
          onRetrySync={retrySync}
          syncVersion={syncVersion}
          topInset={overlayH}
          header={header}
          coords={location.coords}
        />
      </View>
      </View>
      </Entrance>
    </EntranceProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: "none" },
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

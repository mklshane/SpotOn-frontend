import { t, useLocale } from '@/lib/i18n';
import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { ListState } from "@/components/ui/list-state";
import { Elevation, Radius, Space } from "@/constants/theme";
import {
  distanceMeters,
  listFacilities,
  type FacilityWithDistance,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useLocation } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { humanizeTag } from "@/lib/format";
import { isOpenNow } from "@/lib/hours";
import { downloadAreaPack } from "@/lib/map-offline";
import NetInfo from "@react-native-community/netinfo";

import { ClinicCard } from "./ClinicCard";
import { ClinicMap } from "./ClinicMap";

export type ClinicsViewProps = {
  query: string;
  /** Changes when a directory sync completes; the lists re-read the local DB on it. */
  syncVersion?: number;
  topInset: number;
  /**
   * The search bar / segmented-control overlay, rendered by the parent
   * screen but placed here - between the map and the bottom sheet - so
   * normal paint order (not zIndex) makes the sheet cover it once it grows
   * tall enough to reach it, and lets it float above the plain map the rest
   * of the time. A sibling of `ClinicsView` could never sit "inside" the
   * sheet's stacking this way - zIndex only reorders siblings under the
   * same parent, and the sheet lives one level deeper than that.
   */
  header?: ReactNode;
  /** The last directory sync failed - with an empty local DB that means "not downloaded yet". */
  syncFailed?: boolean;
  /** A directory download is in flight - an empty DB means "downloading", not "no results". */
  syncing?: boolean;
  onRetrySync?: () => void;
};

type SortMode = "distance" | "rating" | "name";
type Facility = FacilitySync | FacilityWithDistance;

const SCREEN_H = Dimensions.get("window").height;
const ALL_CHIP = "All Clinics";
const OPEN_CHIP = "Open Now";

// `topInset` stays part of the props contract (the parent screen still needs it
// to size/position the search header itself) but is no longer consumed here -
// see the snapPoints/topInset comments below for why the sheet stopped using it.
export function ClinicsView({
  query,
  syncVersion = 0,
  topInset: _topInset,
  header,
  syncFailed = false,
  syncing = false,
  onRetrySync,
}: ClinicsViewProps) {
  useLocale();
  const theme = useTheme();
  const { coords } = useLocation();
  const { isOnline } = useConnectivity();

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState(false);
  const [service, setService] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serviceFacets, setServiceFacets] = useState<string[]>([]);
  // Live top-edge Y position of the bottom sheet, in screen space - kept in
  // sync by BottomSheet itself as it's dragged/snapped. Drives the floating
  // map controls (zoom buttons, location chip) so they track the sheet's
  // actual current position instead of a snapshot of its collapsed height.
  const sheetPosition = useSharedValue(SCREEN_H);

  const [hasDefaultedSort, setHasDefaultedSort] = useState(false);
  if (coords && !hasDefaultedSort) {
    setHasDefaultedSort(true);
    if (sort === "name") setSort("distance");
  }

  useEffect(() => {
    listFacilities({ limit: 1000 })
      .then((all) =>
        setServiceFacets(
          Array.from(new Set(all.flatMap((f) => f.services))).sort(),
        ),
      )
      .catch(() => {});
  }, [syncVersion]);

  useEffect(() => {
    let cancelled = false;
    const params = {
      q: query || undefined,
      service: service ?? undefined,
      limit: 200,
    };
    /**
     * With a location, every row gets a distance - search results included - and the cap keeps
     * the NEAREST 200 rather than a radius box. The old path skipped distances whenever a query
     * was typed (all rows sorted as Infinity, i.e. by name, under a "sorted by distance" label),
     * and outside a 15 km box fell back to the alphabetically first 200 clinics nationwide.
     * The whole directory is ~1.6k rows, so a JS haversine pass is cheap.
     */
    const fetcher = (async (): Promise<Facility[]> => {
      if (!coords) return listFacilities(params);
      const all = await listFacilities({ ...params, limit: 5000 });
      return all
        .map((f) => ({
          ...f,
          distance_m: distanceMeters(coords.latitude, coords.longitude, f.latitude, f.longitude),
        }))
        .sort((a, b) => a.distance_m - b.distance_m)
        .slice(0, params.limit);
    })();
    fetcher
      .then((rows) => {
        if (cancelled) return;
        // Clear on success: `setError(true)` had no counterpart anywhere, so one failed read
        // latched the error state for the screen's lifetime - including over this fallback.
        setError(false);
        setFacilities(rows);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, service, coords, syncVersion]);

  // Offline map tiles (~25 km pack) only on Wi-Fi: on PH prepaid data a silent background
  // download is a real cost the user never agreed to.
  useEffect(() => {
    if (!coords || !isOnline) return;
    NetInfo.fetch()
      .then((state) => (state.type === "wifi" ? downloadAreaPack(coords) : undefined))
      .catch(() => {});
  }, [coords, isOnline]);

  const filtered = useMemo(() => {
    if (!facilities) return [];
    let rows = facilities;
    if (openOnly)
      rows = rows.filter(
        (f) => isOpenNow(f.weekday_hours, f.weekend_hours) === true,
      );

    const sorted = [...rows];
    if (sort === "distance" && coords) {
      sorted.sort(
        (a, b) =>
          ("distance_m" in a ? a.distance_m : Infinity) -
          ("distance_m" in b ? b.distance_m : Infinity),
      );
    } else if (sort === "rating") {
      sorted.sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [facilities, openOnly, sort, coords]);

  const cycleSort = useCallback(() => {
    setSort((s) => {
      if (s === "distance") return "rating";
      if (s === "rating") return "name";
      return coords ? "distance" : "rating";
    });
  }, [coords]);

  // Nothing local AND the download failed or can't run: "not downloaded yet", not "0 results".
  const notDownloaded =
    facilities?.length === 0 && !query && !service && !openOnly && (syncFailed || !isOnline) && !syncing;

  const sortLabel =
    sort === "distance" ? "distance" : sort === "rating" ? "rating" : "name";
  const chips = [ALL_CHIP, OPEN_CHIP, ...serviceFacets];

  // OVERHERE FOR SNAP CHANGE: If you want to change the snap points, do it here, top snap is the initial when you open the page
  // Bottom snap is when the user pulls the image app, going over 64 wont do much as the search bar is on top of this portion.
  //
  // The top point is the full screen height (not `SCREEN_H - topInset`) so
  // dragging all the way up covers the whole screen, Google-Maps-style - the
  // header stays visible above it purely because it renders with higher
  // elevation/zIndex as a sibling, not because the sheet stops short of it.
  const snapPoints = useMemo(() => ["20%", "50%", "96%"], []);

  return (
    <View style={styles.fill}>
      <ClinicMap
        facilities={filtered}
        coords={coords}
        selectedId={selectedId}
        onSelectFacility={setSelectedId}
        sheetPosition={sheetPosition}
        query={query}
      />

      {header}

      <BottomSheet
        index={0}
        snapPoints={snapPoints}
        // `topInset` acts as a hard ceiling in this library - the sheet's top
        // edge can never rise above it, regardless of what any snap point
        // says. Since the tallest snap point is meant to reach the very top
        // of the screen, `topInset` has to stay 0 here; it's no longer used
        // to keep the sheet clear of the header (see the snapPoints comment).
        topInset={0}
        animatedPosition={sheetPosition}
        enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: theme.surface }}
        handleIndicatorStyle={{ backgroundColor: theme.hairline }}
      >
        <View style={styles.header}>
          <View
            style={[
              styles.resultsCard,
              { backgroundColor: theme.surface, borderColor: theme.brandTint },
            ]}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0)", "rgba(255,233,218,0.6)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View
              style={[styles.resultsIcon, { backgroundColor: theme.brandTint }]}
            >
              <Icon name="cross.case.fill" tintColor={theme.brand} size={20} />
            </View>

            <View style={styles.resultsText}>
              <ThemedText type="title2" style={styles.resultsCount}>
                {filtered.length}
              </ThemedText>
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {notDownloaded
                  ? t("Directory not downloaded yet")
                  : t(filtered.length === 1 ? "clinic · sorted by {{sort}}" : "clinics · sorted by {{sort}}", { sort: t(sortLabel) })}
              </ThemedText>
            </View>

            <Pressable
              onPress={notDownloaded && onRetrySync ? onRetrySync : cycleSort}
              accessibilityRole="button"
              accessibilityLabel={notDownloaded ? t("Try again") : t("Change sort order")}
              hitSlop={8}
              style={({ pressed }) => [
                styles.sortButton,
                { backgroundColor: theme.brandTint },
                pressed && styles.pressed,
              ]}
            >
              <Icon
                name={notDownloaded ? "arrow.clockwise" : "arrow.up.arrow.down"}
                size={15}
                tintColor={theme.brand}
              />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {chips.map((item) => {
              if (item === ALL_CHIP) {
                return (
                  <Chip
                    key={item}
                    label={t(item)}
                    active={!service && !openOnly}
                    onPress={() => {
                      setService(null);
                      setOpenOnly(false);
                    }}
                  />
                );
              }
              if (item === OPEN_CHIP) {
                return (
                  <Chip
                    key={item}
                    label={t(item)}
                    active={openOnly}
                    onPress={() => setOpenOnly((v) => !v)}
                  />
                );
              }
              return (
                <Chip
                  key={item}
                  label={humanizeTag(item)}
                  active={service === item}
                  onPress={() => setService((v) => (v === item ? null : item))}
                />
              );
            })}
          </ScrollView>
        </View>

        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => (
            <ClinicCard
              facility={item}
              onPress={() =>
                router.push({
                  pathname: "/directory/clinic",
                  params: { id: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            facilities?.length === 0 && syncing && !query && !service && !openOnly ? (
              <ListState kind="loading" title={t("Downloading the clinic directory…")} />
            ) : notDownloaded ? (
              // Nothing local AND the download failed or can't run: this is "not downloaded yet",
              // not "no clinics match" - the old copy told the user to change a filter they never set.
              <ListState
                kind="offline"
                title={t("Clinic directory not downloaded yet")}
                subtitle={t("Connect to the internet to download it. After that it works offline.")}
                action={onRetrySync && isOnline ? { label: t("Try again"), onPress: onRetrySync } : undefined}
              />
            ) : !isOnline && facilities === null ? (
              <ListState
                kind="offline"
                title={t("You're offline")}
                subtitle={t("Showing cached clinics only.")}
              />
            ) : facilities === null ? (
              error ? (
                <ListState
                  kind="error"
                  title={t("Couldn't load clinics")}
                  subtitle={t("Something went wrong reading the saved directory.")}
                  action={onRetrySync ? { label: t("Try again"), onPress: onRetrySync } : undefined}
                />
              ) : (
                <ListState kind="loading" title={t("Finding clinics…")} />
              )
            ) : (
              <ListState
                kind="empty"
                title={t("No clinics found")}
                subtitle={t("Try a different search or filter.")}
              />
            )
          }
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.sm,
    gap: Space.md,
  },
  resultsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.base,
    overflow: "hidden",
    ...Elevation.sm,
  },
  resultsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  resultsText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  resultsCount: {
    fontSize: 20,
    lineHeight: 24,
  },
  sortButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { gap: Space.sm },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  pressed: {
    opacity: 0.84,
  },
});

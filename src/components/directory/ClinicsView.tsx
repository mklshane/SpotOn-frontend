import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { ListState } from "@/components/ui/list-state";
import { Elevation, Radius, Space } from "@/constants/theme";
import {
  listFacilities,
  nearbyFacilities,
  type FacilityWithDistance,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useLocation } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { humanizeTag } from "@/lib/format";
import { isOpenNow } from "@/lib/hours";
import { downloadAreaPack } from "@/lib/map-offline";

import { ClinicCard } from "./ClinicCard";
import { ClinicMap } from "./ClinicMap";

export type ClinicsViewProps = { query: string; topInset: number };

type SortMode = "distance" | "rating" | "name";
type Facility = FacilitySync | FacilityWithDistance;

const SCREEN_H = Dimensions.get("window").height;
const COLLAPSED_BOTTOM_INSET = SCREEN_H * 0.32 + 12;
const ALL_CHIP = "All Clinics";
const OPEN_CHIP = "Open Now";

export function ClinicsView({ query, topInset }: ClinicsViewProps) {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = {
      q: query || undefined,
      service: service ?? undefined,
      limit: 200,
    };
    const fetcher =
      coords && !query.trim()
        ? nearbyFacilities(coords.latitude, coords.longitude, params)
        : listFacilities(params);
    fetcher
      .then((rows) => !cancelled && setFacilities(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, service, coords]);

  useEffect(() => {
    if (coords && isOnline) downloadAreaPack(coords).catch(() => {});
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

  const sortLabel =
    sort === "distance" ? "distance" : sort === "rating" ? "rating" : "name";
  const chips = [ALL_CHIP, OPEN_CHIP, ...serviceFacets];

  // OVERHERE FOR SNAP CHANGE: If you want to change the snap points, do it here, top snap is the initial when you open the page
  // Bottom snap is when the user pulls the image app, going over 64 wont do much as the search bar is on top of this portion.
  const snapPoints = useMemo(
    () => [
      "25%",
      "64%",
      Math.max(SCREEN_H * 0.5, SCREEN_H - topInset - Space.md),
    ],
    [topInset],
  );

  return (
    <View style={styles.fill}>
      <ClinicMap
        facilities={filtered}
        coords={coords}
        selectedId={selectedId}
        onSelectFacility={setSelectedId}
        bottomInset={COLLAPSED_BOTTOM_INSET}
        query={query}
      />

      <BottomSheet
        index={0}
        snapPoints={snapPoints}
        topInset={topInset}
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
                {filtered.length === 1 ? "clinic" : "clinics"} · sorted by{" "}
                {sortLabel}
              </ThemedText>
            </View>

            <Pressable
              onPress={cycleSort}
              accessibilityRole="button"
              accessibilityLabel="Change sort order"
              hitSlop={8}
              style={({ pressed }) => [
                styles.sortButton,
                { backgroundColor: theme.brandTint },
                pressed && styles.pressed,
              ]}
            >
              <Icon
                name="arrow.up.arrow.down"
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
                    label={item}
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
                    label={item}
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
            !isOnline && facilities === null ? (
              <ListState
                kind="offline"
                title="You're offline"
                subtitle="Showing cached clinics only."
              />
            ) : facilities === null ? (
              error ? (
                <ListState
                  kind="error"
                  title="Couldn't load clinics"
                  subtitle="Check your connection and try again."
                />
              ) : (
                <ListState kind="loading" title="Finding clinics…" />
              )
            ) : (
              <ListState
                kind="empty"
                title="No clinics found"
                subtitle="Try a different search or filter."
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

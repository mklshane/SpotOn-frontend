import { t, useLocale } from '@/lib/i18n';
import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
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
import { Radius, Space } from "@/constants/theme";
import {
  countFacilities,
  distanceMeters,
  facilityDermSummary,
  listFacilities,
  type FacilityKind,
  type FacilityWithDistance,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import type { Coords, LocationStatus } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { CONCERNS, dermTier, WEEKEND_MASK, type ConcernId } from "@/lib/concerns";
import { isHospitalType, type DermSummary } from "@/lib/directory-core";
import { todayScheduleBit } from "@/lib/directory-display";
import { isOpenNow } from "@/lib/hours";
import { downloadAreaPack } from "@/lib/map-offline";
import NetInfo from "@react-native-community/netinfo";

import { ClinicCard } from "./ClinicCard";
import { ClinicMap } from "./ClinicMap";
import { DirectoryFilterSheet } from "./DirectoryFilterSheet";
import { PdsAttribution } from "./PdsAttribution";
import { usePhoneCall } from "./use-phone-call";

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
  /** Pre-select a concern, e.g. `skin_cancer_mole_check` when arriving from a scan result. */
  initialConcern?: ConcernId | null;
  /** Changes on every deep link, so a repeat visit re-applies `initialConcern` after it was cleared. */
  initialConcernKey?: string | null;
  /** Owned by the directory screen so both tabs share one GPS request. */
  coords: Coords | null;
  locationStatus: LocationStatus;
  onRequestLocation: () => void;
};

type SortMode = "distance" | "rating" | "name";
type Facility = FacilitySync | FacilityWithDistance;

const SCREEN_H = Dimensions.get("window").height;
const NO_DERMS: DermSummary = { count: 0, daysMask: 0, bookable: 0 };
/** Browsing with a location shows this many nearest places (a search covers everything). */
const NEAREST_LIMIT = 200;
/** A concern chip only appears when this many live places list it as a focus. */
const MIN_CONCERN_PLACES = 15;


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
  initialConcern = null,
  initialConcernKey = null,
  coords,
  locationStatus,
  onRequestLocation,
}: ClinicsViewProps) {
  useLocale();
  const theme = useTheme();
  const { isOnline } = useConnectivity();
  const phone = usePhoneCall();

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [dermSummary, setDermSummary] = useState<Map<string, DermSummary> | null>(null);
  const [error, setError] = useState(false);
  const [concern, setConcern] = useState<ConcernId | null>(initialConcern);
  const [kind, setKind] = useState<FacilityKind | null>(null);
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);
  const [bookingOnly, setBookingOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // A new deep link (another scan result) must re-apply its concern; the screen stays mounted.
  // Keyed on the link's nonce, not the concern: every scan sends the same concern, so comparing
  // values never re-applied a chip the user had cleared. Adjusted during render, not in an effect.
  const requestKey = `${initialConcern ?? ""}:${initialConcernKey ?? ""}`;
  const [appliedRequest, setAppliedRequest] = useState(requestKey);
  if (requestKey !== appliedRequest) {
    setAppliedRequest(requestKey);
    if (initialConcern) setConcern(initialConcern);
  }

  // Concern tags come from each doctor's own listed focus areas (37_tag_concerns), so most are
  // sparse. A chip that would filter down to a handful of places nationwide is hidden.
  const [concernCounts, setConcernCounts] = useState<Map<ConcernId, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all(CONCERNS.map(async (c) => [c.id, await countFacilities({ concern: c.id })] as const))
      .then((pairs) => !cancelled && setConcernCounts(new Map(pairs)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syncVersion]);

  useEffect(() => {
    let cancelled = false;
    facilityDermSummary()
      .then((m) => !cancelled && setDermSummary(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syncVersion]);

  useEffect(() => {
    let cancelled = false;
    // Browsing with a location: the NEAREST places only (NEAREST_LIMIT), so the list and map stay
    // about where the user is. Typing a search looks through the whole directory (a doctor's or a
    // town's name may be far away), still nearest first. Without a location there is nothing to
    // be near, so every match is listed by name and the "Turn on location" banner shows.
    const params = {
      q: query || undefined,
      concern: concern ?? undefined,
      kind: kind ?? undefined,
      dayMask: weekendOnly ? WEEKEND_MASK : undefined,
      hasBookingUrl: bookingOnly || undefined,
      limit: null,
    };
    const fetcher = (async (): Promise<Facility[]> => {
      const all = await listFacilities(params);
      if (!coords) return all;
      const located = all
        .map((f) => ({
          ...f,
          distance_m: distanceMeters(coords.latitude, coords.longitude, f.latitude, f.longitude),
        }))
        .sort((a, b) => a.distance_m - b.distance_m);
      return query ? located : located.slice(0, NEAREST_LIMIT);
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
  }, [query, concern, kind, weekendOnly, bookingOnly, coords, syncVersion]);

  // Offline map tiles (~25 km pack) only on Wi-Fi: on PH prepaid data a silent background
  // download is a real cost the user never agreed to.
  useEffect(() => {
    if (!coords || !isOnline) return;
    NetInfo.fetch()
      .then((state) => (state.type === "wifi" ? downloadAreaPack(coords) : undefined))
      .catch(() => {});
  }, [coords, isOnline]);

  const sortLabel = sort === "distance" ? t("Nearest") : sort === "rating" ? t("Top rated") : t("A–Z");
  const todayBit = todayScheduleBit();
  const filtered = useMemo(() => {
    if (!facilities) return [];
    let rows = facilities;
    if (todayOnly) {
      // "Derm in today": a linked dermatologist holds clinic today, or a (non-hospital) clinic is
      // open right now. A hospital's own 24h hours don't count - they were what "Open Now" used
      // to match, listing every hospital as if a dermatologist were in.
      rows = rows.filter(
        (f) =>
          ((dermSummary?.get(f.id)?.daysMask ?? 0) & todayBit) !== 0 ||
          (!isHospitalType(f.type) && isOpenNow(f.weekday_hours, f.weekend_hours) === true),
      );
    }

    const byKey: (a: Facility, b: Facility) => number =
      sort === "distance" && coords
        ? (a, b) =>
            ("distance_m" in a ? a.distance_m : Infinity) -
            ("distance_m" in b ? b.distance_m : Infinity)
        : sort === "rating"
          ? (a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0)
          : (a, b) => a.name.localeCompare(b.name);
    // Places where a dermatologist can actually be seen come first, whatever the sort - within the
    // nearest NEAREST_LIMIT, so a far derm clinic never outranks the neighbourhood.
    return [...rows].sort((a, b) => dermTier(a) - dermTier(b) || byKey(a, b));
  }, [facilities, todayOnly, dermSummary, todayBit, sort, coords]);

  const cycleSort = useCallback(() => {
    setSort((s) => {
      if (s === "distance") return "rating";
      if (s === "rating") return "name";
      return coords ? "distance" : "rating";
    });
  }, [coords]);

  const anyFilter = !!(query || concern || kind || weekendOnly || todayOnly || bookingOnly);
  // Nothing local AND the download failed or can't run: "not downloaded yet", not "0 results".
  const notDownloaded =
    facilities?.length === 0 && !anyFilter && (syncFailed || !isOnline) && !syncing;
  const showLocationBanner = !coords && locationStatus === "denied" && !notDownloaded;

  const clearFilters = () => {
    setConcern(null);
    setKind(null);
    setWeekendOnly(false);
    setTodayOnly(false);
    setBookingOnly(false);
  };
  const filtersSet = !!(concern || kind || weekendOnly || todayOnly || bookingOnly);

  // Concerns offered in the filter sheet: only those enough places list (plus the active one).
  const concernIds: ConcernId[] = CONCERNS.map((c) => c.id).filter(
    (id) => id === concern || !concernCounts || (concernCounts.get(id) ?? 0) >= MIN_CONCERN_PLACES,
  );
  const activeConcern = concern ? CONCERNS.find((c) => c.id === concern) : undefined;
  const filterCount = [concern, kind, weekendOnly, todayOnly, bookingOnly].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);

  // "Near Lipa City" - the area of the nearest place, which is what the list is about.
  const nearest = coords && !query
    ? (facilities ?? []).reduce<Facility | null>(
        (best, f) => ("distance_m" in f && (!best || f.distance_m < (best as FacilityWithDistance).distance_m) ? f : best),
        null,
      )
    : null;
  const heading = query
    ? t("Results for “{{query}}”", { query })
    : nearest?.city
      ? t("Near {{place}}", { place: nearest.city })
      : t("All clinics");

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
        dermSummary={dermSummary ?? undefined}
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
          {/* One compact line instead of a card: where, how many, and how they're ordered. */}
          <View style={styles.titleRow}>
            <View style={styles.titleText} accessible accessibilityLiveRegion="polite">
              <ThemedText type="headline" numberOfLines={1}>
                {notDownloaded ? t("Directory not downloaded yet") : heading}
              </ThemedText>
              {!notDownloaded ? (
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                  {filtered.length === 1
                    ? t("1 place")
                    : t("{{count}} places", { count: filtered.length })}
                </ThemedText>
              ) : null}
            </View>
            {notDownloaded && onRetrySync ? (
              <Pressable
                onPress={onRetrySync}
                accessibilityRole="button"
                accessibilityLabel={t("Try again")}
                hitSlop={8}
                style={({ pressed }) => [styles.sortPill, { backgroundColor: theme.brandTint }, pressed && styles.pressed]}
              >
                <Icon name="arrow.clockwise" size={13} tintColor={theme.brandPressed} />
              </Pressable>
            ) : (
              <Pressable
                onPress={cycleSort}
                accessibilityRole="button"
                accessibilityLabel={t("Sort")}
                accessibilityValue={{ text: sortLabel }}
                accessibilityHint={t("Changes the sort order")}
                hitSlop={8}
                style={({ pressed }) => [styles.sortPill, { backgroundColor: theme.elementBg }, pressed && styles.pressed]}
              >
                <Icon name="arrow.up.arrow.down" size={13} tintColor={theme.textSecondary} />
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.sortText} numberOfLines={1}>
                  {sortLabel}
                </ThemedText>
              </Pressable>
            )}
          </View>

          {showLocationBanner ? (
            <Pressable
              onPress={onRequestLocation}
              accessibilityRole="button"
              style={({ pressed }) => [styles.banner, { backgroundColor: theme.brandTint }, pressed && styles.pressed]}
            >
              <Icon name="mappin.circle.fill" size={14} tintColor={theme.brandPressed} />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.bannerText}>
                {t("Turn on location to see the places nearest you.")}
              </ThemedText>
              <ThemedText type="footnote" style={[styles.bannerAction, { color: theme.brandPressed }]}>
                {t("Turn on")}
              </ThemedText>
            </Pressable>
          ) : null}

          {/* One rail: Filters (everything, incl. skin concern + sort) then the quick toggles. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip
              size="sm"
              icon="slider.horizontal.3"
              label={filterCount ? t("Filters · {{count}}", { count: filterCount }) : t("Filters")}
              active={filterCount > 0}
              accessibilityLabel={t("Filters")}
              onPress={() => setFiltersOpen(true)}
            />
            {activeConcern ? (
              <Chip
                size="sm"
                label={t(activeConcern.label)}
                active
                trailingIcon="xmark"
                accessibilityLabel={t("Remove filter {{name}}", { name: t(activeConcern.label) })}
                onPress={() => setConcern(null)}
              />
            ) : null}
            <Chip size="sm" label={t("Derm in today")} active={todayOnly} onPress={() => setTodayOnly((v) => !v)} />
            <Chip
              size="sm"
              label={t("Clinics")}
              active={kind === "clinic"}
              onPress={() => setKind((v) => (v === "clinic" ? null : "clinic"))}
            />
            <Chip
              size="sm"
              label={t("Hospitals")}
              active={kind === "hospital"}
              onPress={() => setKind((v) => (v === "hospital" ? null : "hospital"))}
            />
            <Chip size="sm" label={t("Weekend")} active={weekendOnly} onPress={() => setWeekendOnly((v) => !v)} />
          </ScrollView>
        </View>

        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(f: Facility) => f.id}
          renderItem={({ item }: { item: Facility }) => (
            <ClinicCard
              facility={item}
              derm={dermSummary ? dermSummary.get(item.id) ?? NO_DERMS : undefined}
              onCall={phone.call}
              isOnline={isOnline}
              onPress={() =>
                router.push({
                  pathname: "/directory/clinic",
                  params: { id: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.list}
          initialNumToRender={8}
          windowSize={7}
          ListFooterComponent={filtered.length ? <PdsAttribution /> : null}
          ListEmptyComponent={
            facilities?.length === 0 && syncing && !anyFilter ? (
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
                subtitle={filtersSet ? t("Try fewer filters, or search a nearby city.") : t("Try a different search.")}
                action={filtersSet ? { label: t("Clear filters"), onPress: clearFilters } : undefined}
              />
            )
          }
        />
      </BottomSheet>
      {phone.sheet}
      <DirectoryFilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={{ kind, todayOnly, weekendOnly, bookingOnly, concern }}
        onChange={(next) => {
          if ("kind" in next) setKind(next.kind ?? null);
          if ("todayOnly" in next) setTodayOnly(!!next.todayOnly);
          if ("weekendOnly" in next) setWeekendOnly(!!next.weekendOnly);
          if ("bookingOnly" in next) setBookingOnly(!!next.bookingOnly);
          if ("concern" in next) setConcern(next.concern ?? null);
        }}
        onReset={clearFilters}
        sort={sort}
        onSort={setSort}
        hasLocation={!!coords}
        concernIds={concernIds}
      />
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  sortPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.xs,
    height: 36,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    flexShrink: 0,
  },
  sortText: { fontWeight: "600" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
    borderRadius: Radius.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
  },
  bannerText: { flex: 1 },
  bannerAction: { fontWeight: "700" },
  chips: { gap: Space.sm },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  pressed: {
    opacity: 0.84,
  },
});

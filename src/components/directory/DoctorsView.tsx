import { t, useLocale } from '@/lib/i18n';
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { FlatList, ScrollView, StyleSheet, View } from "react-native";

import type { DoctorSync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { ListState } from "@/components/ui/list-state";
import { Radius, Space } from "@/constants/theme";
import {
  doctorCardInfo,
  listDoctors,
  nearestPracticeMeters,
  type DoctorCardInfo,
} from "@/data/repositories";
import type { Coords } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { WEEKEND_MASK } from "@/lib/concerns";
import { todayScheduleBit } from "@/lib/directory-display";

import { DoctorCard } from "./DoctorCard";
import { PdsAttribution } from "./PdsAttribution";

export type DoctorsViewProps = {
  query: string;
  /** Changes when a directory sync completes; the lists re-read the local DB on it. */
  syncVersion?: number;
  topInset: number;
  /**
   * The search bar / segmented-control overlay, rendered by the parent
   * screen. Unlike ClinicsView, there's no map+bottom-sheet stacking to
   * worry about here - it just renders directly so it's always present
   * (and its onLayout keeps `topInset` accurate) regardless of which
   * segment is active.
   */
  header?: ReactNode;
  /** The last directory sync failed - with an empty local DB that means "not downloaded yet". */
  syncFailed?: boolean;
  /** A directory download is in flight - an empty DB means "downloading", not "no results". */
  syncing?: boolean;
  onRetrySync?: () => void;
  /** Owned by the directory screen so both tabs share one GPS request. */
  coords: Coords | null;
  /** A deep link's chip (/directory?segment=doctors&filter=online), applied once per `linkKey`. */
  linkFilter?: DoctorLinkFilter;
  /** The link's `at` nonce: a new one re-applies `linkFilter` even after the user cleared it. */
  linkKey?: string;
};

type DoctorFilter = "all" | "booking" | "online" | "today" | "weekend";
export type DoctorLinkFilter = Extract<DoctorFilter, "booking" | "online">;
export const isDoctorLinkFilter = (v: unknown): v is DoctorLinkFilter => v === "booking" || v === "online";

/**
 * The "Dermatologists" tab: every listed (PDS board-certified) dermatologist, searchable by name.
 * It used to be "Online Booking" and listed only the ~150 doctors with a booking link, so the
 * other ~1,350 could not be found by name anywhere in the app. Booking is now a filter chip.
 */
export function DoctorsView({
  query,
  syncVersion = 0,
  topInset,
  header,
  syncFailed = false,
  syncing = false,
  onRetrySync,
  coords,
  linkFilter,
  linkKey,
}: DoctorsViewProps) {
  useLocale();
  const theme = useTheme();
  const [filter, setFilter] = useState<DoctorFilter>(linkFilter ?? "all");
  // Same adjust-during-render pattern as the directory screen's segment link.
  const [appliedLink, setAppliedLink] = useState(`${linkFilter ?? ""}:${linkKey ?? ""}`);
  const nextLink = `${linkFilter ?? ""}:${linkKey ?? ""}`;
  if (nextLink !== appliedLink) {
    setAppliedLink(nextLink);
    if (linkFilter) setFilter(linkFilter);
  }
  const [doctors, setDoctors] = useState<DoctorSync[] | null>(null);
  const [doctorDistance, setDoctorDistance] = useState<Map<string, number>>(new Map());
  const [info, setInfo] = useState<Map<string, DoctorCardInfo>>(new Map());
  const [error, setError] = useState(false);
  const todayBit = todayScheduleBit();

  useEffect(() => {
    let cancelled = false;
    doctorCardInfo()
      .then((m) => !cancelled && setInfo(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syncVersion]);

  useEffect(() => {
    let cancelled = false;
    // Error is cleared on the next SUCCESS (not up front in the effect body), and shown as a
    // banner when old rows are still on screen - it used to render only in the empty state.
    // With a location fix, nearest practice first; doctors with no mapped practice follow, by name.
    (async () => {
      const rows = await listDoctors({
        q: query || undefined,
        hasBookingLink: filter === "booking" || undefined,
        offersOnline: filter === "online" || undefined,
        dayMask: filter === "today" ? todayBit : filter === "weekend" ? WEEKEND_MASK : undefined,
        limit: null,
      });
      if (!coords) return { rows, dist: new Map<string, number>() };
      const dist = await nearestPracticeMeters(coords.latitude, coords.longitude);
      const sorted = [...rows].sort(
        (a, b) => (dist.get(a.id) ?? Infinity) - (dist.get(b.id) ?? Infinity),
      );
      return { rows: sorted, dist };
    })()
      .then(({ rows, dist }) => {
        if (cancelled) return;
        setError(false);
        setDoctorDistance(dist);
        setDoctors(rows);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [filter, query, syncVersion, coords, todayBit]);

  const loading = doctors === null;
  const toggle = (next: DoctorFilter) => setFilter((f) => (f === next ? "all" : next));

  const listHeader = (
    <View style={styles.headerBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t("All")} active={filter === "all"} onPress={() => setFilter("all")} />
        <Chip label={t("Books online")} active={filter === "booking"} onPress={() => toggle("booking")} />
        <Chip label={t("Online consult")} active={filter === "online"} onPress={() => toggle("online")} />
        <Chip label={t("In today")} active={filter === "today"} onPress={() => toggle("today")} />
        <Chip label={t("Weekend clinic")} active={filter === "weekend"} onPress={() => toggle("weekend")} />
      </ScrollView>
      {doctors ? (
        <ThemedText type="footnote" themeColor="textSecondary" accessibilityLiveRegion="polite">
          {doctors.length === 1
            ? t("1 dermatologist")
            : t("{{count}} dermatologists", { count: doctors.length })}
          {coords ? ` · ${t("nearest first")}` : ""}
        </ThemedText>
      ) : null}
      {error && doctors?.length ? (
        <View style={[styles.errorBanner, { backgroundColor: theme.elementBg }]}>
          <Icon name="exclamationmark.triangle.fill" size={13} tintColor={theme.riskHigh} />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.flex}>
            {t("Couldn't refresh this list. Showing the last results.")}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  const emptyState = error ? (
    <ListState
      kind="error"
      title={t("Couldn't load")}
      subtitle={t("Something went wrong reading the saved directory.")}
      action={onRetrySync ? { label: t("Try again"), onPress: onRetrySync } : undefined}
    />
  ) : loading || (syncing && !query) ? (
    <ListState kind="loading" title={t("Loading…")} />
  ) : syncFailed && !query && filter === "all" ? (
    <ListState
      kind="offline"
      title={t("Directory not downloaded yet")}
      subtitle={t("Connect to the internet to download it. After that it works offline.")}
      action={onRetrySync ? { label: t("Try again"), onPress: onRetrySync } : undefined}
    />
  ) : (
    <ListState
      kind="empty"
      title={t("No dermatologists found")}
      subtitle={filter !== "all" ? t("Try fewer filters.") : t("Try a different search.")}
      action={filter !== "all" ? { label: t("Clear filters"), onPress: () => setFilter("all") } : undefined}
    />
  );

  return (
    <View style={styles.fill}>
      <View style={[styles.list, { paddingTop: topInset }]}>
        <FlatList
          data={doctors ?? []}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DoctorCard
              doctor={item}
              distanceM={doctorDistance.get(item.id)}
              info={info.get(item.id)}
              todayBit={todayBit}
              onPress={() =>
                router.push({
                  pathname: "/directory/doctor",
                  params: { id: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.listContent}
          initialNumToRender={10}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={listHeader}
          ListFooterComponent={doctors?.length ? <PdsAttribution /> : null}
          ListEmptyComponent={emptyState}
        />
      </View>

      {/* Keep the shared segment/search header above the list in web hit-testing order. */}
      {header}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  headerBlock: { gap: Space.sm, marginBottom: Space.base },
  chips: { gap: Space.sm },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
    borderRadius: Radius.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
  },
  flex: { flex: 1 },
});

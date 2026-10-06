import { t, useLocale } from '@/lib/i18n';
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import type { DoctorSync, FacilitySync } from "@/api/types";
import { Chip } from "@/components/ui/chip";
import { ListState } from "@/components/ui/list-state";
import { Space } from "@/constants/theme";
import { listDoctors, listFacilities } from "@/data/repositories";

import { ClinicCard } from "./ClinicCard";
import { DoctorCard } from "./DoctorCard";

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
};

type BookingMode = "doctors" | "clinics";

/**
 * The "Online Booking" tab: ONLY entries that can be booked online.
 * A Doctors/Clinics toggle switches between doctors with an active booking
 * link and clinics with their own online-booking page (facilities.booking_url).
 */
export function DoctorsView({
  query,
  syncVersion = 0,
  topInset,
  header,
  syncFailed = false,
  syncing = false,
  onRetrySync,
}: DoctorsViewProps) {
  useLocale();
  const [mode, setMode] = useState<BookingMode>("doctors");
  const [doctors, setDoctors] = useState<DoctorSync[] | null>(null);
  const [clinics, setClinics] = useState<FacilitySync[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Error is cleared on the next SUCCESS (not up front in the effect body): a later failed
    // query used to leave stale rows on screen with no message, since the error only rendered
    // while the list was still loading.
    if (mode === "doctors") {
      listDoctors({ q: query || undefined, hasBookingLink: true, limit: 100 })
        .then((rows) => {
          if (cancelled) return;
          setError(false);
          setDoctors(rows);
        })
        .catch(() => !cancelled && setError(true));
    } else {
      listFacilities({ q: query || undefined, hasBookingUrl: true, limit: 100 })
        .then((rows) => {
          if (cancelled) return;
          setError(false);
          setClinics(rows);
        })
        .catch(() => !cancelled && setError(true));
    }
    return () => {
      cancelled = true;
    };
  }, [mode, query, syncVersion]);

  const loading = mode === "doctors" ? doctors === null : clinics === null;
  const empty =
    mode === "doctors" ? doctors?.length === 0 : clinics?.length === 0;

  const modeToggle = (
    <View style={styles.modeRow}>
      <Chip
        label={t("Doctors")}
        active={mode === "doctors"}
        onPress={() => setMode("doctors")}
      />
      <Chip
        label={t("Clinics")}
        active={mode === "clinics"}
        onPress={() => setMode("clinics")}
      />
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
  ) : syncFailed && !query ? (
    <ListState
      kind="offline"
      title={t("Directory not downloaded yet")}
      subtitle={t("Connect to the internet to download it. After that it works offline.")}
      action={onRetrySync ? { label: t("Try again"), onPress: onRetrySync } : undefined}
    />
  ) : (
    <ListState
      kind="empty"
      title={t("No online booking found")}
      subtitle={t("Try a different search.")}
    />
  );

  return (
    <View style={styles.fill}>
      <View style={[styles.list, { paddingTop: topInset }]}>
        {mode === "doctors" ? (
          <FlatList
            data={doctors ?? []}
            keyExtractor={(d) => d.id}
            renderItem={({ item }) => (
              <DoctorCard
                doctor={item}
                onPress={() =>
                  router.push({
                    pathname: "/directory/doctor",
                    params: { id: item.id },
                  })
                }
              />
            )}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={modeToggle}
            ListEmptyComponent={empty || loading || error ? emptyState : null}
          />
        ) : (
          <FlatList
            data={clinics ?? []}
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
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={modeToggle}
            ListEmptyComponent={empty || loading || error ? emptyState : null}
          />
        )}
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
  modeRow: { flexDirection: "row", gap: Space.sm, marginBottom: Space.base },
});

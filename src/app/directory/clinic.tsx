import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { ListState } from "@/components/ui/list-state";
import { Screen } from "@/components/ui/screen";
import { Radius, Space } from "@/constants/theme";
import { getFacility } from "@/data/repositories";
import { useTheme } from "@/hooks/use-theme";
import { facilityNameParts, formatFeeRange, humanizeTag } from "@/lib/format";
import { formatHours, isOpenNow } from "@/lib/hours";
import { callNumber, openDirections, openWebsite } from "@/lib/links";

export default function ClinicDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [facility, setFacility] = useState<FacilitySync | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Reset loading/error during render when `id` changes (not synchronously in
  // the effect body below, which trips react-hooks/set-state-in-effect).
  const [loadedId, setLoadedId] = useState(id);
  if (id !== loadedId) {
    setLoadedId(id);
    setLoading(true);
    setError(false);
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getFacility(id)
      .then((f) => {
        if (cancelled) return;
        setFacility(f);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const open = facility
    ? isOpenNow(facility.weekday_hours, facility.weekend_hours)
    : null;
  const feeRange = facility
    ? formatFeeRange(facility.fee_min, facility.fee_max)
    : null;
  const nameParts = facility ? facilityNameParts(facility) : null;
  const hasHours = !!(
    facility &&
    (facility.weekday_hours || facility.weekend_hours)
  );
  const dept = facility?.department_info ?? null;
  const hasDeptInfo = !!(
    dept &&
    (dept.has_derm_department || dept.department_name || dept.opd_notes)
  );

  // Full-bleed hero only once we actually have a facility with a photo — otherwise
  // fall back to the plain header so Back always works during loading/error states.
  const showHero = !loading && !error && !!facility?.photo_url;

  return (
    <Screen padded={false}>
      {!showHero ? (
        <View style={styles.header}>
          <Pressable
            hitSlop={12}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
          <ThemedText type="headline" themeColor="textSecondary">
            Clinic
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
      ) : null}

      {loading ? (
        <ListState kind="loading" title="Loading clinic…" />
      ) : error ? (
        <ListState
          kind="error"
          title="Couldn't load clinic"
          subtitle="Check your connection and try again."
        />
      ) : !facility ? (
        <ListState kind="error" title="Clinic not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {showHero ? (
            <View style={styles.heroWrap}>
              <Image
                source={{ uri: facility.photo_url as string }}
                style={styles.heroPhoto}
                contentFit="cover"
                cachePolicy="disk"
                transition={200}
                accessibilityLabel={`Photo of ${facility.name}`}
              />
              <LinearGradient
                colors={["rgba(0,0,0,0.5)", "rgba(0,0,0,0)"]}
                style={styles.heroScrim}
                pointerEvents="none"
              />
              <Pressable
                hitSlop={12}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.heroBackBtn}
              >
                <Icon name="chevron.left" tintColor="#FFFFFF" size={20} />
              </Pressable>
              {facility.photo_attribution ? (
                <View style={styles.attributionWrap}>
                  <ThemedText type="caption" style={styles.attributionText}>
                    Photo: {facility.photo_attribution}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.bodyPadded}>
            <View style={styles.identity}>
              <ThemedText type="title1">
                {nameParts?.title ?? facility.name}
              </ThemedText>
              {nameParts?.affiliation ? (
                <ThemedText type="callout" themeColor="textSecondary">
                  at {nameParts.affiliation}
                </ThemedText>
              ) : null}
              <View style={styles.badges}>
                <Badge label={humanizeTag(facility.type)} tone="brand" />
                {facility.has_philhealth ? <Badge label="PhilHealth" /> : null}
              </View>
            </View>

            {facility.google_rating != null || feeRange || open != null ? (
              <View style={styles.statsRow}>
                {facility.google_rating != null ? (
                  <Card padded={false} style={styles.statTile} elevation="sm">
                    <IconCircle icon="star.fill" variant="tint" size={32} />
                    <ThemedText type="headline">
                      {facility.google_rating.toFixed(1)}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      Rating
                    </ThemedText>
                  </Card>
                ) : null}
                {feeRange ? (
                  <Card padded={false} style={styles.statTile} elevation="sm">
                    <IconCircle icon="banknote" variant="tint" size={32} />
                    <ThemedText type="headline" numberOfLines={1}>
                      {feeRange}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      Consult fee
                    </ThemedText>
                  </Card>
                ) : null}
                {open != null ? (
                  <Card padded={false} style={styles.statTile} elevation="sm">
                    <IconCircle
                      icon={open ? "checkmark.circle.fill" : "clock.fill"}
                      variant="tint"
                      tintBg={open ? theme.riskLowBg : theme.riskHighBg}
                      iconColor={open ? theme.riskLow : theme.riskHigh}
                      size={32}
                    />
                    <ThemedText type="headline">
                      {open ? "Open" : "Closed"}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      Status
                    </ThemedText>
                  </Card>
                ) : null}
              </View>
            ) : null}

            {facility.description ? (
              <ThemedText type="callout" themeColor="textSecondary">
                {facility.description}
              </ThemedText>
            ) : null}

            {hasDeptInfo ? (
              <Card
                style={[styles.deptCard, { backgroundColor: theme.brandTint }]}
                elevation="sm"
              >
                <View style={styles.deptHeader}>
                  <IconCircle
                    icon="cross.case.fill"
                    variant="gradient"
                    size={40}
                  />
                  <ThemedText type="headline" style={styles.deptTitle}>
                    Dermatology Department
                  </ThemedText>
                  {dept?.has_derm_department ? (
                    <Badge label="Confirmed" tone="brand" />
                  ) : null}
                </View>
                {dept?.department_name ? (
                  <ThemedText type="callout" themeColor="textSecondary">
                    {dept.department_name}
                  </ThemedText>
                ) : null}
                {dept?.opd_notes ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {dept.opd_notes}
                  </ThemedText>
                ) : null}
              </Card>
            ) : null}

            <Card style={styles.infoCard} elevation="sm">
              <Pressable
                onPress={() =>
                  openDirections({
                    googleMapsUrl: facility.google_maps_url,
                    latitude: facility.latitude,
                    longitude: facility.longitude,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Get directions"
              >
                <View style={styles.infoRow}>
                  <IconCircle
                    icon="mappin.circle.fill"
                    variant="tint"
                    size={36}
                  />
                  <ThemedText
                    type="callout"
                    style={styles.infoText}
                    numberOfLines={3}
                  >
                    {facility.address}
                  </ThemedText>
                  <Icon
                    name="chevron.right"
                    size={14}
                    tintColor={theme.muted}
                  />
                </View>
              </Pressable>

              {hasHours ? (
                <>
                  <View
                    style={[
                      styles.infoDivider,
                      { backgroundColor: theme.hairline },
                    ]}
                  />
                  <View style={styles.infoRow}>
                    <IconCircle icon="clock.fill" variant="tint" size={36} />
                    <View style={styles.infoText}>
                      {facility.weekday_hours ? (
                        <View style={styles.hoursLine}>
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                          >
                            Mon–Fri
                          </ThemedText>
                          <ThemedText type="footnote">
                            {formatHours(facility.weekday_hours)}
                          </ThemedText>
                        </View>
                      ) : null}
                      {facility.weekend_hours ? (
                        <View style={styles.hoursLine}>
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                          >
                            Sat–Sun
                          </ThemedText>
                          <ThemedText type="footnote">
                            {formatHours(facility.weekend_hours)}
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </>
              ) : null}

              {feeRange ? (
                <>
                  <View
                    style={[
                      styles.infoDivider,
                      { backgroundColor: theme.hairline },
                    ]}
                  />
                  <View style={styles.infoRow}>
                    <IconCircle icon="banknote" variant="tint" size={36} />
                    <ThemedText type="footnote" style={styles.infoText}>
                      Consultation fee {feeRange}
                    </ThemedText>
                  </View>
                </>
              ) : null}
            </Card>

            {facility.services.length ? (
              <View>
                <ThemedText type="headline" style={styles.sectionTitle}>
                  Services
                </ThemedText>
                <View style={styles.badges}>
                  {facility.services.map((s) => (
                    <Badge key={s} label={humanizeTag(s)} />
                  ))}
                </View>
              </View>
            ) : null}

            {facility.booking_url ? (
              <Button
                label="Book online"
                icon="calendar"
                onPress={() => openWebsite(facility.booking_url as string)}
                style={styles.bookButton}
              />
            ) : null}

            <View
              style={[
                styles.actions,
                facility.booking_url ? styles.actionsTight : null,
              ]}
            >
              {facility.phone ? (
                <Button
                  label="Call"
                  variant="outline"
                  icon="phone.fill"
                  onPress={() => callNumber(facility.phone as string)}
                />
              ) : null}
              {facility.website ? (
                <Button
                  label="Website"
                  variant="outline"
                  icon="globe"
                  onPress={() => openWebsite(facility.website as string)}
                />
              ) : null}
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: { width: 20 },
  body: {
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },
  bodyPadded: {
    paddingHorizontal: Space.xl,
    gap: Space.md,
  },
  heroWrap: {
    width: "100%",
    height: 260,
    position: "relative",
    overflow: "hidden",
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  heroPhoto: { width: "100%", height: "100%" },
  heroScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 110,
  },
  heroBackBtn: {
    position: "absolute",
    top: Space.md,
    left: Space.xl,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  attributionWrap: {
    position: "absolute",
    bottom: Space.sm,
    left: Space.md,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  attributionText: { color: "#FFFFFF", opacity: 0.9 },
  identity: { gap: Space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: Space.xs },
  statsRow: { flexDirection: "row", gap: Space.sm },
  statTile: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: Space.md,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.lg,
  },
  deptCard: { gap: Space.xs },
  deptHeader: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  deptTitle: { flex: 1 },
  infoCard: { gap: Space.md },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  infoText: { flex: 1, gap: Space.xs },
  infoDivider: { height: StyleSheet.hairlineWidth },
  hoursLine: { flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { marginBottom: Space.xs },
  bookButton: { marginTop: Space.md },
  actions: { flexDirection: "row", gap: Space.md, marginTop: Space.md },
  actionsTight: { marginTop: 0 },
});

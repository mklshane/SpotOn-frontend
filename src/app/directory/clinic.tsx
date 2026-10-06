import { t, useLocale } from '@/lib/i18n';
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { hasPhone, usePhoneCall } from "@/components/directory/use-phone-call";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { ListState } from "@/components/ui/list-state";
import { Screen } from "@/components/ui/screen";
import { Radius, Space } from "@/constants/theme";
import {
  distanceMeters,
  getFacility,
  getFacilityDoctors,
  type FacilityDoctor,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useKnownLocation } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { zonedDayMinutes } from "@/lib/directory-core";
import {
  facilityNameParts,
  formatDistance,
  formatFeeRange,
  formatSchedule,
  formatShortDate,
  humanizeTag,
} from "@/lib/format";
import { formatHours, openChangeLabel, openStatus } from "@/lib/hours";
import { normalizeUrl, openDirections, openWebsite } from "@/lib/links";

const SUPPORT_EMAIL = "help.spoton@gmail.com";

/** facility_type is advisory; only the values a patient can act on get a badge. */
const CARE_TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  aesthetic: "Aesthetic only",
  mixed: "Medical & aesthetic",
};

/**
 * Clinic details. Ordered by what a patient deciding where to go needs, top to bottom:
 * who/what it is → is it open and how far → act (book, call, directions, website) → hours →
 * where → skin services → which doctors → fee and the rest. The actions used to sit below the
 * fold under the services list, and Directions had no button at all.
 */
export default function ClinicDetailScreen() {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useConnectivity();
  const coords = useKnownLocation();
  const phone = usePhoneCall();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [facility, setFacility] = useState<FacilitySync | null>(null);
  const [doctors, setDoctors] = useState<FacilityDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Reset loading/error during render when `id` changes (not synchronously in
  // the effect body below, which trips react-hooks/set-state-in-effect).
  const [loadedKey, setLoadedKey] = useState(`${id}:${attempt}`);
  if (`${id}:${attempt}` !== loadedKey) {
    setLoadedKey(`${id}:${attempt}`);
    setLoading(true);
    setError(false);
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getFacility(id), getFacilityDoctors(id)])
      .then(([f, d]) => {
        if (cancelled) return;
        setFacility(f);
        setDoctors(d);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/directory");
  }, []);

  const showHero = !loading && !error && !!facility?.photo_url;

  return (
    <Screen padded={false} edges={showHero ? ["bottom"] : ["top", "bottom"]}>
      {!showHero ? (
        <View style={styles.header}>
          <Pressable
            hitSlop={12}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            style={styles.headerBack}
          >
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
          <ThemedText type="headline" themeColor="textSecondary">
            {t("Clinic")}</ThemedText>
          <View style={styles.headerSpacer} />
        </View>
      ) : null}

      {loading ? (
        <ListState kind="loading" title={t("Loading clinic…")} />
      ) : error ? (
        <ListState
          kind="error"
          title={t("Couldn't load clinic")}
          subtitle={t("Something went wrong reading the saved directory.")}
          action={{ label: t("Try again"), onPress: retry }}
        />
      ) : !facility ? (
        <ListState
          kind="error"
          title={t("Clinic not found")}
          subtitle={t("It may have been removed from the directory.")}
          action={{ label: t("Back to directory"), onPress: goBack }}
        />
      ) : (
        <ClinicBody
          facility={facility}
          doctors={doctors}
          showHero={showHero}
          topInset={insets.top}
          isOnline={isOnline}
          distance={
            coords
              ? distanceMeters(coords.latitude, coords.longitude, facility.latitude, facility.longitude)
              : null
          }
          onCall={() => phone.call(facility.phone)}
        />
      )}

      {/* Sticky over the hero: the back button used to scroll away with the photo. */}
      {showHero ? (
        <Pressable
          hitSlop={12}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          style={[styles.heroBackBtn, { top: insets.top + Space.sm }]}
        >
          <Icon name="chevron.left" tintColor="#FFFFFF" size={20} />
        </Pressable>
      ) : null}
      {phone.sheet}
    </Screen>
  );
}

function ClinicBody({
  facility,
  doctors,
  showHero,
  topInset,
  isOnline,
  distance,
  onCall,
}: {
  facility: FacilitySync;
  doctors: FacilityDoctor[];
  showHero: boolean;
  topInset: number;
  isOnline: boolean;
  distance: number | null;
  onCall: () => void;
}) {
  const theme = useTheme();
  const status = openStatus(facility.weekday_hours, facility.weekend_hours);
  const change = openChangeLabel(status);
  const feeRange = formatFeeRange(facility.fee_min, facility.fee_max);
  const nameParts = facilityNameParts(facility);
  const bookingUrl = normalizeUrl(facility.booking_url);
  const websiteUrl = normalizeUrl(facility.website);
  const careType = facility.facility_type ? CARE_TYPE_LABEL[facility.facility_type] : undefined;
  const hasHours = !!(facility.weekday_hours || facility.weekend_hours);
  const { day } = zonedDayMinutes(new Date());
  const weekendToday = day === 0 || day === 6;
  const dept = facility.department_info;
  const hasDeptInfo = !!(dept && (dept.has_derm_department || dept.department_name || dept.opd_notes));
  // Derm-relevant services first: this is a skin-check app, and "Dermatology" buried after
  // "Dental" and "Diagnostics" in an alphabetical facet list is the wrong emphasis.
  const services = [...facility.services].sort(
    (a, b) => Number(!/derm|skin/i.test(a)) - Number(!/derm|skin/i.test(b)),
  );

  const summary: string[] = [];
  if (status.open != null) summary.push(change ? `${status.open ? t("Open") : t("Closed")} · ${change}` : status.open ? t("Open now") : t("Closed"));
  if (distance != null) summary.push(formatDistance(distance));
  if (facility.google_rating != null) summary.push(`★ ${facility.google_rating.toFixed(1)} ${t("on Google")}`);

  const reportIssue = () => {
    const subject = encodeURIComponent(`Incorrect clinic info: ${facility.name}`);
    const body = encodeURIComponent(`Clinic ID: ${facility.id}\n\nWhat is wrong:\n`);
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {showHero ? (
        <View style={styles.heroWrap}>
          <Image
            source={{ uri: facility.photo_url as string }}
            style={styles.heroPhoto}
            contentFit="cover"
            cachePolicy="disk"
            transition={200}
            accessibilityLabel={t("Photo of {{name}}", { name: facility.name })}
          />
          <LinearGradient
            colors={["rgba(0,0,0,0.5)", "rgba(0,0,0,0)"]}
            style={[styles.heroScrim, { height: topInset + 96 }]}
            pointerEvents="none"
          />
          {facility.photo_attribution ? (
            <View style={styles.attributionWrap}>
              <ThemedText type="caption" style={styles.attributionText}>
                {t("Photo:")} {facility.photo_attribution}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.bodyPadded}>
        {/* 1 · Identity */}
        <View style={styles.identity}>
          <ThemedText type="title1">{nameParts.title ?? facility.name}</ThemedText>
          {nameParts.affiliation ? (
            <ThemedText type="callout" themeColor="textSecondary">
              {t("Part of {{name}}", { name: nameParts.affiliation })}
            </ThemedText>
          ) : null}
          <View style={styles.badges}>
            <Badge label={humanizeTag(facility.type)} tone="brand" />
            {careType ? <Badge label={t(careType)} /> : null}
            {facility.has_philhealth ? <Badge label={t("PhilHealth")} /> : null}
          </View>
          {summary.length ? (
            <View style={styles.summaryRow}>
              {status.open != null ? (
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: status.open ? theme.riskLow : theme.riskHigh },
                  ]}
                />
              ) : null}
              <ThemedText type="subhead" themeColor="textSecondary" style={styles.summaryText}>
                {summary.join("  ·  ")}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* 2 · Actions, right under the title */}
        <View style={styles.actionRow}>
          {bookingUrl ? (
            <ActionTile
              icon="calendar"
              label={t("Book")}
              primary
              disabled={!isOnline}
              hint={t("Opens the booking page in your browser")}
              onPress={() => openWebsite(bookingUrl)}
            />
          ) : null}
          {hasPhone(facility.phone) ? (
            <ActionTile icon="phone.fill" label={t("Call")} primary={!bookingUrl} onPress={onCall} />
          ) : null}
          <ActionTile
            icon="arrow.triangle.turn.up.right.diamond.fill"
            label={t("Directions")}
            onPress={() =>
              openDirections({
                googleMapsUrl: facility.google_maps_url,
                latitude: facility.latitude,
                longitude: facility.longitude,
              })
            }
          />
          {websiteUrl ? (
            <ActionTile
              icon="globe"
              label={t("Website")}
              disabled={!isOnline}
              hint={t("Opens the clinic's website in your browser")}
              onPress={() => openWebsite(websiteUrl)}
            />
          ) : null}
        </View>
        {!isOnline && (bookingUrl || websiteUrl) ? (
          <View style={styles.offlineNote}>
            <Icon name="wifi.slash" size={12} tintColor={theme.textSecondary} />
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("You're offline. Booking and websites need a connection; calling still works.")}
            </ThemedText>
          </View>
        ) : null}

        {/* 3 · Hours */}
        {hasHours ? (
          <Card style={styles.infoCard} elevation="sm">
            <View style={styles.cardHead}>
              <IconCircle icon="clock.fill" variant="tint" size={32} />
              <ThemedText type="headline">{t("Hours")}</ThemedText>
            </View>
            <HoursLine
              label={t("Mon–Fri")}
              value={formatHours(facility.weekday_hours)}
              today={!weekendToday}
            />
            <HoursLine
              label={t("Sat–Sun")}
              value={facility.weekend_hours ? formatHours(facility.weekend_hours) : t("Not listed")}
              today={weekendToday}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("Hours can change on holidays - call ahead to confirm.")}
            </ThemedText>
          </Card>
        ) : null}

        {/* 4 · Location */}
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
            accessibilityLabel={t("Get directions to {{address}}", { address: facility.address })}
          >
            <View style={styles.infoRow}>
              <IconCircle icon="mappin.circle.fill" variant="tint" size={36} />
              <View style={styles.infoText}>
                <ThemedText type="callout" numberOfLines={3}>
                  {facility.address}
                </ThemedText>
                {distance != null ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {t("{{distance}} from you", { distance: formatDistance(distance) })}
                  </ThemedText>
                ) : null}
              </View>
              <Icon name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </View>
          </Pressable>
        </Card>

        {/* 5 · Skin services (dermatology department merged in) */}
        {hasDeptInfo || services.length ? (
          <View style={styles.section}>
            <ThemedText type="title2">{t("Skin services")}</ThemedText>
            {hasDeptInfo ? (
              <Card style={[styles.deptCard, { backgroundColor: theme.brandTint }]} elevation="sm">
                <View style={styles.cardHead}>
                  <IconCircle icon="cross.case.fill" variant="gradient" size={36} />
                  <ThemedText type="headline" style={styles.flex}>
                    {t("Dermatology Department")}</ThemedText>
                  {dept?.has_derm_department ? <Badge label={t("Confirmed")} tone="brand" /> : null}
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
            {services.length ? (
              <View style={styles.badges}>
                {services.map((s) => (
                  <Badge key={s} label={humanizeTag(s)} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 6 · Doctors at this clinic */}
        {doctors.length ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="title2">{t("Doctors here")}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {doctors.length === 1 ? t("1 doctor") : t("{{count}} doctors", { count: doctors.length })}
              </ThemedText>
            </View>
            {doctors.map((d) => (
              <Pressable
                key={d.doctor.id}
                onPress={() => router.push({ pathname: "/directory/doctor", params: { id: d.doctor.id } })}
                accessibilityRole="button"
                accessibilityLabel={[d.doctor.name, d.schedule, d.bookable ? t("Books online") : null]
                  .filter(Boolean)
                  .join(", ")}
              >
                <Card style={styles.doctorRow} elevation="sm">
                  <IconCircle icon="stethoscope" size={40} variant="tint" />
                  <View style={styles.infoText}>
                    <ThemedText type="headline" numberOfLines={2}>
                      {d.doctor.name}
                    </ThemedText>
                    {d.schedule ? (
                      <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
                        {formatSchedule(d.schedule)}
                      </ThemedText>
                    ) : null}
                    {d.bookable ? (
                      <View style={styles.bookableTag}>
                        <Icon name="calendar" size={12} tintColor={theme.brandPressed} />
                        <ThemedText type="caption" style={{ color: theme.brandPressed }}>
                          {t("Books online")}
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <Icon name="chevron.right" size={14} tintColor={theme.textSecondary} />
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* 7 · Fee + about */}
        {feeRange || facility.description ? (
          <View style={styles.section}>
            <ThemedText type="title2">{t("About")}</ThemedText>
            {feeRange ? (
              <View style={styles.infoRow}>
                <IconCircle icon="banknote" variant="tint" size={32} />
                <ThemedText type="callout" style={styles.flex}>
                  {t("Consultation fee")} {feeRange}
                </ThemedText>
              </View>
            ) : null}
            {facility.description ? (
              <ThemedText type="callout" themeColor="textSecondary">
                {facility.description}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {/* 8 · Provenance + feedback loop for the directory's known data-quality gaps */}
        <View style={[styles.footer, { borderTopColor: theme.hairline }]}>
          <ThemedText type="footnote" themeColor="textSecondary">
            {t("Directory info updated {{date}}", { date: formatShortDate(facility.updated_at) })}
          </ThemedText>
          <Pressable onPress={reportIssue} accessibilityRole="link" hitSlop={8}>
            <ThemedText type="footnote" style={[styles.reportLink, { color: theme.brandPressed }]}>
              {t("Report incorrect info")}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function ActionTile({
  icon,
  label,
  primary,
  disabled,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = primary ? theme.onBrand : theme.brandPressed;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: primary ? theme.brandPressed : theme.elementBg },
        disabled && styles.tileDisabled,
        pressed && !disabled && styles.tilePressed,
      ]}
    >
      <Icon name={icon} size={20} tintColor={fg} />
      <ThemedText type="footnote" style={[styles.tileLabel, { color: primary ? theme.onBrand : theme.text }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function HoursLine({ label, value, today }: { label: string; value: string; today: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.hoursLine}>
      <View style={styles.hoursLabel}>
        <ThemedText type="callout" style={today ? styles.bold : undefined}>
          {label}
        </ThemedText>
        {today ? (
          <View style={[styles.todayPill, { backgroundColor: theme.brandTint }]}>
            <ThemedText type="caption" style={{ color: theme.brandPressed }}>
              {t("Today")}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="callout" themeColor={today ? "text" : "textSecondary"} style={today ? styles.bold : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.base,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBack: { width: 44, height: 44, justifyContent: "center" },
  headerSpacer: { width: 44 },
  body: {
    paddingBottom: Space.xxxl,
    gap: Space.lg,
  },
  bodyPadded: {
    paddingHorizontal: Space.xl,
    gap: Space.lg,
  },
  heroWrap: {
    width: "100%",
    height: 240,
    overflow: "hidden",
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  heroPhoto: { width: "100%", height: "100%" },
  heroScrim: { position: "absolute", top: 0, left: 0, right: 0 },
  heroBackBtn: {
    position: "absolute",
    left: Space.base,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  attributionWrap: {
    position: "absolute",
    bottom: Space.sm,
    right: Space.md,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  attributionText: { color: "#FFFFFF", opacity: 0.9 },
  identity: { gap: Space.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: Space.xs },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  summaryText: { flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  actionRow: { flexDirection: "row", gap: Space.sm },
  tile: {
    flex: 1,
    minHeight: 64,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  tilePressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  tileDisabled: { opacity: 0.45 },
  tileLabel: { fontWeight: "600" },
  offlineNote: { flexDirection: "row", alignItems: "center", gap: Space.xs, marginTop: -Space.sm },
  infoCard: { gap: Space.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  infoText: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  hoursLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Space.md },
  hoursLabel: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  todayPill: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill },
  bold: { fontWeight: "600" },
  section: { gap: Space.md },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  deptCard: { gap: Space.sm },
  doctorRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  bookableTag: { flexDirection: "row", alignItems: "center", gap: Space.xs, marginTop: 2 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Space.base,
    marginTop: Space.sm,
    gap: Space.sm,
  },
  reportLink: { fontWeight: "600" },
});

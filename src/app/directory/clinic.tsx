import { t, useLocale } from '@/lib/i18n';
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { FacilitySync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { ListingActions } from "@/components/directory/ListingActions";
import { PdsAttribution } from "@/components/directory/PdsAttribution";
import { hasPhone, phoneText, usePhoneCall } from "@/components/directory/use-phone-call";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { ListState } from "@/components/ui/list-state";
import { Screen } from "@/components/ui/screen";
import { Gradients, Radius, Space } from "@/constants/theme";
import {
  distanceMeters,
  getBestBookingLink,
  getFacility,
  getFacilityDoctors,
  HOSPITAL_TYPES,
  type FacilityDoctor,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useKnownLocation } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import { displayServices, isHospitalWithoutDerm, scheduleDayBit, zonedDayMinutes } from "@/lib/directory-core";
import { roomText, scheduleText } from "@/lib/directory-display";
import {
  facilityNameParts,
  formatDistance,
  formatFee,
  formatFeeRange,
  formatShortDate,
  humanizeTag,
} from "@/lib/format";
import { formatHours, openChangeLabel, openStatus } from "@/lib/hours";
import { useAuth } from "@/lib/auth";
import { normalizeUrl, openDirections, openWebsite, reportDirectoryIssue } from "@/lib/links";
import { mapsLink, type ShareListing } from "@/lib/share-listing";

/** facility_type is advisory; only the values a patient can act on get a badge. */
const CARE_TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  aesthetic: "Aesthetic only",
  mixed: "Medical & aesthetic",
};

/** What "Share" sends: where it is, how to reach it, and who is in when. */
function clinicShare(facility: FacilitySync, doctors: FacilityDoctor[]): ShareListing {
  const skinLine = hasPhone(facility.department_info?.phone) ? facility.department_info?.phone : null;
  const phone = skinLine ?? (hasPhone(facility.phone) ? facility.phone : null);
  const scheduled = doctors
    .filter((d) => d.schedule || d.schedule_days)
    .slice(0, 3)
    .map((d) => `${d.doctor.name}: ${scheduleText(d.schedule, d.schedule_days) ?? ""}`.trim());
  return {
    title: facilityNameParts(facility).title ?? facility.name,
    lines: [
      facility.address,
      phone ? t("Phone: {{phone}}", { phone: phoneText(phone) }) : null,
      scheduled.length ? t("Dermatologists:") : null,
      ...scheduled,
    ],
    mapsUrl: mapsLink(facility.google_maps_url, facility.latitude, facility.longitude),
  };
}

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

  // Every loaded clinic gets the hero layout: its photo, or a branded placeholder for the ~175
  // places Google has no photo of - so back/save/share sit in the same spot on every page.
  const showHero = !loading && !error && !!facility;
  const actions = facility ? (
    <ListingActions
      kind="facility"
      itemId={facility.id}
      name={facilityNameParts(facility).title ?? facility.name}
      subtitle={[facility.city, facility.province].filter(Boolean).join(", ") || null}
      share={clinicShare(facility, doctors)}
      onDark={showHero}
    />
  ) : null;

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
          {actions ?? <View style={styles.headerSpacer} />}
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
          onCall={phone.call}
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
      {showHero ? <View style={[styles.heroActions, { top: insets.top + Space.sm }]}>{actions}</View> : null}
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
  onCall: (phone: string | null | undefined) => void;
}) {
  const theme = useTheme();
  const signedIn = !!useAuth().user;
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
  const isHospital = (HOSPITAL_TYPES as readonly string[]).includes(facility.type);
  // Same rule as the list card and map preview (the doctors list is the count here).
  const noDermHere = isHospitalWithoutDerm(facility, doctors.length);
  // The skin clinic's own line (cited hospital research) beats the hospital trunk line.
  const skinClinicPhone = hasPhone(dept?.phone) ? dept?.phone ?? null : null;
  // Derm-relevant services first: this is a skin-check app, and "Dermatology" buried after
  // "Dental" and "Diagnostics" in an alphabetical facet list is the wrong emphasis. Hospital-wide
  // tags (oncology, histopathology) and anything on a hospital with no derm are not shown.
  const services = displayServices(facility.services, noDermHere).sort(
    (a, b) => Number(!/derm|skin/i.test(a)) - Number(!/derm|skin/i.test(b)),
  );
  // Who is in today first, then anyone with a published schedule, then the rest.
  const todayBit = scheduleDayBit(day);
  const orderedDoctors = useMemo(
    () =>
      [...doctors].sort(
        (a, b) =>
          Number(!((a.schedule_days ?? 0) & todayBit)) - Number(!((b.schedule_days ?? 0) & todayBit)) ||
          Number(!a.schedule) - Number(!b.schedule) ||
          a.doctor.name.localeCompare(b.doctor.name),
      ),
    [doctors, todayBit],
  );

  const summary: string[] = [];
  if (status.open != null) summary.push(change ? `${status.open ? t("Open") : t("Closed")} · ${change}` : status.open ? t("Open now") : t("Closed"));
  if (distance != null) summary.push(formatDistance(distance));
  if (facility.google_rating != null) summary.push(t("★ {{rating}} on Google", { rating: facility.google_rating.toFixed(1) }));

  // The clinic's own booking page when it has a working one (43_verify_booking_urls); otherwise
  // its dermatologists who can be booked online - one opens straight away, several get a picker.
  const bookableDoctors = orderedDoctors.filter((d) => d.bookable);
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const bookDoctor = (doctorId: string) =>
    getBestBookingLink(doctorId)
      .then((link) => (link ? openWebsite(link.url) : router.push({ pathname: "/directory/doctor", params: { id: doctorId } })))
      .catch(() => {});
  const onBook = () => {
    if (bookingUrl) openWebsite(bookingUrl);
    else if (bookableDoctors.length === 1) bookDoctor(bookableDoctors[0].doctor.id);
    else setBookPickerOpen(true);
  };

  const reportIssue = () =>
    signedIn
      ? router.push({ pathname: "/directory/report", params: { kind: "facility", id: facility.id, name: facility.name } })
      : reportDirectoryIssue("clinic", facility.name, facility.id);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {showHero && !facility.photo_url ? (
        <LinearGradient
          colors={Gradients.sunsetSoft.colors}
          locations={Gradients.sunsetSoft.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroWrap, styles.placeholderHero, { paddingTop: topInset }]}
        >
          <IconCircle icon={isHospital ? "cross.case.fill" : "building.2.fill"} variant="gradient" size={72} />
          <ThemedText type="subhead" style={[styles.placeholderLabel, { color: theme.brandPressed }]}>
            {humanizeTag(facility.type)}
          </ThemedText>
          {/* The back/save/share buttons are white on a dark disc - keep them readable here too. */}
          <LinearGradient
            colors={["rgba(33,26,21,0.18)", "rgba(33,26,21,0)"]}
            style={[styles.heroScrim, { height: topInset + 72 }]}
            pointerEvents="none"
          />
        </LinearGradient>
      ) : null}
      {showHero && facility.photo_url ? (
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
                {t("Photo: {{name}}", { name: facility.photo_attribution })}
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
            {/* Only a positive finding is shown: PhilHealth accredits hospitals, not private derm
                clinics, so "unknown" must never read as "not covered". */}
            {facility.has_philhealth ? (
              <Badge label={isHospital ? t("PhilHealth-accredited hospital") : t("PhilHealth-accredited")} />
            ) : null}
            {facility.pds_skin_cancer_center ? (
              <Badge label={t("PDS dermatology training hospital")} tone="brand" />
            ) : null}
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
          {bookingUrl || bookableDoctors.length ? (
            <ActionTile
              icon="calendar"
              label={t("Book")}
              primary
              disabled={!isOnline}
              hint={
                bookingUrl
                  ? t("Opens the booking page in your browser")
                  : t("Book online with a dermatologist who practises here")
              }
              onPress={onBook}
            />
          ) : null}
          {skinClinicPhone ? (
            <ActionTile
              icon="phone.fill"
              label={t("Skin clinic")}
              hint={t("Calls the dermatology clinic's own line")}
              primary={!bookingUrl && !bookableDoctors.length}
              onPress={() => onCall(skinClinicPhone)}
            />
          ) : null}
          {hasPhone(facility.phone) ? (
            <ActionTile
              icon="phone.fill"
              label={skinClinicPhone ? t("Hospital") : t("Call")}
              primary={!bookingUrl && !bookableDoctors.length && !skinClinicPhone}
              onPress={() => onCall(facility.phone)}
            />
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
              <ThemedText type="headline">{isHospital ? t("Hospital hours") : t("Hours")}</ThemedText>
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
              {isHospital
                ? t("Dermatologists keep their own clinic days, listed below. Call ahead to confirm.")
                : t("Hours can change on holidays - call ahead to confirm.")}
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
                {noDermHere ? (
                  <ThemedText type="callout" themeColor="textSecondary">
                    {t("This hospital has a dermatology department, but no dermatologists are listed online. Call the hospital's OPD for the skin clinic schedule.")}
                  </ThemedText>
                ) : null}
                {dept?.department_name && !/^dermatology$/i.test(dept.department_name.trim()) ? (
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

        {/* A hospital with no listed dermatologist stays visible - it may still run a skin clinic -
            but says so plainly instead of implying a derm is on site. */}
        {noDermHere && !hasDeptInfo ? (
          <Card style={styles.section} elevation="sm">
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("No dermatologist listed here yet. Call the hospital's OPD to ask about a skin clinic schedule.")}
            </ThemedText>
          </Card>
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
            {orderedDoctors.map((d) => (
              <Pressable
                key={d.doctor.id}
                onPress={() => router.push({ pathname: "/directory/doctor", params: { id: d.doctor.id } })}
                accessibilityRole="button"
                accessibilityLabel={[
                  d.doctor.name,
                  (d.schedule_days ?? 0) & todayBit ? t("In today") : null,
                  scheduleText(d.schedule, d.schedule_days),
                  d.bookable ? t("Books online") : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                <Card style={styles.doctorRow} elevation="sm">
                  <IconCircle icon="stethoscope" size={40} variant="tint" />
                  <View style={styles.infoText}>
                    <ThemedText type="headline" numberOfLines={2}>
                      {d.doctor.name}
                    </ThemedText>
                    {(d.schedule_days ?? 0) & todayBit ? (
                      <View style={styles.bookableTag}>
                        <Icon name="clock.fill" size={12} tintColor={theme.riskLow} />
                        <ThemedText type="caption" style={{ color: theme.riskLow }}>
                          {t("In today")}
                        </ThemedText>
                      </View>
                    ) : null}
                    {d.schedule || d.schedule_days ? (
                      <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={3}>
                        {scheduleText(d.schedule, d.schedule_days)}
                      </ThemedText>
                    ) : null}
                    {d.verified_at && (d.schedule || d.schedule_days) ? (
                      <ThemedText type="caption" themeColor="muted">
                        {t("Schedule checked {{date}}", { date: formatShortDate(d.verified_at) })}
                      </ThemedText>
                    ) : null}
                    {d.room || hasPhone(d.phone) ? (
                      <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                        {[
                          d.room ? roomText(d.room) : null,
                          hasPhone(d.phone) ? phoneText(d.phone) : null,
                          d.consultation_fee != null ? t("{{fee}} consult", { fee: formatFee(d.consultation_fee) }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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
                  {t("Consultation fee {{fee}}", { fee: feeRange })}
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
          <PdsAttribution style={styles.attribution} />
        </View>
      </View>
      <ActionSheet
        visible={bookPickerOpen}
        title={t("Book with a dermatologist here")}
        onClose={() => setBookPickerOpen(false)}
        options={bookableDoctors.map((d) => ({
          key: d.doctor.id,
          label: d.doctor.name,
          icon: "calendar" as const,
          onPress: () => bookDoctor(d.doctor.id),
        }))}
      />
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
      <ThemedText type="footnote" style={[styles.tileLabel, { color: primary ? theme.onBrand : theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
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
  placeholderHero: { height: 200, alignItems: "center", justifyContent: "center", gap: Space.sm },
  placeholderLabel: { fontWeight: "600" },
  heroScrim: { position: "absolute", top: 0, left: 0, right: 0 },
  heroActions: { position: "absolute", right: Space.base },
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
  attribution: { paddingVertical: 0 },
});

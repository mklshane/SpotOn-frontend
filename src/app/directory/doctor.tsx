import { t, useLocale } from '@/lib/i18n';
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { DoctorSync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { ListingActions } from "@/components/directory/ListingActions";
import { PdsAttribution } from "@/components/directory/PdsAttribution";
import { callLabel, hasPhone, phoneDials, usePhoneCall } from "@/components/directory/use-phone-call";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { ListState } from "@/components/ui/list-state";
import { Screen } from "@/components/ui/screen";
import { StarRating } from "@/components/ui/star-rating";
import { Radius, Space } from "@/constants/theme";
import {
  distanceMeters,
  getDoctor,
  getDoctorBookingLinks,
  getDoctorPractices,
  rankBookingLinks,
  type BookingLinkWithPlatform,
  type DoctorPractice,
} from "@/data/repositories";
import { looksLikePlaceName } from "@/lib/directory-core";
import { roomText, scheduleText, todayScheduleBit } from "@/lib/directory-display";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useKnownLocation } from "@/hooks/use-location";
import { useTheme } from "@/hooks/use-theme";
import {
  daysSince,
  facilityDisplayName,
  formatDistance,
  formatFee,
  formatShortDate,
  humanizeTag,
} from "@/lib/format";
import { isOpenNow } from "@/lib/hours";
import { useAuth } from "@/lib/auth";
import { normalizeUrl, openDirections, openWebsite, reportDirectoryIssue } from "@/lib/links";
import { mapsLink } from "@/lib/share-listing";

// Scraped availability text goes stale fast; past this age show the snapshot
// date instead of presenting it as current ("Not available" from weeks ago
// reads as a live fact).
const AVAILABILITY_STALE_DAYS = 30;

function futureSlot(link: BookingLinkWithPlatform): number | null {
  if (!link.next_available) return null;
  const at = new Date(link.next_available).getTime();
  return Number.isFinite(at) && at > Date.now() ? at : null;
}

function availabilityLine(link: BookingLinkWithPlatform): string | null {
  if (futureSlot(link) != null) {
    return t("Next slot: {{date}}", { date: formatShortDate(link.next_available as string) });
  }
  if (!link.available_text) return null;
  if (isStale(link)) {
    return t("Availability as of {{date}}", { date: formatShortDate(link.last_verified as string) });
  }
  return link.available_text;
}

function isStale(link: BookingLinkWithPlatform): boolean {
  return !!link.last_verified && daysSince(link.last_verified) > AVAILABILITY_STALE_DAYS;
}

/**
 * Best link first: a known upcoming slot beats none (soonest wins), then rating. The first one is
 * promoted to the page's primary action - booking is why most people open this screen (the Online
 * Booking tab only lists doctors who have links), and it used to be the last section.
 */
const rankLinks = rankBookingLinks;

export default function DoctorDetailScreen() {
  useLocale();
  const theme = useTheme();
  const { isOnline } = useConnectivity();
  const phone = usePhoneCall();
  const coords = useKnownLocation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doctor, setDoctor] = useState<DoctorSync | null>(null);
  const [links, setLinks] = useState<BookingLinkWithPlatform[]>([]);
  const [practices, setPractices] = useState<DoctorPractice[]>([]);
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
    Promise.all([getDoctor(id), getDoctorBookingLinks(id), getDoctorPractices(id)])
      .then(([d, l, p]) => {
        if (cancelled) return;
        setDoctor(d);
        setLinks(l);
        setPractices(p);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const ranked = useMemo(() => rankLinks(links), [links]);
  const signedIn = !!useAuth().user;
  const offersOnline = links.some((l) => l.offers_online === true);
  // Where they are in today first, then nearest, then the stored order (primary first).
  const todayBit = todayScheduleBit();
  const orderedPractices = useMemo(() => {
    const dist = (p: DoctorPractice) =>
      coords ? distanceMeters(coords.latitude, coords.longitude, p.facility.latitude, p.facility.longitude) : 0;
    return practices
      .map((p, i) => ({ p, i, d: dist(p), today: ((p.schedule_days ?? 0) & todayBit) !== 0 }))
      .sort((a, b) => Number(b.today) - Number(a.today) || a.d - b.d || a.i - b.i)
      .map(({ p, d }) => ({ ...p, distance_m: coords ? d : null }));
  }, [practices, coords, todayBit]);
  const [best, ...others] = ranked;
  const websiteUrl = normalizeUrl(doctor?.website);
  // About a fifth of PDS imports put a clinic name in `city` ("Dermcare Skin Clinic"); then the
  // first practice's city is the honest location line.
  const ownCity = doctor?.city && !looksLikePlaceName(doctor.city) ? doctor.city : null;
  const firstPlace = practices[0]?.facility;
  const location = ownCity
    ? [ownCity, doctor?.region].filter(Boolean).join(" · ")
    : firstPlace
      ? [firstPlace.city, firstPlace.province].filter(Boolean).join(", ")
      : doctor?.region ?? null;
  // Every number a clinic button above already dials; the direct line only shows if it adds one.
  const clinicDials = new Set(
    practices.flatMap((p) => phoneDials(hasPhone(p.phone) ? p.phone : p.facility.phone)),
  );
  const showDirectLine = phoneDials(doctor?.phone).some((d) => !clinicDials.has(d));

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/directory");
  }, []);

  return (
    <Screen padded={false}>
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
          {t("Doctor")}</ThemedText>
        {doctor ? (
          <ListingActions
            kind="doctor"
            itemId={doctor.id}
            name={doctor.name}
            subtitle={practices[0] ? facilityDisplayName(practices[0].facility) : doctor.city}
            share={{
              title: t("Dr. {{name}} - dermatologist", { name: doctor.name }),
              lines: practices.slice(0, 3).flatMap((p) => [
                facilityDisplayName(p.facility),
                p.facility.address,
                scheduleText(p.schedule, p.schedule_days),
                hasPhone(p.phone) ? p.phone : hasPhone(p.facility.phone) ? p.facility.phone : null,
              ]),
              mapsUrl: practices[0]
                ? mapsLink(practices[0].facility.google_maps_url, practices[0].facility.latitude, practices[0].facility.longitude)
                : null,
            }}
          />
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {loading ? (
        <ListState kind="loading" title={t("Loading doctor…")} />
      ) : error ? (
        <ListState
          kind="error"
          title={t("Couldn't load doctor")}
          subtitle={t("Something went wrong reading the saved directory.")}
          action={{ label: t("Try again"), onPress: () => setAttempt((a) => a + 1) }}
        />
      ) : !doctor ? (
        <ListState
          kind="error"
          title={t("Doctor not found")}
          subtitle={t("It may have been removed from the directory.")}
          action={{ label: t("Back to directory"), onPress: goBack }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* 1 · Identity */}
          <View style={styles.identity}>
            <IconCircle icon="stethoscope" size={72} variant="gradient" style={styles.avatar} />
            <ThemedText type="title1" style={styles.centered}>
              {doctor.name}
            </ThemedText>
            {/* Scraped titles often just repeat credentials already in the name. */}
            {doctor.title && !doctor.name.toLowerCase().includes(doctor.title.toLowerCase()) ? (
              <ThemedText type="callout" themeColor="textSecondary" style={styles.centered}>
                {doctor.title}
              </ThemedText>
            ) : null}
            {location ? (
              <View style={styles.locationRow}>
                <Icon name="mappin.circle.fill" size={14} tintColor={theme.textSecondary} />
                <ThemedText type="footnote" themeColor="textSecondary">
                  {location}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.badges}>
              {doctor.pds_certified ? <Badge label={t("PDS Certified")} tone="brand" /> : null}
              {offersOnline ? <Badge label={t("Online consultation")} /> : null}
              {doctor.specialties.map((s) => (
                <Badge key={s} label={humanizeTag(s)} />
              ))}
            </View>
          </View>

          {/* 2 · Book - the primary action, right after identity */}
          {best ? (
            <Card style={[styles.bookCard, { backgroundColor: theme.brandTint }]} elevation="sm">
              <View style={styles.bookHead}>
                <ThemedText type="headline" style={styles.flex}>
                  {t("Book on {{platform}}", { platform: best.platform?.name ?? t("a booking site") })}
                </ThemedText>
                {best.rating != null ? (
                  <StarRating rating={best.rating} reviewCount={best.review_count} />
                ) : null}
              </View>
              <LinkMeta link={best} />
              <Button
                label={t("Book online")}
                icon="calendar"
                disabled={!isOnline}
                onPress={() => openWebsite(best.url)}
                accessibilityHint={t("Opens the booking page in your browser")}
              />
              {!isOnline ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {t("You're offline. Booking needs a connection.")}
                </ThemedText>
              ) : null}
            </Card>
          ) : (
            <Card style={styles.noBookCard} elevation="sm">
              <ThemedText type="headline">{t("No online booking")}</ThemedText>
              <ThemedText type="callout" themeColor="textSecondary">
                {practices.length
                  ? t("Call one of the clinics below to book an appointment.")
                  : t("Call the doctor's office to book an appointment.")}
              </ThemedText>
            </Card>
          )}

          {/* 3 · Where they practise - each with its own Call, since walk-in schedules and
              clinic phones are how most PH consultations get booked */}
          {practices.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText type="title2">{t("Practices at")}</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {practices.length === 1 ? t("1 clinic") : t("{{count}} clinics", { count: practices.length })}
                </ThemedText>
              </View>
              {orderedPractices.map((p) => {
                const open = isOpenNow(p.facility.weekday_hours, p.facility.weekend_hours);
                const place = [
                  p.distance_m != null ? formatDistance(p.distance_m) : null,
                  [p.facility.city, p.facility.province].filter(Boolean).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const name = facilityDisplayName(p.facility);
                const inToday = ((p.schedule_days ?? 0) & todayBit) !== 0;
                const schedule = scheduleText(p.schedule, p.schedule_days);
                const practicePhone = hasPhone(p.phone) ? p.phone : hasPhone(p.facility.phone) ? p.facility.phone : null;
                return (
                  <Card key={p.facility.id} style={styles.practiceCard} elevation="sm">
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: "/directory/clinic", params: { id: p.facility.id } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={[name, place, inToday ? t("In today") : null, schedule].filter(Boolean).join(", ")}
                      style={styles.linkTop}
                    >
                      <IconCircle icon="building.2.fill" size={40} variant="tint" />
                      <View style={styles.linkText}>
                        <ThemedText type="headline" numberOfLines={2}>
                          {name}
                        </ThemedText>
                        {place ? (
                          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                            {place}
                          </ThemedText>
                        ) : null}
                        {inToday ? (
                          <View style={styles.metaRow}>
                            <Icon name="clock.fill" size={12} tintColor={theme.riskLow} />
                            <ThemedText type="caption" style={{ color: theme.riskLow }}>
                              {t("In today")}
                            </ThemedText>
                          </View>
                        ) : null}
                        {schedule ? (
                          <View style={styles.metaRow}>
                            <Icon name="clock.fill" size={12} tintColor={theme.textSecondary} />
                            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={3} style={styles.availText}>
                              {schedule}
                            </ThemedText>
                          </View>
                        ) : null}
                        {p.room || p.consultation_fee != null ? (
                          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                            {[
                              p.room ? roomText(p.room) : null,
                              p.consultation_fee != null ? t("{{fee}} consult", { fee: formatFee(p.consultation_fee) }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </ThemedText>
                        ) : null}
                        {/* A hospital's own hours (often 24h) say nothing about this doctor. */}
                        {open != null && !inToday && p.facility.type === "dermatology_clinic" ? (
                          <ThemedText type="caption" style={{ color: open ? theme.riskLow : theme.textSecondary }}>
                            {open ? t("Clinic open now") : t("Clinic closed now")}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Icon name="chevron.right" size={16} tintColor={theme.textSecondary} />
                    </Pressable>
                    <View style={styles.actions}>
                      {practicePhone ? (
                        <Button
                          // The doctor's own clinic line beats the hospital trunk line.
                          label={callLabel(practicePhone)}
                          variant="outline"
                          icon="phone.fill"
                          onPress={() => phone.call(practicePhone)}
                          style={styles.actionButton}
                        />
                      ) : null}
                      {practicePhone ? (
                        // Beside a Call button the label won't fit ("Call (043) 773 6800" got
                        // clipped), so Directions is a round icon button there.
                        <Pressable
                          onPress={() =>
                            openDirections({
                              googleMapsUrl: p.facility.google_maps_url,
                              latitude: p.facility.latitude,
                              longitude: p.facility.longitude,
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={t("Directions to {{name}}", { name })}
                          hitSlop={4}
                          style={({ pressed }) => [
                            styles.directionsIcon,
                            { borderColor: theme.hairline },
                            pressed && styles.pressed,
                          ]}
                        >
                          <Icon name="arrow.triangle.turn.up.right.diamond.fill" size={18} tintColor={theme.brandPressed} />
                        </Pressable>
                      ) : (
                        <Button
                          label={t("Directions")}
                          variant="outline"
                          icon="arrow.triangle.turn.up.right.diamond.fill"
                          accessibilityLabel={t("Directions to {{name}}", { name })}
                          onPress={() =>
                            openDirections({
                              googleMapsUrl: p.facility.google_maps_url,
                              latitude: p.facility.latitude,
                              longitude: p.facility.longitude,
                            })
                          }
                          style={styles.actionButton}
                        />
                      )}
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : null}

          {/* 3b · The doctor's own number (PDS listing: often a secretary or mobile). Labelled, and
              skipped when it is one of the clinic lines above, so two Call buttons never dial the
              same place under different names. */}
          {showDirectLine ? (
            <View style={styles.section}>
              <ThemedText type="title2">{t("Doctor's direct line")}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {t("The doctor's own number from their PDS listing, often a secretary or clinic mobile.")}
              </ThemedText>
              <Button
                label={callLabel(doctor.phone)}
                variant="outline"
                icon="phone.fill"
                onPress={() => phone.call(doctor.phone)}
              />
            </View>
          ) : null}

          {/* 4 · Other booking platforms */}
          {others.length ? (
            <View style={styles.section}>
              <ThemedText type="title2">{t("More ways to book")}</ThemedText>
              {others.map((link) => (
                <Pressable
                  key={link.id}
                  onPress={() => openWebsite(link.url)}
                  disabled={!isOnline}
                  accessibilityRole="link"
                  accessibilityLabel={t("Book on {{platform}}", { platform: link.platform?.name ?? t("a booking site") })}
                  accessibilityHint={t("Opens the booking page in your browser")}
                  style={!isOnline ? styles.disabled : undefined}
                >
                  <Card style={styles.linkCard} elevation="sm">
                    <View style={styles.linkTop}>
                      <IconCircle icon="calendar" size={40} variant="tint" />
                      <View style={styles.linkText}>
                        <ThemedText type="headline" numberOfLines={1}>
                          {link.platform?.name ?? t("Booking site")}
                        </ThemedText>
                        {link.rating != null ? (
                          <StarRating rating={link.rating} reviewCount={link.review_count} />
                        ) : null}
                      </View>
                      <Icon name="arrow.up.right" size={16} tintColor={theme.brandPressed} />
                    </View>
                    <LinkMeta link={link} />
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* 5 · About + the doctor's website */}
          {doctor.description || websiteUrl ? (
            <View style={styles.section}>
              <ThemedText type="title2">{t("About")}</ThemedText>
              {doctor.description ? (
                <ThemedText type="callout" themeColor="textSecondary">
                  {doctor.description}
                </ThemedText>
              ) : null}
              {websiteUrl ? (
                <View style={styles.actions}>
                  <Button
                    label={t("Website")}
                    variant="outline"
                    icon="globe"
                    disabled={!isOnline}
                    onPress={() => openWebsite(websiteUrl)}
                    style={styles.actionButton}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 6 · Provenance, correction loop and the PDS credit (a condition of using its list) */}
          <View style={[styles.footer, { borderTopColor: theme.hairline }]}>
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("Directory info updated {{date}}", { date: formatShortDate(doctor.updated_at) })}
            </ThemedText>
            <Pressable
              onPress={() =>
                signedIn
                  ? router.push({ pathname: "/directory/report", params: { kind: "doctor", id: doctor.id, name: doctor.name } })
                  : reportDirectoryIssue("doctor", doctor.name, doctor.id)
              }
              accessibilityRole="link"
              hitSlop={8}
            >
              <ThemedText type="footnote" style={[styles.reportLink, { color: theme.brandPressed }]}>
                {t("Report incorrect info")}
              </ThemedText>
            </Pressable>
            <PdsAttribution style={styles.attribution} />
          </View>
        </ScrollView>
      )}
      {phone.sheet}
    </Screen>
  );
}

/** Fee + availability + verified date for one booking link, shown once each. */
function LinkMeta({ link }: { link: BookingLinkWithPlatform }) {
  const theme = useTheme();
  const availability = availabilityLine(link);
  if (link.consultation_fee == null && !availability && !link.last_verified) return null;
  return (
    <View style={styles.linkDetails}>
      {link.consultation_fee != null ? (
        <View style={styles.metaRow}>
          <ThemedText type="subhead" style={styles.fee}>
            {formatFee(link.consultation_fee)}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {link.is_introductory_fee ? t("intro consultation fee") : t("consultation fee")}
          </ThemedText>
        </View>
      ) : null}
      {availability ? (
        <View style={styles.metaRow}>
          <Icon name="clock.fill" size={12} tintColor={theme.textSecondary} />
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2} style={styles.availText}>
            {availability}
          </ThemedText>
        </View>
      ) : null}
      {/* The stale-availability line already carries this date; don't print it twice. */}
      {link.last_verified && !(availability && isStale(link) && futureSlot(link) == null) ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {t("Verified {{date}}", { date: formatShortDate(link.last_verified) })}
        </ThemedText>
      ) : null}
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
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxxl,
    gap: Space.lg,
  },
  identity: {
    alignItems: "center",
    gap: Space.sm,
    marginTop: Space.sm,
  },
  avatar: { marginBottom: Space.xs },
  centered: { textAlign: "center" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: Space.xs },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Space.xs,
    marginTop: Space.xs,
  },
  flex: { flex: 1 },
  bookCard: { gap: Space.md, borderRadius: Radius.lg },
  bookHead: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  noBookCard: { gap: Space.xs },
  section: { gap: Space.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  actionButton: { flex: 1 },
  directionsIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pressed: { opacity: 0.7 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Space.base,
    marginTop: Space.sm,
    gap: Space.sm,
  },
  reportLink: { fontWeight: "600" },
  attribution: { paddingVertical: 0 },
  practiceCard: { gap: Space.md },
  linkCard: { gap: Space.base },
  linkTop: { flexDirection: "row", alignItems: "center", gap: Space.md },
  linkText: { flex: 1, gap: 2 },
  linkDetails: { gap: Space.sm },
  metaRow: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  fee: { fontWeight: "600" },
  availText: { flexShrink: 1 },
  disabled: { opacity: 0.5 },
});

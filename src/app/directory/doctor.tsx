import { t, useLocale } from '@/lib/i18n';
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { DoctorSync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { hasPhone, usePhoneCall } from "@/components/directory/use-phone-call";
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
  getDoctor,
  getDoctorBookingLinks,
  getDoctorPractices,
  type BookingLinkWithPlatform,
  type DoctorPractice,
} from "@/data/repositories";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useTheme } from "@/hooks/use-theme";
import {
  daysSince,
  facilityDisplayName,
  formatFee,
  formatSchedule,
  formatShortDate,
  humanizeTag,
} from "@/lib/format";
import { isOpenNow } from "@/lib/hours";
import { normalizeUrl, openWebsite } from "@/lib/links";

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
function rankLinks(links: BookingLinkWithPlatform[]): BookingLinkWithPlatform[] {
  return links
    .filter((l) => normalizeUrl(l.url) != null)
    .sort((a, b) => {
      const sa = futureSlot(a) ?? Infinity;
      const sb = futureSlot(b) ?? Infinity;
      if (sa !== sb) return sa - sb;
      return (b.rating ?? -1) - (a.rating ?? -1);
    });
}

export default function DoctorDetailScreen() {
  useLocale();
  const theme = useTheme();
  const { isOnline } = useConnectivity();
  const phone = usePhoneCall();
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
  const [best, ...others] = ranked;
  const websiteUrl = normalizeUrl(doctor?.website);

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
        <View style={styles.headerSpacer} />
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
            {doctor.city || doctor.region ? (
              <View style={styles.locationRow}>
                <Icon name="mappin.circle.fill" size={14} tintColor={theme.textSecondary} />
                <ThemedText type="footnote" themeColor="textSecondary">
                  {[doctor.city, doctor.region].filter(Boolean).join(" · ")}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.badges}>
              {doctor.pds_certified ? <Badge label={t("PDS Certified")} tone="brand" /> : null}
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
              {practices.map((p) => {
                const open = isOpenNow(p.facility.weekday_hours, p.facility.weekend_hours);
                const place = [p.facility.city, p.facility.province].filter(Boolean).join(", ");
                const name = facilityDisplayName(p.facility);
                return (
                  <Card key={p.facility.id} style={styles.practiceCard} elevation="sm">
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: "/directory/clinic", params: { id: p.facility.id } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={[name, place, p.schedule].filter(Boolean).join(", ")}
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
                        {p.schedule ? (
                          <View style={styles.metaRow}>
                            <Icon name="clock.fill" size={12} tintColor={theme.textSecondary} />
                            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2} style={styles.availText}>
                              {formatSchedule(p.schedule)}
                            </ThemedText>
                          </View>
                        ) : null}
                        {open != null ? (
                          <ThemedText type="caption" style={{ color: open ? theme.riskLow : theme.textSecondary }}>
                            {open ? t("Clinic open now") : t("Clinic closed now")}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Icon name="chevron.right" size={16} tintColor={theme.textSecondary} />
                    </Pressable>
                    {hasPhone(p.facility.phone) ? (
                      <Button
                        label={t("Call clinic")}
                        variant="outline"
                        icon="phone.fill"
                        onPress={() => phone.call(p.facility.phone)}
                      />
                    ) : null}
                  </Card>
                );
              })}
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

          {/* 5 · About + the doctor's own contacts (secondary to clinic phones) */}
          {doctor.description || hasPhone(doctor.phone) || websiteUrl ? (
            <View style={styles.section}>
              <ThemedText type="title2">{t("About")}</ThemedText>
              {doctor.description ? (
                <ThemedText type="callout" themeColor="textSecondary">
                  {doctor.description}
                </ThemedText>
              ) : null}
              {hasPhone(doctor.phone) || websiteUrl ? (
                <View style={styles.actions}>
                  {hasPhone(doctor.phone) ? (
                    <Button
                      label={t("Call")}
                      variant="outline"
                      icon="phone.fill"
                      onPress={() => phone.call(doctor.phone)}
                      style={styles.actionButton}
                    />
                  ) : null}
                  {websiteUrl ? (
                    <Button
                      label={t("Website")}
                      variant="outline"
                      icon="globe"
                      disabled={!isOnline}
                      onPress={() => openWebsite(websiteUrl)}
                      style={styles.actionButton}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
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
          {t("Verified")} {formatShortDate(link.last_verified)}
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
  actions: { flexDirection: "row", gap: Space.sm },
  actionButton: { flex: 1 },
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

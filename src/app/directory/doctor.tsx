import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { DoctorSync } from "@/api/types";
import { ThemedText } from "@/components/themed-text";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { ListState } from "@/components/ui/list-state";
import { Screen } from "@/components/ui/screen";
import { StarRating } from "@/components/ui/star-rating";
import { Space } from "@/constants/theme";
import {
  getDoctor,
  getDoctorBookingLinks,
  type BookingLinkWithPlatform,
} from "@/data/repositories";
import { useTheme } from "@/hooks/use-theme";
import {
  daysSince,
  formatFee,
  formatShortDate,
  humanizeTag,
} from "@/lib/format";
import { openWebsite } from "@/lib/links";

// Scraped availability text goes stale fast; past this age show the snapshot
// date instead of presenting it as current ("Not available" from weeks ago
// reads as a live fact).
const AVAILABILITY_STALE_DAYS = 30;

function availabilityLine(link: BookingLinkWithPlatform): string | null {
  if (
    link.next_available &&
    new Date(link.next_available).getTime() > Date.now()
  ) {
    return `Next slot: ${formatShortDate(link.next_available)}`;
  }
  if (!link.available_text) return null;
  if (
    link.last_verified &&
    daysSince(link.last_verified) > AVAILABILITY_STALE_DAYS
  ) {
    return `Availability as of ${formatShortDate(link.last_verified)}`;
  }
  return link.available_text;
}

export default function DoctorDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doctor, setDoctor] = useState<DoctorSync | null>(null);
  const [links, setLinks] = useState<BookingLinkWithPlatform[]>([]);
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
    Promise.all([getDoctor(id), getDoctorBookingLinks(id)])
      .then(([d, l]) => {
        if (cancelled) return;
        setDoctor(d);
        setLinks(l);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Screen padded={false}>
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
          Doctor
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ListState kind="loading" title="Loading doctor…" />
      ) : error ? (
        <ListState
          kind="error"
          title="Couldn't load doctor"
          subtitle="Check your connection and try again."
        />
      ) : !doctor ? (
        <ListState kind="error" title="Doctor not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <IconCircle
              icon="stethoscope"
              size={84}
              variant="gradient"
              style={styles.avatar}
            />
            <ThemedText type="title1" style={styles.centered}>
              {doctor.name}
            </ThemedText>
            {doctor.title ? (
              <ThemedText
                type="callout"
                themeColor="textSecondary"
                style={styles.centered}
              >
                {doctor.title}
              </ThemedText>
            ) : null}
            {doctor.city || doctor.region ? (
              <View style={styles.locationRow}>
                <Icon
                  name="mappin.circle.fill"
                  size={14}
                  tintColor={theme.muted}
                />
                <ThemedText type="footnote" themeColor="muted">
                  {[doctor.city, doctor.region].filter(Boolean).join(" · ")}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.badges}>
              {doctor.pds_certified ? (
                <Badge label="PDS Certified" tone="brand" />
              ) : null}
              {doctor.specialties.map((s) => (
                <Badge key={s} label={humanizeTag(s)} />
              ))}
            </View>
          </View>

          {doctor.description ? (
            <ThemedText type="callout" themeColor="textSecondary">
              {doctor.description}
            </ThemedText>
          ) : null}

          <View style={styles.sectionHeader}>
            <ThemedText type="title2">Book online</ThemedText>
            {links.length > 0 ? (
              <ThemedText type="footnote" themeColor="muted">
                {links.length === 1
                  ? "1 platform"
                  : `${links.length} platforms`}
              </ThemedText>
            ) : null}
          </View>
          {links.length === 0 ? (
            <ListState
              kind="empty"
              title="No booking links yet"
              subtitle="Check back later."
            />
          ) : (
            links.map((link) => {
              const availability = availabilityLine(link);
              return (
                <Pressable
                  key={link.id}
                  onPress={() => openWebsite(link.url)}
                  accessibilityRole="button"
                >
                  <Card style={styles.linkCard} elevation="sm">
                    <View style={styles.linkTop}>
                      <IconCircle icon="calendar" size={40} variant="tint" />
                      <View style={styles.linkText}>
                        <ThemedText type="headline" numberOfLines={1}>
                          {link.platform?.name ?? "Booking platform"}
                        </ThemedText>
                        {link.rating != null ? (
                          <StarRating
                            rating={link.rating}
                            reviewCount={link.review_count}
                          />
                        ) : null}
                      </View>
                      <Icon
                        name="arrow.up.right"
                        size={16}
                        tintColor={theme.brand}
                      />
                    </View>

                    {link.consultation_fee != null ||
                    availability ||
                    link.last_verified ? (
                      <View
                        style={[
                          styles.linkDetails,
                          { borderTopColor: theme.hairline },
                        ]}
                      >
                        {link.consultation_fee != null ? (
                          <View style={styles.metaRow}>
                            <ThemedText type="subhead" style={styles.fee}>
                              {formatFee(link.consultation_fee)}
                            </ThemedText>
                            <ThemedText type="footnote" themeColor="muted">
                              {link.is_introductory_fee
                                ? "intro consultation fee"
                                : "consultation fee"}
                            </ThemedText>
                          </View>
                        ) : null}
                        {availability ? (
                          <View style={styles.metaRow}>
                            <Icon
                              name="clock.fill"
                              size={12}
                              tintColor={theme.muted}
                            />
                            <ThemedText
                              type="footnote"
                              themeColor="muted"
                              numberOfLines={2}
                              style={styles.availText}
                            >
                              {availability}
                            </ThemedText>
                          </View>
                        ) : null}
                        {link.last_verified ? (
                          <ThemedText type="caption" themeColor="muted">
                            Verified {formatShortDate(link.last_verified)}
                          </ThemedText>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                </Pressable>
              );
            })
          )}
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
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },
  identity: {
    alignItems: "center",
    gap: Space.sm,
    marginTop: Space.sm,
    marginBottom: Space.sm,
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: Space.md,
  },
  linkCard: { gap: Space.base },
  linkTop: { flexDirection: "row", alignItems: "center", gap: Space.md },
  linkText: { flex: 1, gap: 2 },
  linkDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Space.md,
    gap: Space.sm,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  fee: { fontWeight: "600" },
  availText: { flexShrink: 1 },
});

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { StarRating } from '@/components/ui/star-rating';
import { Space } from '@/constants/theme';
import { getDoctor, getDoctorBookingLinks, type BookingLinkWithPlatform } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatFee, humanizeTag } from '@/lib/format';
import { openWebsite } from '@/lib/links';

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
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
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
        <ListState kind="error" title="Couldn't load doctor" subtitle="Check your connection and try again." />
      ) : !doctor ? (
        <ListState kind="error" title="Doctor not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <ThemedText type="title1">{doctor.name}</ThemedText>
            {doctor.title ? (
              <ThemedText type="body" themeColor="textSecondary">
                {doctor.title}
              </ThemedText>
            ) : null}
            <View style={styles.badges}>
              {doctor.pds_certified ? <Badge label="PDS Certified" tone="brand" /> : null}
              {doctor.specialties.map((s) => (
                <Badge key={s} label={humanizeTag(s)} />
              ))}
            </View>
          </View>

          <ThemedText type="title2" style={styles.sectionTitle}>
            Book online
          </ThemedText>
          {links.length === 0 ? (
            <ListState kind="empty" title="No booking links yet" subtitle="Check back later." />
          ) : (
            links.map((link) => (
              <Pressable key={link.id} onPress={() => openWebsite(link.url)} accessibilityRole="button">
                <Card style={styles.linkCard} elevation="sm">
                  <View style={styles.linkTop}>
                    <ThemedText type="headline">{link.platform?.name ?? 'Booking platform'}</ThemedText>
                    <Icon name="globe" size={16} tintColor={theme.brand} />
                  </View>
                  <View style={styles.linkMeta}>
                    {link.consultation_fee != null ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {formatFee(link.consultation_fee)}
                        {link.is_introductory_fee ? ' (intro)' : ''}
                      </ThemedText>
                    ) : null}
                    {link.rating != null ? <StarRating rating={link.rating} reviewCount={link.review_count} /> : null}
                  </View>
                  {link.available_text ? (
                    <ThemedText type="footnote" themeColor="muted">
                      {link.available_text}
                    </ThemedText>
                  ) : null}
                </Card>
              </Pressable>
            ))
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  identity: { gap: Space.sm, marginBottom: Space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginTop: Space.xs },
  sectionTitle: { marginTop: Space.md },
  linkCard: { gap: Space.xs },
  linkTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});

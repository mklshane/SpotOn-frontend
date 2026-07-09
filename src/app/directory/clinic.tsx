import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { StarRating } from '@/components/ui/star-rating';
import { Space } from '@/constants/theme';
import type { FacilitySync } from '@/api/types';
import { getFacility } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatFeeRange, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';
import { callNumber, openDirections, openWebsite } from '@/lib/links';

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

  const open = facility ? isOpenNow(facility.weekday_hours, facility.weekend_hours) : null;
  const feeRange = facility ? formatFeeRange(facility.fee_min, facility.fee_max) : null;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Clinic
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ListState kind="loading" title="Loading clinic…" />
      ) : error ? (
        <ListState kind="error" title="Couldn't load clinic" subtitle="Check your connection and try again." />
      ) : !facility ? (
        <ListState kind="error" title="Clinic not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <ThemedText type="title1">{facility.name}</ThemedText>
            <View style={styles.badges}>
              <Badge label={humanizeTag(facility.type)} tone="brand" />
              {open != null ? <Badge label={open ? 'Open Now' : 'Closed'} /> : null}
              {facility.has_philhealth ? <Badge label="PhilHealth" /> : null}
            </View>
            {facility.google_rating != null ? <StarRating rating={facility.google_rating} /> : null}
          </View>

          <Pressable
            onPress={() =>
              openDirections({
                googleMapsUrl: facility.google_maps_url,
                latitude: facility.latitude,
                longitude: facility.longitude,
              })
            }>
            <Card style={styles.row} elevation="sm">
              <Icon name="mappin.circle.fill" size={18} tintColor={theme.brand} />
              <ThemedText type="body" style={styles.rowText}>
                {facility.address}
              </ThemedText>
            </Card>
          </Pressable>

          <Card style={styles.hoursCard} elevation="sm">
            <ThemedText type="headline">Hours</ThemedText>
            <View style={styles.hoursRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Mon–Fri
              </ThemedText>
              <ThemedText type="footnote">{formatHours(facility.weekday_hours)}</ThemedText>
            </View>
            <View style={styles.hoursRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Sat–Sun
              </ThemedText>
              <ThemedText type="footnote">{formatHours(facility.weekend_hours)}</ThemedText>
            </View>
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

          {feeRange ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Consultation fee: {feeRange}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            {facility.phone ? (
              <Button label="Call" variant="outline" icon="phone.fill" onPress={() => callNumber(facility.phone as string)} />
            ) : null}
            {facility.website ? (
              <Button label="Website" variant="outline" icon="globe" onPress={() => openWebsite(facility.website as string)} />
            ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  identity: { gap: Space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowText: { flex: 1 },
  hoursCard: { gap: Space.xs },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { marginBottom: Space.xs },
  actions: { flexDirection: 'row', gap: Space.md, marginTop: Space.md },
});

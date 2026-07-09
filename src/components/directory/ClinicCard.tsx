import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';
import { callNumber, openDirections } from '@/lib/links';

export type ClinicCardProps = {
  facility: FacilitySync | FacilityWithDistance;
  onPress: () => void;
};

export function ClinicCard({ facility, onPress }: ClinicCardProps) {
  const theme = useTheme();
  const distance = 'distance_m' in facility ? facility.distance_m : null;
  const open = isOpenNow(facility.weekday_hours, facility.weekend_hours);
  const topService = facility.services[0];

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: theme.brand }]} />
            {distance != null ? (
              <ThemedText type="caption" themeColor="brand" style={styles.distance}>
                {formatDistance(distance)}
              </ThemedText>
            ) : null}
            {open != null ? (
              <View style={[styles.statusDot, { backgroundColor: open ? theme.riskLow : theme.muted }]} />
            ) : null}
          </View>

          <View style={styles.body}>
            <ThemedText type="headline">{facility.name}</ThemedText>

            <View style={styles.badges}>
              {facility.has_philhealth ? <Badge label="PhilHealth" /> : null}
              {open != null ? <Badge label={open ? 'Open Now' : 'Closed'} tone={open ? 'brand' : 'neutral'} /> : null}
              <Badge label={humanizeTag(facility.type)} />
              {topService ? <Badge label={humanizeTag(topService)} /> : null}
            </View>

            <View style={styles.info}>
              <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                {facility.address}
              </ThemedText>
              <ThemedText type="footnote" themeColor="muted">
                Mon–Fri {formatHours(facility.weekday_hours)}
              </ThemedText>
              {facility.phone ? (
                <ThemedText type="footnote" themeColor="muted">
                  {facility.phone}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() =>
                  openDirections({
                    googleMapsUrl: facility.google_maps_url,
                    latitude: facility.latitude,
                    longitude: facility.longitude,
                  })
                }
                style={[styles.actionFilled, { backgroundColor: theme.brand }]}
                accessibilityRole="button">
                <Icon name="arrow.triangle.turn.up.right.diamond.fill" size={14} tintColor={theme.onBrand} />
                <ThemedText type="footnote" themeColor="onBrand" style={styles.actionLabel}>
                  Directions
                </ThemedText>
              </Pressable>
              {facility.phone ? (
                <Pressable
                  onPress={() => callNumber(facility.phone as string)}
                  style={[styles.actionIcon, { backgroundColor: theme.elementBg }]}
                  accessibilityRole="button"
                  accessibilityLabel="Call">
                  <Icon name="phone.fill" size={16} tintColor={theme.brand} />
                </Pressable>
              ) : null}
              <Pressable onPress={onPress} style={[styles.actionOutline, { borderColor: theme.hairline }]} accessibilityRole="button">
                <ThemedText type="footnote" themeColor="text" style={styles.actionLabel}>
                  Details
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  row: { flexDirection: 'row', gap: Space.md },
  rail: { width: 44, alignItems: 'center', gap: Space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  distance: { fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: Space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  info: { gap: 2, marginTop: Space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.sm },
  actionFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  actionIcon: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  actionOutline: {
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionLabel: { fontWeight: '600' },
});

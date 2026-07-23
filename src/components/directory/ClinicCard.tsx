import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { facilityDisplayName, formatDistance, humanizeTag } from '@/lib/format';
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
    <Pressable onPress={onPress} accessible={false}>
      <Card style={styles.card} elevation="sm">
        <View style={styles.row}>
          {distance != null ? (
            // Open/closed is already shown as a badge below — this rail only earns its
            // space when there's a distance to anchor it; otherwise it's just orphaned dots.
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: theme.brand }]} />
              <ThemedText type="caption" themeColor="brand" style={styles.distance}>
                {formatDistance(distance)}
              </ThemedText>
              {open != null ? (
                <View style={[styles.statusDot, { backgroundColor: open ? theme.riskLow : theme.muted }]} />
              ) : null}
            </View>
          ) : null}

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <ThemedText type="headline" style={styles.title}>
                {facilityDisplayName(facility)}
              </ThemedText>
              {facility.photo_url ? (
                <Image
                  source={{ uri: facility.photo_url }}
                  style={styles.thumb}
                  contentFit="cover"
                  cachePolicy="disk"
                  accessibilityLabel={`Photo of ${facility.name}`}
                />
              ) : null}
            </View>

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
                hitSlop={4}
                accessibilityRole="button">
                <Icon name="arrow.triangle.turn.up.right.diamond.fill" size={14} tintColor={theme.onBrand} />
                <ThemedText
                  type="footnote"
                  themeColor="onBrand"
                  style={styles.actionLabel}
                  numberOfLines={1}>
                  Directions
                </ThemedText>
              </Pressable>
              {facility.phone ? (
                <Pressable
                  onPress={() => callNumber(facility.phone as string)}
                  style={[styles.actionIcon, { backgroundColor: theme.elementBg }]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Call">
                  <Icon name="phone.fill" size={16} tintColor={theme.brand} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={onPress}
                style={[styles.actionOutline, { borderColor: theme.hairline }]}
                hitSlop={4}
                accessibilityRole="button">
                <ThemedText type="footnote" themeColor="text" style={styles.actionLabel} numberOfLines={1}>
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
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  title: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: Radius.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  info: { gap: 2, marginTop: Space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.sm },
  actionFilled: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    gap: Space.xs,
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  actionIcon: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOutline: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionLabel: { fontWeight: '600' },
});

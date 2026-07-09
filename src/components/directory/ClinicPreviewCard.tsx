import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';

export type ClinicPreviewCardProps = {
  facility: FacilitySync | FacilityWithDistance;
  onClose: () => void;
};

const MAX_SERVICES_SHOWN = 2;

/** The callout attached to a tapped map pin (rendered inside a MapLibre `Marker`). */
export function ClinicPreviewCard({ facility, onClose }: ClinicPreviewCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const distance = 'distance_m' in facility ? facility.distance_m : null;
  const open = isOpenNow(facility.weekday_hours, facility.weekend_hours);

  const shown = facility.services.slice(0, MAX_SERVICES_SHOWN);
  const extra = facility.services.length - shown.length;
  // Never show the raw taxonomy tag — humanize the service list, or the practice type if there are no services.
  const specialization = shown.length ? shown.map(humanizeTag).join('; ') : humanizeTag(facility.type);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <ThemedText type="headline" style={styles.name} numberOfLines={1}>
          {facility.name}
        </ThemedText>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="xmark" size={16} tintColor={theme.muted} />
        </Pressable>
      </View>

      <View style={styles.specRow}>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.spec} numberOfLines={1}>
          {specialization}
        </ThemedText>
        {extra > 0 ? (
          <ThemedText type="footnote" themeColor="brand" style={styles.more}>
            {' '}
            +{extra} more
          </ThemedText>
        ) : null}
      </View>

      {open != null ? (
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.hoursRow} accessibilityRole="button">
          <Icon name="clock.fill" size={14} tintColor={open ? theme.riskLow : theme.riskHigh} />
          <ThemedText type="footnote" themeColor={open ? 'riskLow' : 'riskHigh'} style={styles.hoursLabel}>
            {open ? 'Open Now' : 'Closed Now'}
          </ThemedText>
          <Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={12} tintColor={theme.muted} />
        </Pressable>
      ) : null}
      {expanded ? (
        <View style={styles.hoursDetail}>
          <ThemedText type="caption" themeColor="muted">
            Mon–Fri {formatHours(facility.weekday_hours)}
          </ThemedText>
          <ThemedText type="caption" themeColor="muted">
            Sat–Sun {formatHours(facility.weekend_hours)}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText type="footnote" themeColor="muted" numberOfLines={1} style={styles.address}>
        {distance != null ? `${formatDistance(distance)} (Near You) · ` : ''}
        {facility.address}
      </ThemedText>

      <View style={styles.buttonWrap}>
        <Button
          label="Details"
          variant="brand"
          onPress={() => router.push({ pathname: '/directory/clinic', params: { id: facility.id } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderRadius: Radius.lg, padding: Space.base, gap: Space.xs, ...Elevation.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  name: { flex: 1 },
  specRow: { flexDirection: 'row', flexWrap: 'wrap' },
  spec: { flexShrink: 1 },
  more: { textDecorationLine: 'underline', fontWeight: '600' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  hoursLabel: { fontWeight: '600' },
  hoursDetail: { gap: 2, paddingLeft: Space.lg },
  address: {},
  buttonWrap: { marginTop: Space.xs },
});

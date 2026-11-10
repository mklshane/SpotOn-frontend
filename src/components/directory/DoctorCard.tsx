import { t, useLocale } from '@/lib/i18n';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { looksLikePlaceName } from '@/lib/directory-core';
import type { DoctorCardInfo } from '@/data/repositories';
import { formatDistance, humanizeTag } from '@/lib/format';

export type DoctorCardProps = {
  doctor: DoctorSync;
  onPress: () => void;
  /** Metres to the doctor's nearest practice, when the user's location is known. */
  distanceM?: number | null;
  /** Primary practice, clinic days and bookability (from doctorCardInfo). */
  info?: DoctorCardInfo;
  /** Today's bit in the schedule_days mask. */
  todayBit: number;
};

export function DoctorCard({ doctor, onPress, distanceM, info, todayBit }: DoctorCardProps) {
  useLocale();
  const theme = useTheme();
  const specialty = doctor.specialties_display || doctor.specialties.map(humanizeTag).join(', ');
  // `city` sometimes holds a clinic name; show the region alone rather than a fake location.
  const city = doctor.city && !looksLikePlaceName(doctor.city) ? doctor.city : null;
  const location = [city, doctor.region].filter(Boolean).join(' · ');
  const inToday = !!info && (info.daysMask & todayBit) !== 0;
  const a11yLabel = [
    doctor.name,
    specialty,
    info?.practiceName,
    distanceM != null ? formatDistance(distanceM) : location || null,
    inToday ? t('In today') : null,
    info?.online ? t('Online consult') : info?.bookable ? t('Books online') : null,
    doctor.pds_certified ? t('PDS Certified') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11yLabel}>
      <Card style={styles.card} elevation="sm">
        <View style={styles.top}>
          <IconCircle icon="stethoscope" size={48} variant="tint" />
          <View style={styles.text}>
            <ThemedText type="headline" numberOfLines={2}>
              {doctor.name}
            </ThemedText>
            {specialty ? (
              <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
                {specialty}
              </ThemedText>
            ) : null}
            {info?.practiceName ? (
              <View style={styles.practice}>
                <Icon name="building.2.fill" size={12} tintColor={theme.muted} />
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1} style={styles.locationText}>
                  {info.practiceName}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <Icon name="chevron.right" size={14} tintColor={theme.muted} style={styles.chevron} />
        </View>

        <View style={styles.footer}>
          {location || distanceM != null ? (
            <View style={styles.location}>
              <Icon name="mappin.circle.fill" size={13} tintColor={theme.muted} />
              {distanceM != null ? (
                <ThemedText type="caption" themeColor="brand" style={styles.distance}>
                  {formatDistance(distanceM)}
                </ThemedText>
              ) : null}
              {location ? (
                <ThemedText type="caption" themeColor="muted" numberOfLines={1} style={styles.locationText}>
                  {distanceM != null ? `· ${location}` : location}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <View style={styles.location} />
          )}
          <View style={styles.tags}>
            {inToday ? <Badge label={t("In today")} tone="brand" /> : null}
            {info?.online ? (
              <Badge label={t("Online consult")} />
            ) : info?.bookable ? (
              <Badge label={t("Books online")} />
            ) : null}
            {doctor.pds_certified && !inToday && !info?.bookable ? (
              <Badge label={t("PDS Certified")} tone="brand" />
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  text: { flex: 1, gap: 2 },
  chevron: { marginLeft: Space.xs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginTop: Space.base,
  },
  location: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  locationText: { flexShrink: 1 },
  distance: { fontWeight: '700' },
  practice: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 2 },
  tags: { flexDirection: 'row', gap: Space.xs, flexShrink: 0 },
});

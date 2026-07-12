import { Pressable, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanizeTag } from '@/lib/format';

export type DoctorCardProps = { doctor: DoctorSync; onPress: () => void };

export function DoctorCard({ doctor, onPress }: DoctorCardProps) {
  const theme = useTheme();
  const specialty = doctor.specialties_display || doctor.specialties.map(humanizeTag).join(', ');
  const location = [doctor.city, doctor.region].filter(Boolean).join(' · ');

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
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
          </View>
          <Icon name="chevron.right" size={14} tintColor={theme.muted} style={styles.chevron} />
        </View>

        <View style={styles.footer}>
          {location ? (
            <View style={styles.location}>
              <Icon name="mappin.circle.fill" size={13} tintColor={theme.muted} />
              <ThemedText type="caption" themeColor="muted" numberOfLines={1} style={styles.locationText}>
                {location}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.location} />
          )}
          {doctor.pds_certified ? <Badge label="PDS Certified" tone="brand" /> : null}
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
});

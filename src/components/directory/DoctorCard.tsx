import { Pressable, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Space } from '@/constants/theme';
import { humanizeTag } from '@/lib/format';

export type DoctorCardProps = { doctor: DoctorSync; onPress: () => void };

export function DoctorCard({ doctor, onPress }: DoctorCardProps) {
  const specialty = doctor.specialties_display || doctor.specialties.map(humanizeTag).join(', ');

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.top}>
          <View style={styles.text}>
            <ThemedText type="headline">{doctor.name}</ThemedText>
            {specialty ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {specialty}
              </ThemedText>
            ) : null}
            {doctor.city ? (
              <ThemedText type="footnote" themeColor="muted">
                {doctor.city}
              </ThemedText>
            ) : null}
          </View>
          {doctor.pds_certified ? <Badge label="PDS Certified" tone="brand" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.sm },
  text: { flex: 1, gap: 2 },
});

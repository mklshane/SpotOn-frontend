import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DirectorySegment = 'clinics' | 'doctors';

const SEGMENTS: { value: DirectorySegment; label: string; icon: IconName }[] = [
  { value: 'clinics', label: 'Clinics', icon: 'building.2.fill' },
  { value: 'doctors', label: 'Online Booking', icon: 'stethoscope' },
];

export type DirectorySegmentsProps = {
  value: DirectorySegment;
  onChange: (value: DirectorySegment) => void;
};

/** Two gray tab pills. Active = brand-filled pill with white icon+label; inactive = muted gray. */
export function DirectorySegments({ value, onChange }: DirectorySegmentsProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {SEGMENTS.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            style={[styles.pill, { backgroundColor: active ? theme.brand : theme.elementBg }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Icon name={segment.icon} size={16} tintColor={active ? theme.onBrand : theme.muted} />
            <ThemedText type="subhead" themeColor={active ? 'onBrand' : 'muted'} style={styles.label}>
              {segment.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 40,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  label: { fontWeight: '600' },
});

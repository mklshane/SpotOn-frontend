import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type BadgeProps = {
  label: string;
  /** `brand` for a called-out tag (e.g. the facility's practice type); `neutral` (default) for everything else. */
  tone?: 'neutral' | 'brand';
  style?: ViewStyle | ViewStyle[];
};

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const theme = useTheme();
  const bg = tone === 'brand' ? theme.brandTint : theme.elementBg;

  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <ThemedText type="caption" themeColor={tone === 'brand' ? 'brand' : 'textSecondary'} style={styles.label}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '600' },
});

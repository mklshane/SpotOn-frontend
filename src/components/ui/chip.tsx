import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ChipProps = {
  label: string;
  active?: boolean;
  icon?: IconName;
  /**
   * `tint` (default) is the quiet toggle used inside a filter sheet.
   * `solid` is the higher-contrast browse filter — white when idle, filled
   * brand when selected — for chip rails that sit directly on a page.
   */
  variant?: 'tint' | 'solid';
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

/** Toggleable filter chip. */
export function Chip({ label, active = false, icon, variant = 'tint', onPress, style }: ChipProps) {
  const theme = useTheme();
  const solid = variant === 'solid';

  const background = active
    ? solid
      ? theme.brand
      : theme.brandTint
    : solid
      ? theme.surface
      : theme.elementBg;
  const foreground = active ? (solid ? theme.onBrand : theme.brand) : theme.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background },
        // The solid rail sits on the page background, where an unselected white
        // chip would otherwise disappear into the warm off-white behind it.
        solid && Elevation.sm,
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      {icon ? <Icon name={icon} size={14} tintColor={foreground} style={styles.icon} /> : null}
      <ThemedText type="subhead" style={[solid && styles.label, { color: foreground }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  icon: { marginRight: Space.xs },
  label: { fontWeight: '600' },
  pressed: { opacity: 0.75 },
});

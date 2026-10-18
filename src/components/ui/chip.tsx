import { useEffect } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Elevation, Motion, Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ChipProps = {
  label: string;
  active?: boolean;
  icon?: IconName;
  /**
   * `tint` (default) is the quiet toggle used inside a filter sheet.
   * `solid` is the higher-contrast browse filter - white when idle, filled
   * brand when selected - for chip rails that sit directly on a page.
   */
  variant?: 'tint' | 'solid';
  /** `sm` (36pt, +4pt hit slop) for dense filter rails; `md` (44pt) elsewhere. */
  size?: 'md' | 'sm';
  /** Trailing glyph, e.g. an ✕ on a removable chip. */
  trailingIcon?: IconName;
  accessibilityLabel?: string;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

/** Toggleable filter chip. Selection eases between colors rather than snapping. */
export function Chip({
  label,
  active = false,
  icon,
  variant = 'tint',
  size = 'md',
  trailingIcon,
  accessibilityLabel,
  onPress,
  style,
}: ChipProps) {
  const theme = useTheme();
  const solid = variant === 'solid';

  const idleBg = solid ? theme.surface : theme.elementBg;
  const activeBg = solid ? theme.brand : theme.brandTint;
  const idleFg = theme.textSecondary;
  const activeFg = solid ? theme.onBrand : theme.brand;

  // Selection and press are separate drivers: a chip can be held while already
  // selected, and the two should not overwrite one another.
  const selection = useSharedValue(active ? 1 : 0);
  const held = useSharedValue(0);

  useEffect(() => {
    selection.set(
      withTiming(active ? 1 : 0, {
        duration: Motion.fast,
        easing: Easing.out(Easing.quad),
        reduceMotion: ReduceMotion.System,
      })
    );
  }, [active, selection]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(selection.value, [0, 1], [idleBg, activeBg]),
    transform: [{ scale: 1 - held.value * (1 - Motion.pressScale) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(selection.value, [0, 1], [idleFg, activeFg]),
  }));

  const spring = { ...Motion.press, reduceMotion: ReduceMotion.System };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => held.set(withSpring(1, spring))}
      onPressOut={() => held.set(withSpring(0, spring))}
      // The solid rail sits on the page background, where an unselected white
      // chip would otherwise disappear into the warm off-white behind it.
      hitSlop={size === 'sm' ? 4 : undefined}
      style={[styles.chip, size === 'sm' && styles.chipSm, solid && Elevation.sm, containerStyle, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}>
      {/* The glyph switches color outright: it is small enough that easing it
          reads as a lag rather than a transition. */}
      {icon ? (
        <Icon name={icon} size={14} tintColor={active ? activeFg : idleFg} style={styles.icon} />
      ) : null}
      <Animated.Text style={[styles.label, (solid || size === 'sm') && styles.labelSolid, labelStyle]}>{label}</Animated.Text>
      {trailingIcon ? (
        <Icon name={trailingIcon} size={12} tintColor={active ? activeFg : idleFg} style={styles.trailing} />
      ) : null}
    </AnimatedPressable>
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
  chipSm: { height: 36, paddingHorizontal: Space.md },
  icon: { marginRight: Space.xs },
  trailing: { marginLeft: Space.xs },
  label: { ...Type.subhead },
  labelSolid: { fontWeight: '600' },
});

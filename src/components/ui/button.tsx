import { Icon, type IconName } from '@/components/ui/icon';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Elevation, Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'brand' | 'ink' | 'outline' | 'ghost';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: IconName;
  style?: any;
};

export function Button({
  label,
  variant = 'brand',
  loading = false,
  icon,
  disabled,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const isDisabled = disabled || loading;
  const filled = variant === 'brand' || variant === 'ink';

  const textColor =
    variant === 'brand'
      ? theme.onBrand
      : variant === 'ink'
        ? theme.background
        : variant === 'ghost'
          ? theme.brand
          : theme.text;

  const surfaceStyle =
    variant === 'brand'
      ? { backgroundColor: theme.brand }
      : variant === 'ink'
        ? { backgroundColor: theme.text }
        : variant === 'outline'
          ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.hairline }
          : { backgroundColor: 'transparent' }; // ghost

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPressIn={() => (scale.value = withSpring(0.97, { damping: 18, stiffness: 320 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 18, stiffness: 320 }))}
      style={[styles.base, isDisabled && styles.disabled, animatedStyle]}
      {...rest}>
      <View style={[styles.surface, surfaceStyle, filled && !isDisabled && Elevation.md]} />
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <>
            {icon ? (
              <Icon name={icon} tintColor={textColor} size={18} style={styles.icon} />
            ) : null}
            <ThemedText style={[styles.label, { color: textColor }]}>{label}</ThemedText>
          </>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 58,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
  },
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.pill,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  icon: { marginRight: 2 },
  label: { ...Type.headline },
  disabled: { opacity: 0.5 },
});

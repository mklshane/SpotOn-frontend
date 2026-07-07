import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

export type SwitchProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 4; // 2px inset each side

/**
 * On/off toggle matching the app's warm-sunset design language (not the OS-native
 * Switch look). Only the thumb's `translateX` is animated — that's native-driver
 * eligible. The track's background color is set directly from `value`, not
 * animated, since animating `backgroundColor` can't use the native driver.
 */
export function Switch({ value, onChange, disabled = false }: SwitchProps) {
  const theme = useTheme();
  const translateX = useSharedValue(value ? THUMB_TRAVEL : 0);

  useEffect(() => {
    translateX.value = withTiming(value ? THUMB_TRAVEL : 0, { duration: 160 });
  }, [value, translateX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      onPress={() => !disabled && onChange(!value)}
      hitSlop={8}
      disabled={disabled}
      style={[
        styles.track,
        { backgroundColor: value ? theme.brand : theme.hairline },
        disabled && styles.disabled,
      ]}>
      <Animated.View style={[styles.thumb, { backgroundColor: theme.surface }, thumbStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
  disabled: { opacity: 0.5 },
});

import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far to shrink while held. Defaults to the app's press signature. */
  scaleTo?: number;
  /** How far to dim while held. */
  dimTo?: number;
};

/**
 * A Pressable that shrinks and dims very slightly while held, using the same
 * spring Button has always used so every tappable surface answers the same way.
 *
 * Replaces the `({ pressed }) => pressed && styles.pressed` idiom, which snaps
 * between two states instead of easing, and which drops the feedback entirely
 * the moment a press turns into a scroll.
 */
export function PressableScale({
  style,
  scaleTo = Motion.pressScale,
  dimTo = 0.92,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  // One 0..1 driver for both properties, so they can never fall out of sync.
  const held = useSharedValue(0);
  const spring = { ...Motion.press, reduceMotion: ReduceMotion.System };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - held.value * (1 - scaleTo) }],
    opacity: 1 - held.value * (1 - dimTo),
  }));

  return (
    <AnimatedPressable
      onPressIn={(event) => {
        held.set(withSpring(1, spring));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        held.set(withSpring(0, spring));
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}

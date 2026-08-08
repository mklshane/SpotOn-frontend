import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

/**
 * Screens whose opening sequence has already played this app session. A tab
 * screen normally stays mounted, so this only matters when one is torn down
 * and rebuilt: coming back should not replay a sequence the user has seen.
 */
const played = new Set<string>();

type EntranceValue = { stagger: number; duration: number };

const EntranceContext = createContext<EntranceValue>({ stagger: 0, duration: Motion.fast });

export type EntranceProviderProps = {
  /** Stable key identifying the screen, e.g. "learn". */
  screen: string;
  children: ReactNode;
};

/**
 * Drives the entrance of everything beneath it, in three phases:
 *
 *  - first arrival: elements fade up in sequence
 *  - after that sequence settles: anything that mounts later (filter results,
 *    a section reappearing) fades in on its own, quickly and without stagger,
 *    so acting on the screen never feels like waiting on it
 *  - reduced motion, or a return visit: no stagger at all
 */
export function EntranceProvider({ screen, children }: EntranceProviderProps) {
  const reduced = useReducedMotion();
  const [firstVisit] = useState(() => !played.has(screen));
  const [settled, setSettled] = useState(() => !firstVisit || reduced);

  useEffect(() => {
    played.add(screen);
  }, [screen]);

  useEffect(() => {
    if (settled) return;
    // Hand over to the quick, unstaggered phase once the opening sequence has
    // had time to finish. Without this, tapping a filter ten seconds later
    // would still stagger its results.
    const timer = setTimeout(() => setSettled(true), Motion.entrance.maxDelay + Motion.base);
    return () => clearTimeout(timer);
  }, [settled]);

  const value = useMemo<EntranceValue>(
    () =>
      settled
        ? { stagger: 0, duration: Motion.fast }
        : { stagger: Motion.entrance.stagger, duration: Motion.base },
    [settled]
  );

  return <EntranceContext.Provider value={value}>{children}</EntranceContext.Provider>;
}

export type EntranceProps = {
  /** Position in the sequence. Delay is `index * stagger`, capped. */
  index?: number;
  /** Explicit delay in ms, for sub-sequences with their own rhythm (chips). */
  delay?: number;
  /**
   * `rise` (default) fades up, for content arriving in a sequence.
   * `settle` fades and scales in place, for a single illustration resolving.
   * Sliding artwork looks like a card; scaling it looks like it developing.
   */
  variant?: 'rise' | 'settle';
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** Fades its child in, with a small upward drift or a soft scale. */
export function Entrance({ index = 0, delay, variant = 'rise', style, children }: EntranceProps) {
  const { stagger, duration } = useContext(EntranceContext);
  const progress = useSharedValue(0);

  useEffect(() => {
    // stagger === 0 is the settled/reduced phase: honour it over any explicit
    // delay, so late arrivals are never held back.
    const resolved = stagger === 0 ? 0 : Math.min(delay ?? index * stagger, Motion.entrance.maxDelay);

    progress.set(
      withDelay(
        resolved,
        withTiming(1, {
          duration,
          easing: Easing.out(Easing.cubic),
          // Collapses the timing to an instant set when the OS asks for
          // reduced motion, leaving the element simply present.
          reduceMotion: ReduceMotion.System,
        })
      )
    );

    return () => cancelAnimation(progress);
  }, [delay, duration, index, progress, stagger]);

  const rise = variant === 'rise';

  const animatedStyle = useAnimatedStyle(() => {
    const remaining = 1 - progress.value;
    return {
      opacity: progress.value,
      transform: rise
        ? [{ translateY: remaining * Motion.entrance.distance }]
        : [{ scale: 1 - remaining * Motion.entrance.settleScale }],
    };
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

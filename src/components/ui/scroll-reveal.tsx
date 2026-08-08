import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

type ScrollRevealValue = {
  scrollY: SharedValue<number>;
  viewport: number;
  enabled: boolean;
};

const ScrollRevealContext = createContext<ScrollRevealValue | null>(null);

/**
 * Fades content in as it scrolls into view, in either direction.
 *
 * Opacity only, like the rest of the Education module's motion: nothing moves,
 * so text never slides under the reader mid-sentence. A block is fully visible
 * well before it reaches the middle of the screen, which keeps the effect at
 * the edges of attention rather than in the way of reading.
 */
export function useScrollReveal() {
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const scrollY = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  const value = useMemo<ScrollRevealValue>(
    () => ({ scrollY, viewport: height, enabled: !reduced }),
    [height, reduced, scrollY]
  );

  return { value, onScroll };
}

export function ScrollRevealProvider({
  value,
  children,
}: {
  value: ScrollRevealValue;
  children: ReactNode;
}) {
  return <ScrollRevealContext.Provider value={value}>{children}</ScrollRevealContext.Provider>;
}

/** How far above the fold a block becomes fully opaque. */
const FULLY_VISIBLE_AT = 120;

export function Reveal({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const context = useContext(ScrollRevealContext);
  // Measured on layout. Until then the block is treated as on-screen, so
  // content is never invisible waiting for a measurement that has not run.
  const [top, setTop] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => setTop(event.nativeEvent.layout.y);

  const animatedStyle = useAnimatedStyle(() => {
    if (!context || !context.enabled || top === null) return { opacity: 1 };

    // Distance from the block's top to the bottom edge of the viewport.
    const distanceIntoView = context.scrollY.value + context.viewport - top;

    return {
      opacity: interpolate(distanceIntoView, [0, FULLY_VISIBLE_AT], [0, 1], 'clamp'),
    };
  });

  return (
    <Animated.View onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

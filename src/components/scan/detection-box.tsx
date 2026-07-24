import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

/** Lesion bounding box in normalized [0,1] coordinates of the camera preview (top-left origin). */
export type DetectionBBox = { x: number; y: number; w: number; h: number };

const LOCKED = '#34A878';
const SEARCHING = 'rgba(255,255,255,0.85)';
const SPRING = { damping: 24, stiffness: 320 }; // snappy — the box tracks the filtered detection with minimal settle-lag

/**
 * The box's screen-space pose, held in Reanimated shared values rather than React state.
 *
 * The detector emits up to 12 boxes/second. Routing those through `useState` re-rendered the whole
 * capture screen at that rate and restarted four springs per render, which is what made the camera
 * lag on low-end Android. Writing shared values instead keeps the animation entirely on the UI
 * thread: the spring still interpolates the 12 Hz detections up to display rate, but React never
 * runs. `active` is 0 while searching and 1 while tracking a lesion.
 */
export type DetectionBoxValues = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  active: SharedValue<number>;
};

/** The centered "searching" pose the box rests in when nothing is detected. */
function searchingRect() {
  const { width, height } = Dimensions.get('window');
  const side = width * 0.42;
  return { x: (width - side) / 2, y: height * 0.42 - side / 2, w: side, h: side };
}

export function useDetectionBoxValues(): DetectionBoxValues {
  const rest = searchingRect();
  const x = useSharedValue(rest.x);
  const y = useSharedValue(rest.y);
  const w = useSharedValue(rest.w);
  const h = useSharedValue(rest.h);
  const active = useSharedValue(0);
  // Stable identity: callers put this in effect and frame-processor dependency arrays, where a
  // fresh object each render would re-run the effect (and rebuild the worklet) every time.
  return useMemo(() => ({ x, y, w, h, active }), [x, y, w, h, active]);
}

/**
 * Spring the box to a detected lesion. `bbox` is normalized to the preview, matching what the
 * frame processor produces. Safe to call from the JS thread — Reanimated runs the spring on the
 * UI thread without a React render.
 */
export function trackDetectionBox(v: DetectionBoxValues, bbox: DetectionBBox): void {
  const { width, height } = Dimensions.get('window');
  v.x.value = withSpring(bbox.x * width, SPRING);
  v.y.value = withSpring(bbox.y * height, SPRING);
  v.w.value = withSpring(bbox.w * width, SPRING);
  v.h.value = withSpring(bbox.h * height, SPRING);
  v.active.value = 1;
}

/** Return the box to its centered searching pose (detection lost). */
export function resetDetectionBox(v: DetectionBoxValues): void {
  const rest = searchingRect();
  v.x.value = withSpring(rest.x, SPRING);
  v.y.value = withSpring(rest.y, SPRING);
  v.w.value = withSpring(rest.w, SPRING);
  v.h.value = withSpring(rest.h, SPRING);
  v.active.value = 0;
}

/**
 * The "AI camera" detection box. When the detector reports a lesion the box springs to and
 * tracks it (green = locked); with no detection it sits centered as a searching guide.
 * Renders once and is driven entirely by `values` thereafter.
 */
export function DetectionBox({ values }: { values: DetectionBoxValues }) {
  const style = useAnimatedStyle(() => ({
    left: values.x.value,
    top: values.y.value,
    width: values.w.value,
    height: values.h.value,
    borderColor: values.active.value > 0.5 ? LOCKED : SEARCHING,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.box, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2.5,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
});

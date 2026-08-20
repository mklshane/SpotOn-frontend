import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { boxSpring, DETECTION_SMOOTHING_CONFIG as CFG } from '@/lib/detection-smoothing';

/** Lesion bounding box in normalized [0,1] coordinates of the camera preview (top-left origin). */
export type DetectionBBox = { x: number; y: number; w: number; h: number };

const LOCKED = '#34A878';
const SEARCHING = 'rgba(255,255,255,0.85)';

/**
 * Critically damped (see detection-smoothing.ts). This spring's only job is to carry the box
 * between detections — filling the ~83 ms between inference results at display refresh rate. It is
 * NOT the smoothing layer; the 1€ filter upstream is, and a spring asked to smooth as well would
 * only add lag. Stiffness is unchanged from the value that shipped, so arrival is no slower; what
 * changed is the damping, which was 0.67 of critical and therefore overshot every detection.
 */
const SPRING = boxSpring();

/**
 * The box's screen-space pose, held in Reanimated shared values rather than React state.
 *
 * The detector emits up to 12 boxes/second. Routing those through `useState` re-rendered the whole
 * capture screen at that rate and restarted four springs per render, which is what made the camera
 * lag on low-end Android. Writing shared values instead keeps the animation entirely on the UI
 * thread: the spring interpolates the 12 Hz detections up to display rate, but React never runs.
 *
 * `active` is a 0..1 cross-fade between the two views below, not a visibility flag — see
 * DetectionBox for why that distinction is what removes the teleport on detection loss.
 */
export type DetectionBoxValues = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  active: SharedValue<number>;
};

/** The centered "searching" guide the overlay rests in when nothing is detected. */
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
 * Spring the box to a detected lesion. `bbox` is normalized to the preview, matching what the frame
 * processor produces. Safe to call from the JS thread — Reanimated runs the spring on the UI thread
 * without a React render.
 *
 * `snap` places the box instantly instead of springing, and is what re-acquisition and lesion
 * handover use. Springing on the first detection of a track would glide the box across the screen
 * from wherever the previous one died, which reads as a teleport with a trail; placing it under a
 * fade-in reads as the box simply appearing where the lesion is. Every subsequent frame springs
 * normally, so live tracking is unaffected.
 */
export function trackDetectionBox(
  v: DetectionBoxValues,
  bbox: DetectionBBox,
  opts?: { snap?: boolean },
): void {
  const { width, height } = Dimensions.get('window');
  const px = bbox.x * width;
  const py = bbox.y * height;
  const pw = bbox.w * width;
  const ph = bbox.h * height;
  if (opts?.snap) {
    v.x.value = px;
    v.y.value = py;
    v.w.value = pw;
    v.h.value = ph;
  } else {
    v.x.value = withSpring(px, SPRING);
    v.y.value = withSpring(py, SPRING);
    v.w.value = withSpring(pw, SPRING);
    v.h.value = withSpring(ph, SPRING);
  }
  v.active.value = withTiming(1, { duration: CFG.fadeInMs });
}

/**
 * Detection lost: cross-fade back to the searching guide. The tracked box fades out WHERE IT
 * STANDS — its pose is left untouched, because it is a different view from the guide — so the user
 * never sees it travel back to the centre.
 *
 * `immediate` skips the fade for teardown paths (leaving the screen, switching the Guide off),
 * where there is nothing to animate for.
 */
export function resetDetectionBox(v: DetectionBoxValues, opts?: { immediate?: boolean }): void {
  v.active.value = opts?.immediate ? 0 : withTiming(0, { duration: CFG.fadeOutMs });
}

/**
 * The Guide overlay: a centered white searching outline and a green tracked box,
 * cross-faded by `active`.
 *
 * TWO VIEWS, ON PURPOSE. A single view that both tracked the lesion and served as the searching
 * guide had to be moved back to the centre when detection was lost, and any way of doing that is
 * visible — spring it and the box flies across the screen, jump it and it teleports. Separating
 * them means the tracked box can simply fade out in place while the guide fades in behind it, and
 * neither one ever moves anywhere the user did not expect.
 *
 * Colour semantics are unchanged from the single-view version: green means "a lesion is being
 * tracked", white means "looking". Green is deliberately NOT wired to the detector's `locked` flag
 * (LOCK_SCORE) — that governs the coach's 'ready' state, and repointing the colour at it would
 * quietly change what green tells the user.
 *
 * Corner radius and stroke width are constants on both views, so they never scale with the box —
 * that is what keeps a resizing box reading as movement rather than deformation.
 */
export function DetectionBox({ values }: { values: DetectionBoxValues }) {
  const rest = useMemo(() => searchingRect(), []);

  const guideStyle = useAnimatedStyle(() => ({
    left: rest.x,
    top: rest.y,
    width: rest.w,
    height: rest.h,
    opacity: 1 - values.active.value,
  }));

  const trackedStyle = useAnimatedStyle(() => ({
    left: values.x.value,
    top: values.y.value,
    width: values.w.value,
    height: values.h.value,
    opacity: values.active.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.box, styles.searching, guideStyle]} />
      <Animated.View style={[styles.box, styles.locked, trackedStyle]} />
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
  searching: { borderColor: SEARCHING },
  locked: { borderColor: LOCKED },
});

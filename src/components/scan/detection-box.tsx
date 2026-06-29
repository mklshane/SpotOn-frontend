import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';

/** Lesion bounding box in normalized [0,1] coordinates of the camera preview (top-left origin). */
export type DetectionBBox = { x: number; y: number; w: number; h: number };

const LOCKED = '#34A878';
const SEARCHING = 'rgba(255,255,255,0.85)';
const SPRING = { damping: 18, stiffness: 180 };

/**
 * The "AI camera" detection box. When the detector reports a lesion (`bbox`), the box
 * springs to and tracks it (green = locked). With no detection it sits centered as a
 * searching guide. The ML phase just needs to feed live `bbox` values here.
 */
export function DetectionBox({ bbox }: { bbox: DetectionBBox | null }) {
  const { width, height } = useWindowDimensions();

  const defW = width * 0.42;
  const target = bbox
    ? { left: bbox.x * width, top: bbox.y * height, w: bbox.w * width, h: bbox.h * height }
    : { left: (width - defW) / 2, top: height * 0.42 - defW / 2, w: defW, h: defW };

  const left = useSharedValue(target.left);
  const top = useSharedValue(target.top);
  const w = useSharedValue(target.w);
  const h = useSharedValue(target.h);

  useEffect(() => {
    left.value = withSpring(target.left, SPRING);
    top.value = withSpring(target.top, SPRING);
    w.value = withSpring(target.w, SPRING);
    h.value = withSpring(target.h, SPRING);
  }, [target.left, target.top, target.w, target.h, left, top, w, h]);

  const style = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
    width: w.value,
    height: h.value,
  }));

  const color = bbox ? LOCKED : SEARCHING;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.box, style, { borderColor: color }]}>
        <Icon name="plus" tintColor={color} size={20} />
      </Animated.View>
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

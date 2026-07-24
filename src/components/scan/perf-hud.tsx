import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue, type ISharedValue } from 'react-native-worklets-core';

import {
  DETECTED_TIER,
  describeDeviceTier,
  setDeviceTierOverride,
  useDeviceTier,
  type DeviceTier,
} from '@/lib/device-tier';

/**
 * `__DEV__`-only performance HUD for the capture screen.
 *
 * Exists because the device that actually lags (a low-end Android) isn't the device we develop on.
 * Rather than guess, the frame processor writes its own timings into worklet shared values and
 * this panel drains them on the JS thread twice a second — so the numbers can be read off any
 * phone the app is installed on, with no profiler attached.
 *
 * What the four numbers mean:
 *   fp     — wall time of one frame-processor pass (resize + TFLite + YOLO decode). This is the
 *            budget: at 12 fps anything over ~80 ms means the camera thread is saturated.
 *   det    — detector passes actually completed per second (what `runAtTargetFps` achieved).
 *   js     — JS-thread frame rate. Drops below ~50 mean React work is starving the UI, which is
 *            the symptom the per-frame `setState` used to cause.
 *   tier   — resolved device tier; tap it to force one and exercise the low-end path on a fast phone.
 */

/** Counters written from the frame-processor worklet, drained by the HUD. */
export type PerfCounters = {
  /** Completed detector passes since the last drain. */
  frames: ISharedValue<number>;
  /** Summed frame-processor duration (ms) since the last drain. */
  sumMs: ISharedValue<number>;
  /** Worst single frame-processor duration (ms) since the last drain. */
  maxMs: ISharedValue<number>;
};

/**
 * Allocate the counters. Safe (and cheap) to call in production builds — the frame processor only
 * writes to them when `PERF_ENABLED` is set, and `PerfHud` renders nothing outside `__DEV__`.
 */
export function usePerfCounters(): PerfCounters {
  const frames = useSharedValue(0);
  const sumMs = useSharedValue(0);
  const maxMs = useSharedValue(0);
  // Stable identity — this lands in the frame processor's dependency array, and a fresh object
  // each render would rebuild the worklet on every render.
  return useMemo(() => ({ frames, sumMs, maxMs }), [frames, sumMs, maxMs]);
}

/**
 * Captured into the frame-processor worklet by value. `__DEV__` is a JS-runtime global and isn't
 * guaranteed to exist in the worklet runtime, so the check has to happen on this side.
 */
export const PERF_ENABLED = __DEV__;

const DRAIN_MS = 500;

type Snapshot = { avgMs: number; maxMs: number; detFps: number; jsFps: number };

const EMPTY: Snapshot = { avgMs: 0, maxMs: 0, detFps: 0, jsFps: 0 };

export function PerfHud({
  counters,
  /** Resolved camera format, e.g. "1280x720 / 2048x1536". */
  formatLabel,
}: {
  counters: PerfCounters;
  formatLabel: string;
}) {
  const insets = useSafeAreaInsets();
  const tier = useDeviceTier();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [collapsed, setCollapsed] = useState(false);

  // JS-thread frame rate: count rAF ticks between drains. If React work is blocking the thread
  // these stop arriving, which is exactly the jank we're hunting.
  const rafTicks = useRef(0);
  useEffect(() => {
    let handle = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      rafTicks.current += 1;
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(handle);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const n = counters.frames.value;
      const sum = counters.sumMs.value;
      const max = counters.maxMs.value;
      counters.frames.value = 0;
      counters.sumMs.value = 0;
      counters.maxMs.value = 0;

      const ticks = rafTicks.current;
      rafTicks.current = 0;

      setSnap({
        avgMs: n > 0 ? sum / n : 0,
        maxMs: max,
        detFps: (n * 1000) / DRAIN_MS,
        jsFps: (ticks * 1000) / DRAIN_MS,
      });
    }, DRAIN_MS);
    return () => clearInterval(id);
  }, [counters]);

  if (!__DEV__) return null;

  const cycleTier = () => {
    // auto → low → high → auto, so the low-end path can be exercised on a fast phone.
    const next: DeviceTier | null = tier === DETECTED_TIER ? 'low' : tier === 'low' ? 'high' : null;
    setDeviceTierOverride(next === DETECTED_TIER ? null : next);
  };

  if (collapsed) {
    return (
      <Pressable
        onPress={() => setCollapsed(false)}
        style={[styles.dot, { top: insets.top + 8 }]}
        accessibilityRole="button"
        accessibilityLabel="Show performance HUD">
        <Text style={styles.dotLabel}>{Math.round(snap.avgMs)}</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.root, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable onPress={() => setCollapsed(true)} style={styles.panel} accessibilityRole="button">
        <Text style={styles.line}>
          fp {snap.avgMs.toFixed(1)}ms · max {snap.maxMs.toFixed(0)}
        </Text>
        <Text style={styles.line}>
          det {snap.detFps.toFixed(1)}fps · js {snap.jsFps.toFixed(0)}fps
        </Text>
        <Text style={styles.line}>{formatLabel}</Text>
      </Pressable>
      <Pressable onPress={cycleTier} style={styles.panel} accessibilityRole="button">
        <Text style={styles.line}>{describeDeviceTier()}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', right: 8, gap: 4, alignItems: 'flex-end' },
  panel: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  line: { color: '#8CFFA0', fontSize: 10, fontVariant: ['tabular-nums'], textAlign: 'right' },
  dot: {
    position: 'absolute',
    right: 8,
    minWidth: 30,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
  },
  dotLabel: { color: '#8CFFA0', fontSize: 10, fontVariant: ['tabular-nums'] },
});

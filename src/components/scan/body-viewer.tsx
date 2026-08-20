/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { type Box3, Raycaster, Vector2, type Camera, type Group } from 'three';

import { ThemedText } from '@/components/themed-text';
import { resolveRegionFromPoint } from '@/lib/body-regions';
import { clampTarget, focalZoomTarget, toNdc } from '@/lib/orbit-camera';
import type { BodyMark } from '@/lib/triage/types';

import { BodyModel, type BodyModelStatus } from './body-model';
import { BodyLights, Marker } from './mannequin';

const TARGET_Y = -0.05;
const POLAR_MIN = 0.3;
const POLAR_MAX = Math.PI - 0.3;
/**
 * Orbit radius limits.
 *
 * RADIUS_MIN lowered 3.6 -> 1.0 (2026-08-20): 3.6 was not close enough to place a mark precisely.
 * The visible world height at radius r is 2*r*tan(fov/2) = 0.768*r, against a body normalised to
 * 3.7 units tall (body-model.tsx TARGET_HEIGHT), so:
 *     r 9.5  -> 7.3 units visible : the whole body with margin
 *     r 3.6  -> 2.8 units visible : about three quarters of the body — the old floor
 *     r 1.0  -> 0.8 units visible : roughly a forearm, enough to put a dot on one spot
 * The zoom range goes from 2.6x to 9.5x. 1.0 rather than lower because the orbit target can sit
 * inside the mesh when someone zooms at the body's centre line, and the camera has to stay outside
 * it — a torso is roughly 0.25 units in half-depth at this scale, so 1.0 keeps clear with room to
 * spare. Off-centre zoom moves the target toward the surface, which only adds margin.
 */
const RADIUS_MIN = 1.0;
const RADIUS_MAX = 9.5;
const FOV_DEG = 42;
const FOV_RAD = (FOV_DEG * Math.PI) / 180;
/**
 * How far outside the model's own bounding box the orbit target may be pushed. Zooming into an ear
 * needs the target to reach the ear, which is at the edge of the box; without a little slack the
 * clamp would fight the gesture exactly where off-centre zoom is most useful. Half a unit against a
 * body a few units tall is enough to be unnoticeable and still bounded.
 */
const TARGET_SLACK = 0.5;
/** Below this fraction of the zoom range the view is "pulled back", and recentres on release. */
const RECENTRE_AT = 0.98;

type SceneRefs = { camera: Camera; group: Group | null; width: number; height: number };

type BodyViewerProps = {
  mark: BodyMark | null;
  onPick: (mark: BodyMark) => void;
};

/** Drives the camera from shared values and exposes camera/size for manual raycasting. */
function Rig({
  azimuth,
  polar,
  radius,
  target,
  groupRef,
  sceneRef,
}: {
  azimuth: { value: number };
  polar: { value: number };
  radius: { value: number };
  target: { value: { x: number; y: number; z: number } };
  groupRef: React.RefObject<Group | null>;
  sceneRef: React.MutableRefObject<SceneRefs | null>;
}) {
  const { camera, size } = useThree();

  useEffect(() => {
    sceneRef.current = { camera, group: groupRef.current, width: size.width, height: size.height };
  }, [camera, size.width, size.height, groupRef, sceneRef]);

  useFrame(() => {
    const az = azimuth.value;
    const pol = polar.value;
    const r = radius.value;
    const t = target.value;
    const sinPol = Math.sin(pol);
    // Orbit around `target`, not the origin. The target is what zoom converges on, so moving it is
    // what makes a pinch zoom toward the fingers instead of toward the model's centre.
    camera.position.set(
      t.x + r * sinPol * Math.sin(az),
      t.y + r * Math.cos(pol),
      t.z + r * sinPol * Math.cos(az),
    );
    camera.lookAt(t.x, t.y, t.z);
  });

  return null;
}

export function BodyViewer({ mark, onPick }: BodyViewerProps) {
  const azimuth = useSharedValue(0);
  const polar = useSharedValue(Math.PI / 2);
  const radius = useSharedValue(6.4);
  const startAz = useSharedValue(0);
  const startPol = useSharedValue(Math.PI / 2);
  const startRad = useSharedValue(6.4);

  /** What the camera orbits and zooms toward. Moving it is what anchors zoom to the pinch. */
  const target = useSharedValue({ x: 0, y: TARGET_Y, z: 0 });
  const startTarget = useSharedValue({ x: 0, y: TARGET_Y, z: 0 });
  /**
   * The pinch anchor, in NDC, captured on the gesture's first update rather than read fresh each
   * frame. The focal point wanders as fingers move, and chasing it makes the model swim under the
   * hand; pinning it at the start means the gesture zooms toward the spot the user actually reached
   * for, and stays reversible — pinching back out returns to where it began.
   */
  const anchor = useSharedValue({ nx: 0, ny: 0, set: false });
  /** Viewport size, needed on the UI thread to turn a touch into NDC. */
  const viewW = useSharedValue(1);
  const viewH = useSharedValue(1);
  /** Model bounds, so off-centre zoom can't walk the camera off into empty space. */
  const bounds = useSharedValue({ minX: -1, minY: -2, minZ: -1, maxX: 1, maxY: 2, maxZ: 1 });

  const groupRef = useRef<Group | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const boxRef = useRef<Box3 | null>(null);
  const raycaster = useMemo(() => new Raycaster(), []);

  const [status, setStatus] = useState<BodyModelStatus>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleReady = useCallback(
    (box: Box3) => {
      boxRef.current = box;
      // Hand the bounds to the UI thread; the pinch handler clamps the target against them.
      /* eslint-disable-next-line react-hooks/immutability -- a Reanimated shared value is a
         native-backed handle, not React state; the compiler flags every write to one (the same
         false positive capture.tsx disables around its shared-value writes). */
      bounds.value = {
        minX: box.min.x, minY: box.min.y, minZ: box.min.z,
        maxX: box.max.x, maxY: box.max.y, maxZ: box.max.z,
      };
    },
    [bounds],
  );

  const handleStatus = useCallback((s: BodyModelStatus, message?: string) => {
    setStatus(s);
    if (message) setErrMsg(message);
  }, []);

  const pick = useCallback(
    (x: number, y: number) => {
      const s = sceneRef.current;
      const box = boxRef.current;
      if (!s || !s.group || !box) return;
      const ndc = new Vector2((x / s.width) * 2 - 1, -(y / s.height) * 2 + 1);
      raycaster.setFromCamera(ndc, s.camera);
      const hits = raycaster.intersectObjects(s.group.children, true);
      if (!hits.length) return;
      const p = hits[0].point;
      const cz = (box.max.z + box.min.z) / 2;
      onPick({
        point: [p.x, p.y, p.z],
        region: resolveRegionFromPoint(p, box),
        view: p.z >= cz ? 'front' : 'back',
      });
    },
    [onPick, raycaster],
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      startAz.value = azimuth.value;
      startPol.value = polar.value;
    })
    .onUpdate((e) => {
      'worklet';
      azimuth.value = startAz.value - e.translationX * 0.006;
      polar.value = Math.min(POLAR_MAX, Math.max(POLAR_MIN, startPol.value - e.translationY * 0.006));
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      startRad.value = radius.value;
      startTarget.value = target.value;
      anchor.value = { nx: 0, ny: 0, set: false };
    })
    .onUpdate((e) => {
      'worklet';
      // Capture the anchor on the first update: onBegin fires on touch-down, where the focal point
      // is not yet meaningful.
      if (!anchor.value.set) {
        const n = toNdc(e.focalX, e.focalY, viewW.value, viewH.value);
        anchor.value = { nx: n.nx, ny: n.ny, set: true };
      }
      const next = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, startRad.value / e.scale));
      radius.value = next;

      const st = startTarget.value;
      const a = anchor.value;
      const b = bounds.value;
      // Both the radius and the target are computed from the values at gesture START, never
      // accumulated frame to frame — so clamping at either end can't drift, and releasing and
      // re-pinching always resumes from a clean state.
      const moved = focalZoomTarget(
        [st.x, st.y, st.z],
        startRad.value,
        next,
        azimuth.value,
        polar.value,
        a.nx,
        a.ny,
        FOV_RAD,
        viewW.value / Math.max(1, viewH.value),
      );
      const c = clampTarget(
        moved,
        [b.minX, b.minY, b.minZ],
        [b.maxX, b.maxY, b.maxZ],
        TARGET_SLACK,
      );
      target.value = { x: c[0], y: c[1], z: c[2] };
    })
    .onEnd(() => {
      'worklet';
      // Zooming all the way back out recentres, so there is always a one-gesture way home from a
      // target that has wandered. Animated rather than snapped, and only at the very end of the
      // range so it can't interrupt ordinary zooming out.
      const outFraction = (radius.value - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
      if (outFraction >= RECENTRE_AT) {
        target.value = withTiming({ x: 0, y: TARGET_Y, z: 0 }, { duration: 280 });
      }
    });

  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((e) => {
      'worklet';
      runOnJS(pick)(e.x, e.y);
    });

  // Tap wins if it recognizes (quick, no drag); otherwise orbit + zoom together.
  const gesture = Gesture.Exclusive(tap, Gesture.Simultaneous(pan, pinch));

  return (
    <View style={styles.root}>
      <Canvas camera={{ position: [0, TARGET_Y, 6.4], fov: FOV_DEG }} gl={{ antialias: true }}>
        <BodyLights />
        <group ref={groupRef}>
          <BodyModel onReady={handleReady} onStatus={handleStatus} />
        </group>
        {mark ? <Marker point={mark.point} /> : null}
        <Rig azimuth={azimuth} polar={polar} radius={radius} target={target} groupRef={groupRef} sceneRef={sceneRef} />
      </Canvas>
      <GestureDetector gesture={gesture}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            // The pinch handler needs the viewport on the UI thread to turn a touch into NDC.
            viewW.value = e.nativeEvent.layout.width;
            viewH.value = e.nativeEvent.layout.height;
          }}
        />
      </GestureDetector>

      {status !== 'ready' ? (
        <View style={styles.status} pointerEvents="none">
          <ThemedText type="footnote" themeColor={status === 'error' ? 'riskCritical' : 'muted'}>
            {status === 'error' ? `Model failed — ${errMsg ?? 'unknown'}` : 'Loading 3D model…'}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  status: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
});

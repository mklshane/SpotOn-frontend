/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { Raycaster, Vector2, type Camera, type Group } from 'three';

import { ThemedText } from '@/components/themed-text';

import { BodyModel, type BodyModelStatus } from './body-model';
import { BodyLights, MARKER_HIT_RADIUS, MARKER_RADIUS } from './mannequin';

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
const MARKER = '#FF7A3C';

/** `color` tints the marker by triage tier, turning the body model into a risk map. */
export type HistoryMarker = { id: string; point: [number, number, number]; color?: string };

type SceneRefs = { camera: Camera; width: number; height: number };

function Rig({
  azimuth,
  polar,
  radius,
  sceneRef,
}: {
  azimuth: { value: number };
  polar: { value: number };
  radius: { value: number };
  sceneRef: React.MutableRefObject<SceneRefs | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    sceneRef.current = { camera, width: size.width, height: size.height };
  }, [camera, size.width, size.height, sceneRef]);
  useFrame(() => {
    const pol = polar.value;
    const r = radius.value;
    const sinPol = Math.sin(pol);
    camera.position.set(r * sinPol * Math.sin(azimuth.value), TARGET_Y + r * Math.cos(pol), r * sinPol * Math.cos(azimuth.value));
    camera.lookAt(0, TARGET_Y, 0);
  });
  return null;
}

/** Interactive body showing every history marker; tapping a marker calls `onSelect`. */
export function BodyHistoryViewer({
  markers,
  onSelect,
}: {
  markers: HistoryMarker[];
  onSelect: (id: string) => void;
}) {
  const azimuth = useSharedValue(0);
  const polar = useSharedValue(Math.PI / 2);
  const radius = useSharedValue(6.4);
  const startAz = useSharedValue(0);
  const startPol = useSharedValue(Math.PI / 2);
  const startRad = useSharedValue(6.4);

  const markersRef = useRef<Group | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const raycaster = useMemo(() => new Raycaster(), []);
  const [status, setStatus] = useState<BodyModelStatus>('loading');

  const handleStatus = useCallback((s: BodyModelStatus) => setStatus(s), []);

  const pickMarker = useCallback(
    (x: number, y: number) => {
      const s = sceneRef.current;
      const group = markersRef.current;
      if (!s || !group) return;
      const ndc = new Vector2((x / s.width) * 2 - 1, -(y / s.height) * 2 + 1);
      raycaster.setFromCamera(ndc, s.camera);
      const hits = raycaster.intersectObjects(group.children, true);
      const id = hits[0]?.object.userData.id as string | undefined;
      if (id) onSelect(id);
    },
    [onSelect, raycaster],
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
    })
    .onUpdate((e) => {
      'worklet';
      radius.value = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, startRad.value / e.scale));
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((e) => {
      'worklet';
      runOnJS(pickMarker)(e.x, e.y);
    });

  const gesture = Gesture.Exclusive(tap, Gesture.Simultaneous(pan, pinch));

  return (
    <View style={styles.root}>
      <Canvas camera={{ position: [0, TARGET_Y, 6.4], fov: 42 }} gl={{ antialias: true }}>
        <BodyLights />
        <BodyModel onStatus={handleStatus} />
        <group ref={markersRef}>
          {markers.map((m) => (
            <group key={m.id} position={m.point}>
              <mesh userData={{ id: m.id }}>
                <sphereGeometry args={[MARKER_RADIUS, 20, 20]} />
                <meshStandardMaterial
                  color={m.color ?? MARKER}
                  emissive={m.color ?? MARKER}
                  emissiveIntensity={0.6}
                  roughness={0.35}
                />
              </mesh>
              {/*
                Invisible tap target. The dot is small enough now that raycasting it directly would
                make markers fiddly to hit, so the thing the user aims at and the thing they see are
                separate spheres — this one is even a shade larger than the old dot, so tapping got
                easier rather than harder. Fully transparent rather than `visible={false}` so it is
                unambiguously still raycastable, and low-poly because nothing ever shades it.
              */}
              <mesh userData={{ id: m.id }}>
                <sphereGeometry args={[MARKER_HIT_RADIUS, 8, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          ))}
        </group>
        <Rig azimuth={azimuth} polar={polar} radius={radius} sceneRef={sceneRef} />
      </Canvas>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {status !== 'ready' ? (
        <View style={styles.status} pointerEvents="none">
          <ThemedText type="footnote" themeColor={status === 'error' ? 'riskCritical' : 'muted'}>
            {status === 'error' ? 'Model failed to load' : 'Loading 3D model…'}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  status: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});

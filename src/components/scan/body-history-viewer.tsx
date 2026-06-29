/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { Raycaster, Vector2, type Camera, type Group } from 'three';

import { ThemedText } from '@/components/themed-text';

import { BodyModel, type BodyModelStatus } from './body-model';
import { BodyLights } from './mannequin';

const TARGET_Y = -0.05;
const POLAR_MIN = 0.3;
const POLAR_MAX = Math.PI - 0.3;
const RADIUS_MIN = 3.6;
const RADIUS_MAX = 9.5;
const MARKER = '#FF7A3C';

export type HistoryMarker = { id: string; point: [number, number, number] };

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
            <mesh key={m.id} position={m.point} userData={{ id: m.id }}>
              <sphereGeometry args={[0.13, 20, 20]} />
              <meshStandardMaterial color={MARKER} emissive={MARKER} emissiveIntensity={0.6} roughness={0.35} />
            </mesh>
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

/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { type Box3, Raycaster, Vector2, type Camera, type Group } from 'three';

import { ThemedText } from '@/components/themed-text';
import { resolveRegionFromPoint } from '@/lib/body-regions';
import type { BodyMark } from '@/lib/scan-draft';

import { BodyModel, type BodyModelStatus } from './body-model';
import { BodyLights, Marker } from './mannequin';

const TARGET_Y = -0.05;
const POLAR_MIN = 0.3;
const POLAR_MAX = Math.PI - 0.3;
const RADIUS_MIN = 3.6;
const RADIUS_MAX = 9.5;

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
  groupRef,
  sceneRef,
}: {
  azimuth: { value: number };
  polar: { value: number };
  radius: { value: number };
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
    const sinPol = Math.sin(pol);
    camera.position.set(r * sinPol * Math.sin(az), TARGET_Y + r * Math.cos(pol), r * sinPol * Math.cos(az));
    camera.lookAt(0, TARGET_Y, 0);
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

  const groupRef = useRef<Group | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const boxRef = useRef<Box3 | null>(null);
  const raycaster = useMemo(() => new Raycaster(), []);

  const [status, setStatus] = useState<BodyModelStatus>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleReady = useCallback((box: Box3) => {
    boxRef.current = box;
  }, []);

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
    })
    .onUpdate((e) => {
      'worklet';
      radius.value = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, startRad.value / e.scale));
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
      <Canvas camera={{ position: [0, TARGET_Y, 6.4], fov: 42 }} gl={{ antialias: true }}>
        <BodyLights />
        <group ref={groupRef}>
          <BodyModel onReady={handleReady} onStatus={handleStatus} />
        </group>
        {mark ? <Marker point={mark.point} /> : null}
        <Rig azimuth={azimuth} polar={polar} radius={radius} groupRef={groupRef} sceneRef={sceneRef} />
      </Canvas>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} />
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

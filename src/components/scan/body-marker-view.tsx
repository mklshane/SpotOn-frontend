/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { Canvas, useThree } from '@react-three/fiber/native';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { BodyMark } from '@/lib/scan-draft';

import { BodyModel } from './body-model';
import { BodyLights, Marker } from './mannequin';

const TARGET_Y = -0.05;

/** Positions a fixed camera to face the marked point so it's clearly visible. */
function FixedCamera({ point }: { point: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    const [x, y, z] = point;
    const azimuth = Math.atan2(x, z); // look from the side the mark is on
    const r = 5.6;
    const polar = Math.min(Math.PI - 0.4, Math.max(0.4, Math.PI / 2 - y * 0.12));
    const sinPol = Math.sin(polar);
    camera.position.set(r * sinPol * Math.sin(azimuth), TARGET_Y + r * Math.cos(polar), r * sinPol * Math.cos(azimuth));
    camera.lookAt(0, TARGET_Y, 0);
  }, [camera, point]);
  return null;
}

/** Read-only 3D body showing where the lesion was marked. No interaction. */
export function BodyMarkerView({ mark, style }: { mark: BodyMark; style?: ViewStyle | ViewStyle[] }) {
  return (
    <View style={[styles.root, style]} pointerEvents="none">
      <Canvas camera={{ position: [0, TARGET_Y, 5.6], fov: 45 }} gl={{ antialias: true }}>
        <BodyLights />
        <BodyModel />
        <Marker point={mark.point} />
        <FixedCamera point={mark.point} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

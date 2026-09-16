import { Canvas, useThree } from '@react-three/fiber/native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import type { BodyMark } from '@/lib/triage/types';

import { BodyModel } from './body-model';
import { BodyLights, Marker } from './mannequin';

/** Keep the selected model point in the middle of a small, read-only card preview. */
function PreviewCamera({ mark }: { mark: BodyMark }) {
  const { camera } = useThree();

  useEffect(() => {
    const [x, y, z] = mark.point;
    const depth = mark.view === 'front' ? 2.2 : -2.2;

    // Stay mostly front-on while looking at the selected point, so an arm or leg spot is
    // cropped into view without turning the preview into an unexpected side profile.
    camera.position.set(x * 0.35, y, depth);
    camera.lookAt(x, y, z);
  }, [camera, mark]);

  return null;
}

/** A non-interactive, cropped 3D body preview for the compact tracked-spot card. */
export function BodySpotPreview({ mark }: { mark: BodyMark }) {
  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas camera={{ position: [0, 0, 2.2], fov: 36 }} gl={{ antialias: true }}>
        <BodyLights />
        <BodyModel />
        <Marker point={mark.point} />
        <PreviewCamera mark={mark} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

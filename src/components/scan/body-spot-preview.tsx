import { Canvas, useThree } from '@react-three/fiber/native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import type { BodyMark } from '@/lib/triage/types';

import { BodyModel, surfaceNormalAt } from './body-model';
import { BodyLights, Marker } from './mannequin';

/** Camera distance from the marked point. */
const PREVIEW_DIST = 2.2;
/** How hard the view is pulled toward straight front/back, so side spots don't become a profile. */
const AXIS_PULL = 0.6;

/**
 * Keep the selected model point in the middle of a small, read-only card preview, seen from the
 * side its skin faces.
 *
 * The direction comes from the mesh's own surface normal at the point, not from `mark.view`: that
 * field was decided by depth against the body's box centre until 2026-10-15 and is wrong for most
 * front-of-shin and front-of-elbow marks already saved, which put the camera behind the leg with
 * the marker hidden. Deriving it here fixes those old records without migrating them.
 */
function PreviewCamera({ mark }: { mark: BodyMark }) {
  const { camera } = useThree();

  useEffect(() => {
    const [x, y, z] = mark.point;
    const n = surfaceNormalAt(mark.point, mark.mesh ?? 'male');
    const fallbackZ = mark.view === 'front' ? 1 : -1;
    // Horizontal part of the normal only - looking down at a shoulder or up at a sole reads badly
    // in a 132pt card - blended toward the nearer of straight-front / straight-back.
    let dx = n ? n[0] : 0;
    let dz = n ? n[2] : fallbackZ;
    dz += AXIS_PULL * (Math.sign(dz) || fallbackZ);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    camera.position.set(x + dx * PREVIEW_DIST, y, z + dz * PREVIEW_DIST);
    camera.lookAt(x, y, z);
  }, [camera, mark]);

  return null;
}

/**
 * A non-interactive, cropped 3D body preview for the compact tracked-spot card.
 *
 * Drawn on the mesh the mark was placed on rather than the current body-figure setting: the card
 * is a close crop of one spot, so exact placement matters more here than matching the full-body
 * screens, and it means the stored point never needs moving.
 */
export function BodySpotPreview({ mark }: { mark: BodyMark }) {
  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas camera={{ position: [0, 0, 2.2], fov: 36 }} gl={{ antialias: true }}>
        <BodyLights />
        <BodyModel variant={mark.mesh ?? 'male'} />
        <Marker point={mark.point} />
        <PreviewCamera mark={mark} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

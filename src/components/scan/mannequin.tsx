/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { forwardRef } from 'react';
import type { Group } from 'three';

import { BODY_PARTS, type BodyPart } from '@/lib/body-parts';

const SKIN = '#C6C7CD';
const MARKER = '#FF7A3C';

function PartMesh({ part }: { part: BodyPart }) {
  return (
    <mesh position={part.position} rotation={part.rotation} scale={part.scale} userData={{ part }}>
      {part.kind === 'sphere' ? (
        <sphereGeometry args={[part.args[0], 32, 32]} />
      ) : part.kind === 'capsule' ? (
        <capsuleGeometry args={[part.args[0], part.args[1], 16, 28]} />
      ) : (
        <boxGeometry args={[part.args[0], part.args[1], part.args[2]]} />
      )}
      <meshStandardMaterial color={SKIN} roughness={0.92} metalness={0.02} />
    </mesh>
  );
}

/** The full body, assembled from primitives. Each mesh carries its `part` in userData. */
export const Mannequin = forwardRef<Group>(function Mannequin(_props, ref) {
  return (
    <group ref={ref}>
      {BODY_PARTS.map((part) => (
        <PartMesh key={part.id} part={part} />
      ))}
    </group>
  );
});

/** The lesion-location marker: a small glowing sunset sphere placed at a model-local point. */
export function Marker({ point }: { point: [number, number, number] }) {
  return (
    <mesh position={point}>
      <sphereGeometry args={[0.1, 24, 24]} />
      <meshStandardMaterial color={MARKER} emissive={MARKER} emissiveIntensity={0.55} roughness={0.35} />
    </mesh>
  );
}

/** Shared 3-point lighting for a soft clay look (no harsh shadows). */
export function BodyLights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#b6b6c0', 0.55]} />
      <directionalLight position={[4, 6, 6]} intensity={1.0} />
      <directionalLight position={[-5, 2, 3]} intensity={0.35} />
      <directionalLight position={[0, 3, -6]} intensity={0.5} />
    </>
  );
}

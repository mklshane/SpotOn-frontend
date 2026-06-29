/**
 * The body is a stylized clay mannequin assembled from three.js primitives.
 * This is the single source of truth: `Mannequin` renders one mesh per part and
 * tags it with `userData.region`, so a raycast hit maps straight to a region label.
 *
 * Convention: Y up, origin near the navel. The model faces +Z (toward the camera at
 * rest), so the model's anatomical LEFT side is at +X and RIGHT at -X. Front = z > 0.
 * Joints overlap their neighbours so the separate primitives read as one smooth body.
 */

export type PartKind = 'sphere' | 'capsule' | 'box';

export type BodyPart = {
  id: string;
  region: string;
  /** Optional label when the hit is on the back (z < 0); falls back to `region`. */
  regionBack?: string;
  kind: PartKind;
  /** sphere:[r]; capsule:[radius,length]; box:[w,h,d] */
  args: number[];
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

export const BODY_PARTS: BodyPart[] = [
  { id: 'head', region: 'Head / Face', regionBack: 'Back of head', kind: 'sphere', args: [0.27], position: [0, 1.6, 0], scale: [0.92, 1.06, 0.96] },
  { id: 'neck', region: 'Neck', regionBack: 'Nape', kind: 'capsule', args: [0.1, 0.12], position: [0, 1.28, 0] },

  // Tapered torso: broad chest -> narrow waist -> hips (overlapping).
  { id: 'chest', region: 'Chest', regionBack: 'Upper back', kind: 'capsule', args: [0.32, 0.32], position: [0, 0.8, 0] },
  { id: 'abdomen', region: 'Abdomen', regionBack: 'Mid back', kind: 'capsule', args: [0.26, 0.3], position: [0, 0.4, 0] },
  { id: 'pelvis', region: 'Lower abdomen', regionBack: 'Lower back', kind: 'capsule', args: [0.3, 0.26], position: [0, 0.02, 0] },

  // Left arm (+X)
  { id: 'l-shoulder', region: 'Left shoulder', kind: 'sphere', args: [0.16], position: [0.34, 1.0, 0] },
  { id: 'l-upper-arm', region: 'Left upper arm', kind: 'capsule', args: [0.11, 0.46], position: [0.45, 0.64, 0], rotation: [0, 0, 0.14] },
  { id: 'l-elbow', region: 'Left elbow', kind: 'sphere', args: [0.105], position: [0.5, 0.36, 0] },
  { id: 'l-forearm', region: 'Left forearm', kind: 'capsule', args: [0.095, 0.46], position: [0.53, 0.07, 0], rotation: [0, 0, 0.08] },
  { id: 'l-hand', region: 'Left hand', kind: 'sphere', args: [0.12], position: [0.55, -0.24, 0], scale: [0.8, 1.25, 0.6] },

  // Right arm (-X)
  { id: 'r-shoulder', region: 'Right shoulder', kind: 'sphere', args: [0.16], position: [-0.34, 1.0, 0] },
  { id: 'r-upper-arm', region: 'Right upper arm', kind: 'capsule', args: [0.11, 0.46], position: [-0.45, 0.64, 0], rotation: [0, 0, -0.14] },
  { id: 'r-elbow', region: 'Right elbow', kind: 'sphere', args: [0.105], position: [-0.5, 0.36, 0] },
  { id: 'r-forearm', region: 'Right forearm', kind: 'capsule', args: [0.095, 0.46], position: [-0.53, 0.07, 0], rotation: [0, 0, -0.08] },
  { id: 'r-hand', region: 'Right hand', kind: 'sphere', args: [0.12], position: [-0.55, -0.24, 0], scale: [0.8, 1.25, 0.6] },

  // Left leg
  { id: 'l-hip', region: 'Left hip', kind: 'sphere', args: [0.17], position: [0.18, -0.16, 0] },
  { id: 'l-thigh', region: 'Left thigh', kind: 'capsule', args: [0.15, 0.58], position: [0.18, -0.62, 0] },
  { id: 'l-knee', region: 'Left knee', kind: 'sphere', args: [0.125], position: [0.18, -0.98, 0] },
  { id: 'l-shin', region: 'Left lower leg', kind: 'capsule', args: [0.115, 0.56], position: [0.18, -1.4, 0] },
  { id: 'l-foot', region: 'Left foot', kind: 'box', args: [0.2, 0.14, 0.44], position: [0.18, -1.82, 0.1] },

  // Right leg
  { id: 'r-hip', region: 'Right hip', kind: 'sphere', args: [0.17], position: [-0.18, -0.16, 0] },
  { id: 'r-thigh', region: 'Right thigh', kind: 'capsule', args: [0.15, 0.58], position: [-0.18, -0.62, 0] },
  { id: 'r-knee', region: 'Right knee', kind: 'sphere', args: [0.125], position: [-0.18, -0.98, 0] },
  { id: 'r-shin', region: 'Right lower leg', kind: 'capsule', args: [0.115, 0.56], position: [-0.18, -1.4, 0] },
  { id: 'r-foot', region: 'Right foot', kind: 'box', args: [0.2, 0.14, 0.44], position: [-0.18, -1.82, 0.1] },
];

/** Resolve a region label from the hit part and the hit point's depth (front/back). */
export function resolveRegion(part: BodyPart, worldZ: number): string {
  if (worldZ < 0 && part.regionBack) return part.regionBack;
  return part.region;
}

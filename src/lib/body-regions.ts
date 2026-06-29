import type { Box3, Vector3 } from 'three';

/**
 * Maps a hit point on the fitted body mesh to a human-readable region.
 * The mesh is fitted standing (Y up), facing +Z, centered on X. Anatomical LEFT = +X.
 * Thresholds are normalized to the model's bounding box so they're scale-independent.
 */
export function resolveRegionFromPoint(point: Vector3, box: Box3): string {
  const sizeX = box.max.x - box.min.x;
  const sizeY = box.max.y - box.min.y;
  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;

  const t = (point.y - box.min.y) / sizeY; // 0 = feet, 1 = head
  const xrel = (point.x - cx) / sizeX; // -0.5 .. 0.5
  const front = point.z >= cz;
  const armSide = xrel >= 0 ? 'Left' : 'Right';

  // Head / neck
  if (t > 0.9) return front ? 'Head / Face' : 'Back of head';
  if (t > 0.85) return front ? 'Neck' : 'Nape';

  // Arms (outer X, upper half)
  if (Math.abs(xrel) > 0.2 && t > 0.45) {
    if (t > 0.72) return `${armSide} upper arm`;
    if (t > 0.6) return `${armSide} elbow`;
    if (t > 0.5) return `${armSide} forearm`;
    return `${armSide} hand`;
  }

  // Legs (lower half)
  if (t < 0.48) {
    const legSide = xrel >= 0 ? 'Left' : 'Right';
    if (t > 0.27) return `${legSide} thigh`;
    if (t > 0.1) return `${legSide} lower leg`;
    return `${legSide} foot`;
  }

  // Torso
  if (t > 0.72) return front ? 'Chest' : 'Upper back';
  if (t > 0.6) return front ? 'Abdomen' : 'Mid back';
  return front ? 'Lower abdomen' : 'Lower back';
}

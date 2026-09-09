import { t } from './i18n/core';
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

  const ratio = (point.y - box.min.y) / sizeY; // 0 = feet, 1 = head
  const xrel = (point.x - cx) / sizeX; // -0.5 .. 0.5
  const front = point.z >= cz;
  const armSide = xrel >= 0 ? 'Left' : 'Right';

  // Head / neck
  if (ratio > 0.9) return front ? t('Head / Face') : t('Back of head');
  if (ratio > 0.85) return front ? t('Neck') : t('Nape');

  // Arms (outer X, upper half)
  if (Math.abs(xrel) > 0.2 && ratio > 0.45) {
    if (ratio > 0.72) return t(`${armSide} upper arm`);
    if (ratio > 0.6) return t(`${armSide} elbow`);
    if (ratio > 0.5) return t(`${armSide} forearm`);
    return t(`${armSide} hand`);
  }

  // Legs (lower half)
  if (ratio < 0.48) {
    const legSide = xrel >= 0 ? 'Left' : 'Right';
    if (ratio > 0.27) return t(`${legSide} thigh`);
    if (ratio > 0.1) return t(`${legSide} lower leg`);
    return t(`${legSide} foot`);
  }

  // Torso
  if (ratio > 0.72) return front ? t('Chest') : t('Upper back');
  if (ratio > 0.6) return front ? t('Abdomen') : t('Mid back');
  return front ? t('Lower abdomen') : t('Lower back');
}

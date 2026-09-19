import { t } from './i18n/core';
import type { Box3, Vector3 } from 'three';

/** |xrel| beyond which a point is on an arm rather than the torso. */
export const ARM_X = 0.2;
/**
 * Height floor for the arm test, which exists only to keep feet out of it. Both meshes keep their
 * legs inside |xrel| ~0.195, but the female mesh's stance splays her feet to ~0.217, past ARM_X.
 * 0.35 clears those (they sit below ratio 0.05) while admitting the male mesh's hands at 0.42.
 */
export const ARM_RATIO = 0.35;

/**
 * Maps a hit point on the fitted body mesh to a human-readable region.
 * The mesh is fitted standing (Y up), facing +Z, centered on X. Anatomical LEFT = +X.
 * Thresholds are normalized to the model's bounding box so they're scale-independent, and
 * shared by every body variant - see body-model.tsx, which fits each mesh into the same box.
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

  // Arms (outer X, upper half). Position ALONG the arm is measured by how far out in X the point
  // is, not by height, because the two body meshes hold their arms at different angles: the male
  // mesh's fingertips sit at 42% of its height and the female mesh's at 52%. Height bands tuned to
  // one pose misread the other - and misread the male mesh too, since its hands fell below the
  // old `ratio > 0.45` gate entirely and were being reported as "thigh". An arm always runs
  // outward from the torso edge to the fingertip, whatever its angle, so X generalises.
  if (Math.abs(xrel) > ARM_X && ratio > ARM_RATIO) {
    const u = (Math.abs(xrel) - ARM_X) / (0.5 - ARM_X); // 0 = torso edge, 1 = fingertip
    if (u < 0.25) return t(`${armSide} upper arm`);
    if (u < 0.45) return t(`${armSide} elbow`);
    if (u < 0.75) return t(`${armSide} forearm`);
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

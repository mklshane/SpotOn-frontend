/**
 * Moves a point placed on one body mesh onto the surface of another.
 *
 * Both meshes are fitted into the same height and centre (body-model.tsx), but they differ in
 * proportion and pose - the female mesh is relatively wider and holds her arms higher - so a raw
 * point from one mesh drawn on the other floats in the air or sinks into it. That matters only
 * when a mark is shown on a mesh other than the one it was placed on: a user who changes the body
 * figure setting, or history marks saved before the female mesh existed.
 *
 * Points are compared relative to each mesh's own bounding box, and the nearest target vertex wins
 * - with one refinement for arms. Plain nearest-point matching is pose-naive: the male fingertips
 * sit at 42% of body height and the female's at 52%, so a male hand mark lands nearer the female
 * forearm than her hand. Arm points are therefore matched on the pose-independent description the
 * region mapper already uses (body-regions.ts): how far out along the arm, and where on the arm's
 * cross-section at that point - top/bottom and front/back. Cross-section position is the offset
 * from the arm's own centreline divided by the arm's local thickness, in both height and depth. An
 * absolute offset does not transfer: the male hand hangs down from the wrist and is tall at a given
 * reach while the female hand is held level and thin, and the female mesh's depth box is set by
 * her hips, not her arms, so box-relative depth misplaces a point on the arm. Arm points only match arm vertices on the same
 * side, and body points only body vertices, so a mark never jumps between an arm and the torso.
 *
 * Linear over ~41k vertices, well under a millisecond, and only run when the meshes differ.
 * Kept free of three.js runtime imports so scripts/test-body-regions.mjs can run it on the real
 * meshes in node.
 */
import { ARM_RATIO, ARM_X } from './body-regions';

export type Bounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

type Frame = { cx: number; cz: number; sx: number; sy: number; sz: number; miny: number };

function frameOf(b: Bounds): Frame {
  return {
    cx: (b.min.x + b.max.x) / 2,
    cz: (b.min.z + b.max.z) / 2,
    sx: b.max.x - b.min.x || 1,
    sy: b.max.y - b.min.y || 1,
    sz: b.max.z - b.min.z || 1,
    miny: b.min.y,
  };
}

/** Box-relative coordinates: xr in -0.5..0.5 (left = +), ratio 0 = feet .. 1 = head, zr depth. */
function rel(x: number, y: number, z: number, f: Frame): [number, number, number] {
  return [(x - f.cx) / f.sx, (y - f.miny) / f.sy, (z - f.cz) / f.sz];
}

const isArm = (xr: number, ratio: number) => Math.abs(xr) > ARM_X && ratio > ARM_RATIO;

/** Resolution of the arm centreline, in steps from torso edge (0) to fingertip (1). */
const BINS = 16;
const binOf = (xr: number) =>
  Math.min(BINS - 1, Math.max(0, Math.floor(((Math.abs(xr) - ARM_X) / (0.5 - ARM_X)) * BINS)));

/** Per step out along the arm: centre and thickness (std. dev.) in height (y) and depth (z). */
type Centreline = { my: Float64Array; sy: Float64Array; mz: Float64Array; sz: Float64Array };

/**
 * The arm's pose and girth at each step out from the torso. Both sides are pooled - the meshes are
 * symmetric. Cached per vertex array, so it is computed once per mesh.
 */
const CENTRELINES = new WeakMap<object, Centreline>();
function armCentreline(positions: ArrayLike<number>, f: Frame): Centreline {
  const hit = CENTRELINES.get(positions as object);
  if (hit) return hit;
  const n = new Float64Array(BINS);
  const sy = new Float64Array(BINS), qy = new Float64Array(BINS);
  const sz = new Float64Array(BINS), qz = new Float64Array(BINS);
  for (let i = 0; i < positions.length; i += 3) {
    const [xr, ratio, zr] = rel(positions[i], positions[i + 1], positions[i + 2], f);
    if (!isArm(xr, ratio)) continue;
    const b = binOf(xr);
    n[b]++;
    sy[b] += ratio;
    qy[b] += ratio * ratio;
    sz[b] += zr;
    qz[b] += zr * zr;
  }
  const stat = (sum: Float64Array, sq: Float64Array, fallbackMean: number) => {
    const mean = new Float64Array(BINS).fill(NaN);
    const sd = new Float64Array(BINS).fill(NaN);
    for (let b = 0; b < BINS; b++) {
      if (!n[b]) continue;
      mean[b] = sum[b] / n[b];
      // Floored so a bin with a single vertex cannot divide by zero.
      sd[b] = Math.max(Math.sqrt(Math.max(0, sq[b] / n[b] - mean[b] * mean[b])), 1e-3);
    }
    // Empty bins (none in practice on either mesh) borrow the nearest populated neighbour.
    for (const [arr, fb] of [[mean, fallbackMean], [sd, 1]] as const) {
      for (let b = 1; b < BINS; b++) if (Number.isNaN(arr[b])) arr[b] = arr[b - 1];
      for (let b = BINS - 2; b >= 0; b--) if (Number.isNaN(arr[b])) arr[b] = arr[b + 1];
      for (let b = 0; b < BINS; b++) if (Number.isNaN(arr[b])) arr[b] = fb;
    }
    return [mean, sd] as const;
  };
  const [my, syd] = stat(sy, qy, ARM_RATIO);
  const [mz, szd] = stat(sz, qz, 0);
  const line = { my, sy: syd, mz, sz: szd };
  CENTRELINES.set(positions as object, line);
  return line;
}

/** Vertices of the source mesh, for its centreline - see projectPointBetweenBodies. */
export type BodySurface = { positions: ArrayLike<number>; box: Bounds };

/**
 * @param point the stored point, in the source mesh's fitted space
 * @param from  the mesh the point was placed on
 * @param to    the mesh to draw it on
 * @returns the target vertex that best corresponds to `point`
 */
export function projectPointBetweenBodies(
  point: readonly [number, number, number],
  from: BodySurface,
  to: BodySurface,
): [number, number, number] {
  const ff = frameOf(from.box);
  const tf = frameOf(to.box);
  const [pxr, pratio, pzr] = rel(point[0], point[1], point[2], ff);
  const onArm = isArm(pxr, pratio);

  // For arm points, height and depth are measured from the arm's own centre in units of its local
  // thickness, so the pose, the hand's orientation and the body's overall depth all cancel out.
  let pdy = 0;
  let pdz = 0;
  let toLine: Centreline | null = null;
  if (onArm) {
    const fromLine = armCentreline(from.positions, ff);
    toLine = armCentreline(to.positions, tf);
    const b = binOf(pxr);
    pdy = (pratio - fromLine.my[b]) / fromLine.sy[b];
    pdz = (pzr - fromLine.mz[b]) / fromLine.sz[b];
  }

  const P = to.positions;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const [xr, ratio, zr] = rel(P[i], P[i + 1], P[i + 2], tf);
    if (isArm(xr, ratio) !== onArm) continue;
    let d: number;
    if (onArm) {
      if (xr >= 0 !== pxr >= 0) continue; // same arm only
      const b = binOf(xr);
      const dx = Math.abs(xr) - Math.abs(pxr);
      // Back into box units at the target, so dy and dz weigh the same as dx.
      const dy = ratio - toLine!.my[b] - pdy * toLine!.sy[b];
      const dz = zr - toLine!.mz[b] - pdz * toLine!.sz[b];
      d = dx * dx + dy * dy + dz * dz;
    } else {
      const dx = xr - pxr;
      const dy = ratio - pratio;
      const dz = zr - pzr;
      d = dx * dx + dy * dy + dz * dz;
    }
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return [point[0], point[1], point[2]];
  return [P[best], P[best + 1], P[best + 2]];
}

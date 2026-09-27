/**
 * Pure box selection and crop geometry for the still-image lesion detector.
 *
 * Zero imports on purpose: like aggregate-core.ts, this file is compiled standalone by
 * scripts/test-classifier-core.mjs. lesion-detector.ts cannot be compiled that way - it loads the
 * detector interpreter - so the rules that decide which lesion the classifier sees live here.
 */

export const DET_CONF = 0.2; // matches LesionCropper.det_conf - the confidence the training crops used
export const FULL_FRAME = 0.95; // reject a box spanning ~the whole frame: that's not a localized lesion
export const TOP_K = 3; // among the most-confident boxes, prefer the most central (training cropper's rule)

// crop_rect geometry from synth/framing.py, as used by LesionCropper (crop_pad 0.45). Reproducing
// it here makes the on-device crop the classifier sees identical to the one it was trained on.
export const CROP_PAD = 0.45;
export const CROP_MIN_FRAC = 0.2;
export const ZOOM_CAP = 4.0;

export type LesionBox = { cx: number; cy: number; bw: number; bh: number; conf: number };
/** Same shape as preprocess.ts CropBox (centre + half-side, normalized to the short edge). */
export type SquareCrop = { cx: number; cy: number; half: number };

/**
 * Pick the lesion box from above-threshold candidates: drop full-frame boxes (unless that is all
 * there is), keep the TOP_K most confident, and return the one nearest the frame centre.
 */
export function selectLesionBox(cands: readonly LesionBox[]): LesionBox | null {
  if (cands.length === 0) return null;
  let keep = cands.filter((c) => c.bw < FULL_FRAME || c.bh < FULL_FRAME);
  if (keep.length === 0) keep = [...cands];
  keep.sort((a, b) => b.conf - a.conf);
  const top = keep.slice(0, TOP_K);
  top.sort(
    (a, b) =>
      (a.cx - 0.5) ** 2 + (a.cy - 0.5) ** 2 - ((b.cx - 0.5) ** 2 + (b.cy - 0.5) ** 2),
  );
  return top[0];
}

/**
 * Expand a detector box to the classifier crop, reproducing synth crop_rect for a square image.
 * Because the image is square, frame-fraction == short-edge-fraction.
 */
export function lesionBoxToCrop(box: LesionBox): SquareCrop {
  const lesion = Math.max(box.bw, box.bh); // fraction of frame
  const desired = Math.min(1, Math.max(CROP_MIN_FRAC, lesion * (1 + CROP_PAD)));
  const scv = Math.min(ZOOM_CAP, 1 / desired);
  const side = Math.min(1, 1 / scv);
  const half = side / 2;
  return {
    cx: Math.min(1 - half, Math.max(half, box.cx)),
    cy: Math.min(1 - half, Math.max(half, box.cy)),
    half,
  };
}

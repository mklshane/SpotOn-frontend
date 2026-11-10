/**
 * Decoding for the bundled face detector (MediaPipe BlazeFace short-range, face_detect_short_v1),
 * and the rule the multi-spot picker uses it for: a spot sitting on an EYE is not a lesion.
 *
 * Zero imports, like detector-core.ts: scripts/test-localizer.mjs compiles it standalone.
 *
 * WHY. The lesion detector confirms an iris as confidently as a mole, and the skin gate calls the
 * crop skin, so on portraits the picker offered an eye - or, as the only spot, zoomed onto it.
 * BlazeFace finds the face and both eyes. Measured 2026-10-17 over ~570 photos: every real face
 * scored 0.82-0.97, while skin close-ups it mistook for faces (moles read as eyes) all scored 0.74
 * or less; at FACE_MIN_SCORE the eye rule removed exactly the four eye spots on portraits and no
 * lesion. Only eyes are excluded: a nose-tip BCC or a lip SCC sits right on those keypoints and is
 * exactly what should be found.
 *
 * Model contract (checked at load): input [1,128,128,3] float32 RGB in [-1,1], letterboxed;
 * outputs [1,896,16] box+keypoint regressors and [1,896,1] logits. 896 SSD anchors: 16x16 cells
 * x 2 at stride 8, 8x8 cells x 6 at stride 16, centred, unit size. Regressor layout per anchor:
 * cx, cy, w, h, then 6 (x, y) keypoints - right eye, left eye, nose tip, mouth, right ear, left ear -
 * all in input pixels, offsets relative to the anchor centre.
 */

export const FACE_INPUT = 128;
export const FACE_ANCHORS = 896;
/** A real face, not skin texture read as one (see above). */
export const FACE_MIN_SCORE = 0.8;
/** A spot within this share of the face width of an eye keypoint is the eye. Max seen on eye spots: 0.06. */
export const EYE_RADIUS = 0.08;

export type Face = {
  score: number;
  /** Box centre and size, fractions of the image width/height. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Eye centres, fractions of the image width/height. */
  eyes: [{ x: number; y: number }, { x: number; y: number }];
  /** All six keypoints (eyes, nose tip, mouth, ears), fractions of the image width/height. */
  points: { x: number; y: number }[];
};

let anchorCache: Float32Array | null = null;

/** Anchor centres (x, y pairs) in input fractions, in the model's output order. */
export function faceAnchors(): Float32Array {
  if (anchorCache) return anchorCache;
  const a = new Float32Array(FACE_ANCHORS * 2);
  let i = 0;
  for (const [stride, perCell] of [[8, 2], [16, 6]] as const) {
    const cells = FACE_INPUT / stride;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        for (let k = 0; k < perCell; k++) {
          a[i++] = (x + 0.5) / cells;
          a[i++] = (y + 0.5) / cells;
        }
      }
    }
  }
  anchorCache = a;
  return a;
}

/**
 * Faces scoring at least `minScore`, most confident first, one per face. `place` is where the image
 * sits inside the letterboxed input (fractions of the input), as letterboxToTensor reports it.
 */
export function decodeFaces(
  regressors: Float32Array,
  logits: Float32Array,
  place: { x: number; y: number; w: number; h: number },
  minScore = FACE_MIN_SCORE,
): Face[] {
  const A = faceAnchors();
  const n = Math.min(FACE_ANCHORS, logits.length, Math.floor(regressors.length / 16));
  const order: number[] = [];
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = Math.max(-100, Math.min(100, logits[i]));
    scores[i] = 1 / (1 + Math.exp(-z));
    if (scores[i] >= minScore) order.push(i);
  }
  order.sort((a, b) => scores[b] - scores[a]);
  const toX = (v: number) => (v - place.x) / place.w;
  const toY = (v: number) => (v - place.y) / place.h;
  const faces: Face[] = [];
  for (const i of order) {
    const r = i * 16;
    const ax = A[i * 2];
    const ay = A[i * 2 + 1];
    const s = FACE_INPUT;
    const f: Face = {
      score: scores[i],
      cx: toX(regressors[r] / s + ax),
      cy: toY(regressors[r + 1] / s + ay),
      w: regressors[r + 2] / s / place.w,
      h: regressors[r + 3] / s / place.h,
      eyes: [
        { x: toX(regressors[r + 4] / s + ax), y: toY(regressors[r + 5] / s + ay) },
        { x: toX(regressors[r + 6] / s + ax), y: toY(regressors[r + 7] / s + ay) },
      ],
      points: [0, 1, 2, 3, 4, 5].map((k) => ({
        x: toX(regressors[r + 4 + 2 * k] / s + ax),
        y: toY(regressors[r + 5 + 2 * k] / s + ay),
      })),
    };
    // Neighbouring anchors fire on the same face; keep the most confident.
    if (faces.some((g) => Math.abs(f.cx - g.cx) < g.w / 2 && Math.abs(f.cy - g.cy) < g.h / 2)) continue;
    faces.push(f);
  }
  return faces;
}

/** Whether a spot centred at (cx, cy) - fractions of a W x H image - sits on an eye of `faces`. */
export function onAnEye(cx: number, cy: number, faces: readonly Face[], W: number, H: number): boolean {
  return faces.some((f) =>
    f.eyes.some((e) => Math.hypot((cx - e.x) * W, (cy - e.y) * H) < EYE_RADIUS * f.w * W),
  );
}

/**
 * Whether a spot box (centre + size, fractions of the image) contains two or more facial keypoints of
 * one face - i.e. the "spot" is the face itself, or a big part of it (an eye and the nose), which the
 * detector's default box drew over a whole portrait. No lesion contains two of a face's landmarks.
 */
export function coversFace(cx: number, cy: number, bw: number, bh: number, faces: readonly Face[]): boolean {
  return faces.some(
    (f) => f.points.filter((p) => Math.abs(p.x - cx) < bw / 2 && Math.abs(p.y - cy) < bh / 2).length >= 2,
  );
}

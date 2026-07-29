import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { getLesionModel, readLayout } from '../lesion-model';
import type { CropBox } from './preprocess';

/**
 * Still-image lesion localization with the app's YOLO detector — the same model, at the same
 * settings, that produced the training crops (SpotOn-synthetic/synth/datasets/medsam_crop.py).
 * Running it on every still and re-cropping to a canonical framing is what makes the classifier's
 * answer depend on the lesion instead of the user's zoom (validated 2026-07-25: a raw crop of one
 * benign mole flips MEL↔BENIGN across zoom levels; the detector re-crop holds BENIGN at every one).
 *
 * The live camera can't reuse this — its detector interpreter is busy on the camera thread and
 * calling it from JS crashes — so capture forwards the live box instead. The still path (both
 * capture-then-analyse and gallery upload) runs after the camera is gone, so it is safe here.
 */

const DET_CONF = 0.2; // matches LesionCropper.det_conf — the confidence the training crops used
const FULL_FRAME = 0.95; // reject a box spanning ~the whole frame: that's not a localized lesion
const TOP_K = 3; // among the most-confident boxes, prefer the most central (training cropper's rule)

// crop_rect geometry from synth/framing.py, as used by LesionCropper (crop_pad 0.45). Reproducing
// it here makes the on-device crop the classifier sees identical to the one it was trained on.
const CROP_PAD = 0.45;
const CROP_MIN_FRAC = 0.2;
const ZOOM_CAP = 4.0;

export type LesionBox = { cx: number; cy: number; bw: number; bh: number; conf: number };

/**
 * Detect the best central lesion box in a still, in normalized [0,1] coords, or null when nothing
 * lesion-like is found. Assumes a square image (crop.tsx always outputs 1024²), so a plain resize
 * to the detector's input equals ultralytics' letterbox of a square — no padding, no aspect skew.
 */
export async function detectLesionBox(uri: string): Promise<LesionBox | null> {
  const model = await getLesionModel();
  const { inputSize, chMajor, channels, anchors, numClasses } = readLayout(model);

  const manip = await manipulateAsync(uri, [{ resize: { width: inputSize, height: inputSize } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const { data } = raw as { data: Uint8Array };
  // RGB, 0..1 — the scale the detector's quality gates confirm it expects (DARK_THRESHOLD 0.2).
  const tensor = new Float32Array(inputSize * inputSize * 3);
  for (let i = 0, p = 0; i < tensor.length; i += 3, p += 4) {
    tensor[i] = data[p] / 255;
    tensor[i + 1] = data[p + 1] / 255;
    tensor[i + 2] = data[p + 2] / 255;
  }

  const outputs = await model.run([tensor.buffer as ArrayBuffer]);
  const out = new Float32Array(outputs?.[0] ?? new ArrayBuffer(0));
  if (out.length < anchors * channels) return null;

  // YOLOv8 head: box in channels 0..3 (cx,cy,w,h normalized), class scores in 4..; either layout.
  const cands: LesionBox[] = [];
  for (let i = 0; i < anchors; i++) {
    let score = 0;
    for (let k = 0; k < numClasses; k++) {
      const v = out[chMajor ? (4 + k) * anchors + i : i * channels + 4 + k];
      if (v > score) score = v;
    }
    if (score < DET_CONF) continue;
    cands.push({
      cx: out[chMajor ? i : i * channels],
      cy: out[chMajor ? anchors + i : i * channels + 1],
      bw: out[chMajor ? 2 * anchors + i : i * channels + 2],
      bh: out[chMajor ? 3 * anchors + i : i * channels + 3],
      conf: score,
    });
  }
  if (cands.length === 0) return null;

  let keep = cands.filter((c) => c.bw < FULL_FRAME || c.bh < FULL_FRAME);
  if (keep.length === 0) keep = cands;
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
 * Returns a square CropBox (centre + half-side, normalized to the short edge) for
 * preprocessForClassifier. Because the image is square, frame-fraction == short-edge-fraction.
 */
export function lesionBoxToCrop(box: LesionBox): CropBox {
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

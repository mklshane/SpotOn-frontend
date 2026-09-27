
import { transformToRgba } from '@/lib/image-ops';

import { getLesionModel, readLayout } from '../lesion-model';
import { DET_CONF, type LesionBox, selectLesionBox } from './detector-core';

/**
 * Still-image lesion localization with the app's YOLO detector - the same model, at the same
 * settings, that produced the training crops (SpotOn-synthetic/synth/datasets/medsam_crop.py).
 * Running it on every still and re-cropping to a canonical framing is what makes the classifier's
 * answer depend on the lesion instead of the user's zoom (validated 2026-07-25: a raw crop of one
 * benign mole flips MEL↔BENIGN across zoom levels; the detector re-crop holds BENIGN at every one).
 *
 * The live camera can't reuse this - its detector interpreter is busy on the camera thread and
 * calling it from JS crashes - so capture forwards the live box instead. The still path (both
 * capture-then-analyse and gallery upload) runs after the camera is gone, so it is safe here.
 */

export type { LesionBox } from './detector-core';
export { lesionBoxToCrop } from './detector-core';

/**
 * Serializes calls onto the one cached interpreter (`getLesionModel` returns a single shared
 * instance). Overlapping `run()` calls on it are not safe - the note above records that reaching
 * this interpreter while the camera thread holds it CRASHES - and since 2026-08-11 there are two
 * independent JS callers on the same screen: scan/quality.tsx's lesion gate and, via
 * classify.ts/DETECTOR_CROP_ENABLED, the classification pass that quality.tsx enqueues on mount.
 * Both run on the same still at the same moment.
 *
 * A promise chain rather than a real lock because every caller is on the JS thread: each waits for
 * the previous to finish, and a rejection is swallowed for queueing purposes only (the failing
 * caller still sees its own error) so one failure cannot wedge the queue.
 */
let detectorQueue: Promise<unknown> = Promise.resolve();

/**
 * Detect the best central lesion box in a still, in normalized [0,1] coords, or null when nothing
 * lesion-like is found. Assumes a square image (crop.tsx always outputs 1024²), so a plain resize
 * to the detector's input equals ultralytics' letterbox of a square - no padding, no aspect skew.
 *
 * Calls queue behind one another; see `detectorQueue`. Deterministic for a given uri, so two
 * callers racing on the same image agree by construction - the quality gate and the crop the
 * classifier picks can never disagree about whether this photo has a lesion.
 */
export function detectLesionBox(uri: string): Promise<LesionBox | null> {
  const run = detectorQueue.catch(() => {}).then(() => runDetector(uri));
  detectorQueue = run.catch(() => {});
  return run;
}

async function runDetector(uri: string): Promise<LesionBox | null> {
  const model = await getLesionModel();
  const { inputSize, chMajor, channels, anchors, numClasses } = readLayout(model);

  // image-ops: the browser's downscaler on web, so the detector sees the same sharpness a phone
  // would. It also returns pixels straight from the canvas - no JPEG round-trip.
  const { data } = await transformToRgba(uri, [
    { resize: { width: inputSize, height: inputSize } },
  ]);
  // RGB, 0..1 - the scale the detector's quality gates confirm it expects (DARK_THRESHOLD 0.2).
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
  return selectLesionBox(cands);
}

import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { NitroModules } from 'react-native-nitro-modules';
import { Worklets } from 'react-native-worklets-core';

import { getLesionModel, readLayout } from '@/lib/lesion-model';

export type IqaResult = {
  pass: boolean;
  reasons: string[];
  brightness: { ok: boolean; value: number };
  sharpness: { ok: boolean; value: number };
  skin: { ok: boolean; coverage: number };
  lesion: { found: boolean; score: number; box?: { x: number; y: number; w: number; h: number } };
};

// Thresholds — calibrate on-device from the [iqa] logs (see DEBUG).
const DARK = 0.16; // mean luminance (0..1) below this = too dark
const BRIGHT = 0.93; // above this = overexposed
const BLUR = 0.0009; // variance-of-Laplacian (normalized) below this = too blurry
const SKIN_MIN = 0.3; // fraction of skin-colored pixels (messaging only)
const DETECT_SCORE = 0.32; // lesion-detector confidence
const RUN_DETECTOR = true;
const DEBUG = true; // logs [iqa] metrics for calibration — set false when tuned

/**
 * On-device image-quality gate for a still photo. Decodes to RGB, computes brightness /
 * sharpness (variance of Laplacian) / skin-coverage in one pass, runs the lesion detector,
 * and aggregates pass/fail + reasons.
 *
 * fast-tflite only runs safely inside a worklet (the JS thread crashes), and worklets-core
 * can't share an ArrayBuffer in — so we pass the pixels in as a plain number[] and BUILD the
 * input Float32Array inside the worklet (allowed), exactly mirroring the camera path.
 */
export async function assessImage(uri: string): Promise<IqaResult> {
  const model = await getLesionModel();
  const layout = readLayout(model);
  const size = layout.inputSize;

  if (DEBUG) console.log('[iqa] start; model input size', size);
  const manip = await manipulateAsync(uri, [{ resize: { width: size, height: size } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });
  const { data, width, height } = raw; // RGBA Uint8Array, length w*h*4
  const n = width * height;
  if (DEBUG) console.log('[iqa] decoded', width, 'x', height);

  // Single pass: normalized RGB (number[] for the worklet), grayscale (for Laplacian),
  // mean luminance, and skin coverage.
  const rgb: number[] = new Array(width * height * 3);
  const gray = new Float32Array(n);
  let sumLuma = 0;
  let skinCount = 0;
  for (let p = 0, j = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rgb[j++] = r / 255;
    rgb[j++] = g / 255;
    rgb[j++] = b / 255;

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = luma;
    sumLuma += luma;

    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const ycc = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
    const rgbRule = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
    if (luma > 40 && (ycc || rgbRule)) skinCount++;
  }

  // Sharpness = variance of the 3x3 Laplacian over interior pixels (normalized by 255²).
  let lapSum = 0;
  let lapSumSq = 0;
  let lapN = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - width] - gray[idx + width];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? (lapSumSq / lapN - lapMean * lapMean) / (255 * 255) : 0;
  const brightness = sumLuma / n / 255;
  const skinCov = skinCount / n;

  // Lesion detector — run + decode inside a worklet; pixels come in as a number[], the input
  // Float32Array is built inside the worklet. Wrapped so a failure just skips it (never crashes).
  let best = 0;
  let cx = 0;
  let cy = 0;
  let bw = 0;
  let bh = 0;
  const expected = size * size * 3;
  if (RUN_DETECTOR && width === size && height === size && rgb.length === expected) {
    try {
      if (DEBUG) console.log('[iqa] detector worklet…');
      const boxed = NitroModules.box(model);
      const chMajor = layout.chMajor;
      const channels = layout.channels;
      const anchors = layout.anchors;
      const numClasses = layout.numClasses;
      const det = await Worklets.defaultContext.runAsync(() => {
        'worklet';
        const tflite = boxed.unbox();
        const buf = new Float32Array(rgb.length);
        for (let i = 0; i < rgb.length; i++) buf[i] = rgb[i];
        const outputs = tflite.runSync([buf.buffer]);
        const out = new Float32Array(outputs[0]);
        let b = 0;
        let dcx = 0;
        let dcy = 0;
        let dbw = 0;
        let dbh = 0;
        for (let i = 0; i < anchors; i++) {
          let score = 0;
          for (let k = 0; k < numClasses; k++) {
            const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
            if (v > score) score = v;
          }
          if (score > b) {
            b = score;
            dcx = out[chMajor ? i : i * channels];
            dcy = out[chMajor ? anchors + i : i * channels + 1];
            dbw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            dbh = out[chMajor ? 3 * anchors + i : i * channels + 3];
          }
        }
        return { b, dcx, dcy, dbw, dbh };
      });
      best = det.b;
      cx = det.dcx;
      cy = det.dcy;
      bw = det.dbw;
      bh = det.dbh;
      if (DEBUG) console.log('[iqa] detector done best=' + best.toFixed(2));
    } catch (e) {
      console.warn('[iqa] detector failed (skipped)', e);
    }
  }

  const brightnessOk = brightness >= DARK && brightness <= BRIGHT;
  const sharpOk = sharpness >= BLUR;
  const skinOk = skinCov >= SKIN_MIN;
  const lesionFound = best >= DETECT_SCORE;

  const reasons: string[] = [];
  if (brightness < DARK) reasons.push('The photo looks too dark.');
  else if (brightness > BRIGHT) reasons.push('The photo looks overexposed.');
  if (!sharpOk) reasons.push('The photo looks blurry — hold steady and tap to focus.');
  if (!lesionFound) {
    reasons.push(
      skinOk
        ? 'We couldn’t find a clear lesion — center the spot in the frame.'
        : 'This doesn’t look like a photo of skin.',
    );
  }

  // Lesion-centric: a clean pass needs a detected lesion (color alone can't tell skin from
  // skin-toned metal/cloth). Skin coverage only tailors the message above.
  const pass = brightnessOk && sharpOk && lesionFound;

  if (DEBUG) {
    console.log(
      '[iqa]',
      'bright=' + brightness.toFixed(2),
      'sharp=' + sharpness.toFixed(4),
      'skin=' + skinCov.toFixed(2),
      'lesion=' + best.toFixed(2),
      'pass=' + pass,
    );
  }

  return {
    pass,
    reasons,
    brightness: { ok: brightnessOk, value: brightness },
    sharpness: { ok: sharpOk, value: sharpness },
    skin: { ok: skinOk, coverage: skinCov },
    lesion: {
      found: lesionFound,
      score: best,
      box: lesionFound ? { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh } : undefined,
    },
  };
}

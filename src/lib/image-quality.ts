import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { getLesionModel, readLayout } from '@/lib/lesion-model';

export type IqaResult = {
  pass: boolean;
  reasons: string[];
  brightness: { ok: boolean; value: number };
  sharpness: { ok: boolean; value: number };
  skin: { ok: boolean; coverage: number };
  lesion: { found: boolean; score: number; box?: { x: number; y: number; w: number; h: number } };
};

// Thresholds — starting points; calibrate on-device from the [iqa] logs (see DEBUG).
const DARK = 0.16; // mean luminance (0..1) below this = too dark
const BRIGHT = 0.93; // above this = overexposed
const BLUR = 0.0008; // mean gradient energy below this = too blurry
const SKIN_MIN = 0.3; // fraction of skin-colored pixels to count as "skin"
const DETECT_SCORE = 0.32; // lesion-detector confidence (matches capture.tsx)
const RUN_DETECTOR = false; // TEMP: disabled to isolate the crash — if crash stops, runSync is the cause
const DEBUG = true; // logs [iqa] metrics for threshold calibration — set false when tuned

/**
 * On-device image-quality gate for a still photo. Decodes the image to RGB, computes
 * brightness / sharpness / skin-coverage, runs the lesion detector, and aggregates a
 * pass/fail with human-readable reasons. Pure JS + one TFLite inference (~<1s).
 */
export async function assessImage(uri: string): Promise<IqaResult> {
  const model = await getLesionModel();
  const layout = readLayout(model);
  const size = layout.inputSize;

  // Resize to the model input size and decode to RGBA bytes.
  if (DEBUG) console.log('[iqa] start; model input size', size);
  const manip = await manipulateAsync(uri, [{ resize: { width: size, height: size } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (DEBUG) console.log('[iqa] resized', manip.width, manip.height, 'b64len', manip.base64?.length ?? 0);
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });
  const { data, width, height } = raw; // data = RGBA Uint8Array, length w*h*4
  if (DEBUG) console.log('[iqa] decoded', width, 'x', height, 'datalen', data.length);
  const n = width * height;

  const input = new Float32Array(width * height * 3);
  let sumLuma = 0;
  let skinCount = 0;
  for (let p = 0, j = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    input[j++] = r / 255;
    input[j++] = g / 255;
    input[j++] = b / 255;

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sumLuma += luma;

    // Skin test: YCbCr range (robust across tones) OR the classic RGB rule.
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const ycc = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
    const rgb = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
    if (luma > 40 && (ycc || rgb)) skinCount++;
  }

  // Sharpness: mean horizontal luma-gradient energy (strided for speed).
  let grad = 0;
  let gc = 0;
  for (let y = 0; y < height; y += 4) {
    const row = y * width;
    for (let x = 0; x < width - 4; x += 4) {
      const i0 = (row + x) * 4;
      const i1 = (row + x + 4) * 4;
      const l0 = 0.299 * data[i0] + 0.587 * data[i0 + 1] + 0.114 * data[i0 + 2];
      const l1 = 0.299 * data[i1] + 0.587 * data[i1 + 1] + 0.114 * data[i1 + 2];
      const d = (l1 - l0) / 255;
      grad += d * d;
      gc++;
    }
  }

  const brightness = sumLuma / n / 255;
  const sharpness = gc > 0 ? grad / gc : 0;
  const skinCov = skinCount / n;

  // Lesion detector (runs directly on the JS thread — no worklet/box needed for a still).
  const { chMajor, channels, anchors, numClasses } = layout;
  let best = 0;
  let cx = 0;
  let cy = 0;
  let bw = 0;
  let bh = 0;
  const expected = size * size * 3;
  if (RUN_DETECTOR && width === size && height === size && input.length === expected) {
    if (DEBUG) console.log('[iqa] runSync…');
    const outputs = model.runSync([input.buffer as ArrayBuffer]);
    if (DEBUG) console.log('[iqa] runSync done', outputs[0]?.byteLength);
    const out = new Float32Array(outputs[0]);
    for (let i = 0; i < anchors; i++) {
      let score = 0;
      for (let k = 0; k < numClasses; k++) {
        const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
        if (v > score) score = v;
      }
      if (score > best) {
        best = score;
        cx = out[chMajor ? i : i * channels];
        cy = out[chMajor ? anchors + i : i * channels + 1];
        bw = out[chMajor ? 2 * anchors + i : i * channels + 2];
        bh = out[chMajor ? 3 * anchors + i : i * channels + 3];
      }
    }
  } else if (DEBUG) {
    console.log('[iqa] detector skipped (RUN_DETECTOR=' + RUN_DETECTOR + ', size ' + width + 'x' + height + ')');
  }

  const brightnessOk = brightness >= DARK && brightness <= BRIGHT;
  const sharpOk = sharpness >= BLUR;
  const skinOk = skinCov >= SKIN_MIN;
  const lesionFound = best >= DETECT_SCORE;

  const reasons: string[] = [];
  if (brightness < DARK) reasons.push('The photo looks too dark.');
  else if (brightness > BRIGHT) reasons.push('The photo looks overexposed.');
  if (!sharpOk) reasons.push('The photo looks blurry — hold steady and tap to focus.');
  if (!skinOk && !lesionFound) reasons.push('We couldn’t clearly find skin or a lesion in the photo.');

  const pass = brightnessOk && sharpOk && (skinOk || lesionFound);

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

import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

/**
 * Pure-JS image-quality checks for a still photo — brightness, sharpness (variance of
 * Laplacian) and skin-colour coverage. No TFLite here: the model only runs inside the camera
 * frame processor, so the lesion signal is carried from the live detector (see scan/quality).
 */
export type IqaChecks = {
  brightness: { ok: boolean; value: number };
  sharpness: { ok: boolean; value: number };
  skin: { ok: boolean; coverage: number };
};

const SIZE = 512; // analysis resolution (plenty for these metrics, fast to decode)
const DARK = 0.16; // mean luminance (0..1) below this = too dark
const BRIGHT = 0.93; // above this = overexposed
const BLUR = 0.0002; // variance-of-Laplacian (normalized) below this = too blurry — calibrate
const SKIN_MIN = 0.3; // fraction of skin-coloured pixels
const DEBUG = true; // logs [iqa] metrics for calibration — set false when tuned

export async function assessImage(uri: string): Promise<IqaChecks> {
  const manip = await manipulateAsync(uri, [{ resize: { width: SIZE, height: SIZE } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });
  const { data, width, height } = raw; // RGBA Uint8Array
  const n = width * height;

  const gray = new Float32Array(n);
  let sumLuma = 0;
  let skinCount = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
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

  if (DEBUG) {
    console.log('[iqa]', 'bright=' + brightness.toFixed(2), 'sharp=' + sharpness.toFixed(4), 'skin=' + skinCov.toFixed(2));
  }

  return {
    brightness: { ok: brightness >= DARK && brightness <= BRIGHT, value: brightness },
    sharpness: { ok: sharpness >= BLUR, value: sharpness },
    skin: { ok: skinCov >= SKIN_MIN, coverage: skinCov },
  };
}

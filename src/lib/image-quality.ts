import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

/**
 * Pure-JS image-quality checks for a still photo, adopting Stanford TrueImage's key idea:
 * assess the lesion region, not the whole frame. Our crop step centers the lesion (the "center
 * the spot in the circle" guide), so the image center ≈ the lesion — blur is measured on a
 * centered ROI. Lighting evenness uses a directional gradient (a cast shadow darkens one side,
 * while a centered dark lesion stays symmetric, so it isn't mistaken for a shadow). No TFLite —
 * the lesion verdict is carried from the live detector (see scan/quality).
 */
export type IqaChecks = {
  brightness: { ok: boolean; value: number }; // ok = in range AND evenly lit (no shadow)
  sharpness: { ok: boolean; value: number }; // measured on the centered lesion ROI
  shadow: { ok: boolean; value: number }; // directional light gradient (0..1)
  skin: { ok: boolean; coverage: number };
};

const SIZE = 768; // analysis resolution
const ROI_FRAC = 0.5; // centered lesion region (matches the crop guide) for the blur check
const DARK = 0.16; // mean luminance (0..1) below this = too dark
const BRIGHT = 0.93; // above this = overexposed
const BLUR = 0.001; // variance-of-Laplacian on the ROI below this = too blurry
const SHADOW_GRAD = 0.1; // one side this much darker than the other (0..1) = shadow / uneven
const SKIN_MIN = 0.3; // fraction of skin-coloured pixels
const DEBUG = true; // logs [iqa] metrics for calibration — set false when tuned

export async function assessImage(uri: string): Promise<IqaChecks> {
  const manip = await manipulateAsync(uri, [{ resize: { width: SIZE, height: SIZE } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });
  const { data, width: W, height: H } = raw; // RGBA Uint8Array
  const n = W * H;

  const gray = new Float32Array(n);
  let sumLuma = 0;
  let skinCount = 0;
  let leftSum = 0;
  let rightSum = 0;
  let topSum = 0;
  let botSum = 0;
  const halfW = W / 2;
  const halfH = H / 2;
  for (let y = 0; y < H; y++) {
    const base = y * W;
    const isTop = y < halfH;
    for (let x = 0; x < W; x++) {
      const i = (base + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[base + x] = luma;
      sumLuma += luma;
      if (x < halfW) leftSum += luma;
      else rightSum += luma;
      if (isTop) topSum += luma;
      else botSum += luma;

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const ycc = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
      const rgbRule = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
      if (luma > 40 && (ycc || rgbRule)) skinCount++;
    }
  }

  // Sharpness = variance of the 3x3 Laplacian over the CENTERED ROI only (the lesion region).
  const rx0 = Math.max(1, Math.floor((W * (1 - ROI_FRAC)) / 2));
  const rx1 = Math.min(W - 1, Math.floor((W * (1 + ROI_FRAC)) / 2));
  const ry0 = Math.max(1, Math.floor((H * (1 - ROI_FRAC)) / 2));
  const ry1 = Math.min(H - 1, Math.floor((H * (1 + ROI_FRAC)) / 2));
  let lapSum = 0;
  let lapSumSq = 0;
  let lapN = 0;
  for (let y = ry0; y < ry1; y++) {
    const row = y * W;
    for (let x = rx0; x < rx1; x++) {
      const idx = row + x;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - W] - gray[idx + W];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? (lapSumSq / lapN - lapMean * lapMean) / (255 * 255) : 0;

  // Directional light gradient: a cast shadow darkens one side; a centered lesion stays symmetric.
  const cols = halfW * H;
  const rows = halfH * W;
  const leftMean = leftSum / cols;
  const rightMean = rightSum / cols;
  const topMean = topSum / rows;
  const botMean = botSum / rows;
  const shadow = Math.max(Math.abs(leftMean - rightMean), Math.abs(topMean - botMean)) / 255;

  const brightness = sumLuma / n / 255;
  const skinCov = skinCount / n;
  const rangeOk = brightness >= DARK && brightness <= BRIGHT;
  const shadowOk = shadow <= SHADOW_GRAD;

  if (DEBUG) {
    console.log(
      '[iqa]',
      'bright=' + brightness.toFixed(2),
      'sharpROI=' + sharpness.toFixed(4),
      'shadow=' + shadow.toFixed(3),
      'skin=' + skinCov.toFixed(2),
    );
  }

  return {
    brightness: { ok: rangeOk && shadowOk, value: brightness },
    sharpness: { ok: sharpness >= BLUR, value: sharpness },
    shadow: { ok: shadowOk, value: shadow },
    skin: { ok: skinCov >= SKIN_MIN, coverage: skinCov },
  };
}

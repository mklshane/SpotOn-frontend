import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Image as RNImage } from 'react-native';

import { ClassifierError } from './errors';
import {
  IMAGENET_MEAN,
  IMAGENET_STD,
  PREPROCESS_STEPS,
  type Normalization,
} from './model-config';

/**
 * Pure tensor packing: RGBA bytes → normalized Float32Array NHWC RGB.
 * Kept side-effect free so scripts can unit-test the math without native modules.
 */
export function packRgbaToTensor(
  data: Uint8Array,
  width: number,
  height: number,
  normalization: Normalization,
): Float32Array {
  const out = new Float32Array(width * height * 3);
  let o = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c] / 255;
      out[o++] =
        normalization === 'imagenet'
          ? (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c]
          : normalization === 'plusMinusOne'
            ? v * 2 - 1
            : v; // zeroOne
    }
  }
  return out;
}

/**
 * Flip a packed NHWC RGB tensor in-plane. Used to build the 4-view TTA set without paying for
 * four JPEG decodes: bilinear resize commutes with an axis flip, so flipping the already-resized
 * tensor is equivalent to flipping the source image and resizing it.
 */
export function flipTensor(
  t: Float32Array,
  size: number,
  { horizontal = false, vertical = false }: { horizontal?: boolean; vertical?: boolean },
): Float32Array {
  if (!horizontal && !vertical) return t;
  const out = new Float32Array(t.length);
  const rowStride = size * 3;
  for (let y = 0; y < size; y++) {
    const srcY = vertical ? size - 1 - y : y;
    for (let x = 0; x < size; x++) {
      const srcX = horizontal ? size - 1 - x : x;
      const src = srcY * rowStride + srcX * 3;
      const dst = y * rowStride + x * 3;
      out[dst] = t[src];
      out[dst + 1] = t[src + 1];
      out[dst + 2] = t[src + 2];
    }
  }
  return out;
}

/** The 4 dihedral views the D4 operating point was calibrated on, in a fixed order. */
export function ttaViews(t: Float32Array, size: number): Float32Array[] {
  return [
    t,
    flipTensor(t, size, { horizontal: true }),
    flipTensor(t, size, { vertical: true }),
    flipTensor(t, size, { horizontal: true, vertical: true }),
  ];
}

/** Pixel dimensions of an image, read from its header (no decode). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

/** A square crop in normalized units: centre and half-side as fractions of the shorter image edge. */
export type CropBox = { cx: number; cy: number; half: number };

/**
 * Decode a small grayscale copy of the image and locate the lesion. Small on purpose: the blob
 * math is scale-invariant, so a ~96px decode is enough and keeps this far cheaper than a full pass.
 * Returns a normalized CropBox, or null when no confident blob is found.
 */
export async function locateLesionInImage(
  uri: string,
  opts: { size?: number; madK?: number; targetFill?: number } = {},
): Promise<CropBox | null> {
  const { size = 96, ...blobOpts } = opts;
  try {
    const manip = await manipulateAsync(uri, [{ resize: { width: size, height: size } }], {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: true,
    });
    const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), {
      useTArray: true,
      formatAsRGBA: true,
    });
    const { data, width, height } = raw as { data: Uint8Array; width: number; height: number };
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      // Rec. 601 luma — matches PIL's "L" conversion used to validate the localizer.
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return locateLesion(gray, width, height, blobOpts);
  } catch {
    return null; // localization is best-effort; a failure just means "don't refine"
  }
}

/**
 * Locate the lesion in a decoded grayscale buffer as a dark blob against skin — pure so it can be
 * unit-tested without native modules. Returns a centered square `CropBox` sized so the blob fills
 * `targetFill` of it, or null when no confident blob is found (leave the framing alone).
 *
 * Pigmented lesions sit well below skin brightness, so the skin tone is the pixel *median* and the
 * lesion is the tail: threshold at `median − madK × MAD` (MAD = median absolute deviation, a
 * robust spread that hair and specular highlights don't inflate the way a standard deviation
 * would). The 85th-percentile radius from the blob centroid ignores stray dark pixels. This is the
 * exact recipe validated on dataset_real (2026-07-24): as a confidence-gated refinement it lifts
 * top-1 51%→58% and never broke a previously-correct image.
 */
export function locateLesion(
  gray: Uint8Array,
  width: number,
  height: number,
  opts: { madK?: number; targetFill?: number } = {},
): CropBox | null {
  const { madK = 4, targetFill = 0.45 } = opts;
  const n = width * height;
  if (n < 64) return null;

  const sorted = Uint8Array.from(gray).sort();
  const median = sorted[n >> 1];
  // MAD without a second sort: fold |g − median| into a 256-bucket histogram (deviations are 0..255).
  const devHist = new Int32Array(256);
  for (let i = 0; i < n; i++) devHist[Math.abs(gray[i] - median)]++;
  let acc = 0;
  let mad = 0;
  for (let d = 0; d < 256; d++) {
    acc += devHist[d];
    if (acc * 2 >= n) {
      mad = d;
      break;
    }
  }
  const threshold = median - madK * Math.max(mad, 1);

  // Blob centroid, and the mean |offset| per axis (used to derive an 85th-pct radius cheaply).
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  if (count < Math.max(24, n * 0.004)) return null; // too few dark pixels — no lesion to lock onto
  const cxPx = sx / count;
  const cyPx = sy / count;

  // 85th-percentile absolute offset per axis via a small histogram of |x−cx| / |y−cy|.
  const rHist = new Int32Array(Math.max(width, height) + 1);
  const push = (v: number) => rHist[Math.round(v)]++;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) {
        push(Math.max(Math.abs(x - cxPx), Math.abs(y - cyPx)));
      }
    }
  }
  let racc = 0;
  let rPx = 0;
  const target = count * 0.85;
  for (let d = 0; d < rHist.length; d++) {
    racc += rHist[d];
    if (racc >= target) {
      rPx = d;
      break;
    }
  }
  const shortEdge = Math.min(width, height);
  const halfPx = Math.max(rPx, 8) / targetFill;
  return {
    cx: cxPx / shortEdge,
    cy: cyPx / shortEdge,
    half: halfPx / shortEdge,
  };
}

/**
 * Full preprocessing chain for a still image: resize to the model's input size
 * *before* decoding (so jpeg-js only ever touches an inputSize² buffer, never the
 * 1024² crop — same recipe as image-quality.ts), then decode, run any configured
 * pixel steps, and pack to a normalized tensor.
 *
 * `cropFraction` < 1 takes a centered square crop of that fraction of the shorter side first,
 * which is how the scale-consistency check re-frames the same photo tighter. `cropBox` instead
 * crops around a located lesion (confidence-gated zoom refinement). At the defaults (cropFraction
 * 1, no cropBox) no crop is applied, so the primary prediction's pixels are bit-identical to what
 * this function produced before either feature existed. `cropBox` takes precedence over
 * `cropFraction` when both are given.
 */
export async function preprocessForClassifier(
  uri: string,
  inputSize: number,
  normalization: Normalization,
  cropFraction = 1,
  cropBox?: CropBox,
): Promise<Float32Array> {
  try {
    const actions: Parameters<typeof manipulateAsync>[1] = [];
    if (cropBox) {
      const { width, height } = await imageSize(uri);
      const shortEdge = Math.min(width, height);
      const half = cropBox.half * shortEdge;
      // Clamp the box fully inside the image; a lesion near an edge just yields a smaller crop.
      const cxPx = cropBox.cx * shortEdge;
      const cyPx = cropBox.cy * shortEdge;
      const maxHalf = Math.min(half, cxPx, cyPx, width - cxPx, height - cyPx);
      const side = Math.max(1, Math.round(2 * maxHalf));
      actions.push({
        crop: {
          originX: Math.round(cxPx - side / 2),
          originY: Math.round(cyPx - side / 2),
          width: side,
          height: side,
        },
      });
    } else if (cropFraction < 1) {
      const { width, height } = await imageSize(uri);
      const side = Math.max(1, Math.round(Math.min(width, height) * cropFraction));
      actions.push({
        crop: {
          originX: Math.round((width - side) / 2),
          originY: Math.round((height - side) / 2),
          width: side,
          height: side,
        },
      });
    }
    actions.push({ resize: { width: inputSize, height: inputSize } });
    const manip = await manipulateAsync(uri, actions, {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: true,
    });
    const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), {
      useTArray: true,
      formatAsRGBA: true,
    });
    let img = { data: raw.data as Uint8Array, width: raw.width, height: raw.height };
    for (const step of PREPROCESS_STEPS) img = step(img);
    return packRgbaToTensor(img.data, img.width, img.height, normalization);
  } catch (e) {
    if (e instanceof ClassifierError) throw e;
    throw new ClassifierError('preprocess', 'failed to preprocess image for classifier', e);
  }
}

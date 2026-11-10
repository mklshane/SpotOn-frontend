import type { Action } from 'expo-image-manipulator';
import { Image as RNImage } from 'react-native';

import { transformToRgba } from '@/lib/image-ops';

import { type CropBox, locateLesion } from './blob-core';
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

/**
 * NHWC → NCHW (channel-planar) repack, applied last - after the flips above - because everything
 * else in this file, and the resize/crop it inherits, is interleaved RGB.
 *
 * Needed because the D10 export is NCHW [1,3,H,W] while every export before it was NHWC [1,H,W,3]
 * (litert-torch traces the PyTorch graph as-is; the earlier exporters inserted a transpose). Both
 * layouts are the same byte count, so a mismatch does NOT fail at the interpreter - it silently
 * feeds the model a scrambled image. classify.ts picks the layout from the model's own input shape
 * rather than assuming either one.
 */
export function nhwcToNchw(t: Float32Array, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3);
  for (let i = 0, o = 0; i < plane; i++, o += 3) {
    out[i] = t[o];
    out[plane + i] = t[o + 1];
    out[2 * plane + i] = t[o + 2];
  }
  return out;
}

/** Pixel dimensions of an image, read from its header (no decode). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

export type { CropBox } from './blob-core';
export { locateLesion, scanLesionBlobs } from './blob-core';

/**
 * Decode a small copy of the image and locate the lesion in it. Small on purpose: the blob math is
 * scale-invariant, and 64px is where the DoG radii were tuned - it also thins body hair to
 * sub-pixel, which is half the reason the response is robust. Far cheaper than a full pass.
 * Returns a normalized CropBox, or null when nothing lesion-like is found.
 */
export async function locateLesionInImage(
  uri: string,
  opts: { size?: number; targetFill?: number; centralFrac?: number } = {},
): Promise<CropBox | null> {
  const { size = 64, ...blobOpts } = opts;
  try {
    // Resize the SHORTER side to `size`, preserving aspect. Squashing to a square would skew the
    // centroid and radius on non-square uploads (gallery photos are rarely 1:1), and the returned
    // CropBox is normalized to the short edge - which only round-trips if aspect is preserved.
    const { width: srcW, height: srcH } = await imageSize(uri);
    const resize = srcW <= srcH ? { width: size } : { height: size };
    // image-ops: browser downscaler on web (see that file) - locateLesion reads edges, so the
    // resampler matters here for the same reason it does in the blur gate.
    const { data, width, height } = await transformToRgba(uri, [{ resize }]);
    // RGBA straight through - locateLesion needs colour for its skin-surround check, not just luma.
    return locateLesion(data, width, height, blobOpts);
  } catch {
    return null; // localization is best-effort; a failure just means "don't refine"
  }
}

/**
 * Full preprocessing chain for a still image: resize to the model's input size
 * *before* decoding (so jpeg-js only ever touches an inputSize² buffer, never the
 * 1024² crop - same recipe as image-quality.ts), then decode, run any configured
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
    const actions: Action[] = [];
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
    // image-ops: browser downscaler on web. This is the classifier's actual input, so a softer
    // resampler here means the model sees different pixels on web than on a device.
    const raw = await transformToRgba(uri, actions);
    let img = { data: raw.data, width: raw.width, height: raw.height };
    for (const step of PREPROCESS_STEPS) img = step(img);
    return packRgbaToTensor(img.data, img.width, img.height, normalization);
  } catch (e) {
    if (e instanceof ClassifierError) throw e;
    throw new ClassifierError('preprocess', 'failed to preprocess image for classifier', e);
  }
}

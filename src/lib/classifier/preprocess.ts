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
 * Decode a small copy of the image and locate the lesion in it. Small on purpose: the blob math is
 * scale-invariant, and 64px is where the DoG radii were tuned — it also thins body hair to
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
    // CropBox is normalized to the short edge — which only round-trips if aspect is preserved.
    const { width: srcW, height: srcH } = await imageSize(uri);
    const resize = srcW <= srcH ? { width: size } : { height: size };
    const manip = await manipulateAsync(uri, [{ resize }], {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: true,
    });
    const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), {
      useTArray: true,
      formatAsRGBA: true,
    });
    const { data, width, height } = raw as { data: Uint8Array; width: number; height: number };
    // RGBA straight through — locateLesion needs colour for its skin-surround check, not just luma.
    return locateLesion(data, width, height, blobOpts);
  } catch {
    return null; // localization is best-effort; a failure just means "don't refine"
  }
}

/**
 * Locate the lesion as a compact, locally-dark blob sitting on skin — pure, so it can be
 * unit-tested without native modules. Returns a square `CropBox` sized so the blob fills
 * `targetFill` of it, or null when nothing lesion-like is found (leave the framing alone).
 *
 * Uses a difference-of-Gaussians response (large-radius blur minus small-radius blur) rather than a
 * brightness threshold. That choice is load-bearing, from failures on real phone photos
 * (2026-07-24): a global `median - k*MAD` threshold keys on whole-image spread, so body hair and
 * dark backgrounds inflate MAD until the threshold drops below the lesion — on one device photo it
 * went negative and matched nothing at all. DoG instead asks "is this spot darker than its
 * immediate surroundings", which thin hair fails (the small blur erases it) and broad shading fails
 * (the large blur cancels it).
 *
 * Two guards keep it off background clutter, both needed for real uploads:
 *  - only the central `centralFrac` of the frame is searched (the user framed the spot);
 *  - the ring just outside a candidate must look like skin, else it is discarded and the next
 *    strongest peak is tried. This is what rejects a black jacket behind a face.
 *
 * Validated on SpotOn-synthetic/retrain (972 images): as a confidence-gated refinement it lifts
 * top-1 73.0% -> 76.9%, and it locates a lesion in 335/341 low-confidence images where the old
 * MAD localizer gave up on 114.
 */
export function locateLesion(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: {
    targetFill?: number;
    blurSmall?: number;
    blurLarge?: number;
    centralFrac?: number;
    relThr?: number;
    maxTries?: number;
    minPeak?: number;
    centralityWeight?: number;
  } = {},
): CropBox | null {
  const {
    targetFill = 0.45,
    blurSmall = 2,
    blurLarge = 8,
    centralFrac = 0.7,
    relThr = 0.5,
    maxTries = 8,
    // Minimum DoG response (grey levels darker than surround) to count as a lesion. Measured
    // across 335 real lesions in SpotOn-synthetic/retrain the weakest peaks at 8.1, so 6 rejects
    // none of them while discarding sensor specks, which peak around 5.
    minPeak = 6,
    // How strongly to prefer a central candidate over a merely stronger one. Taking the strongest
    // peak outright located the lesion in only 5 of 7 real uploads — a figure caption and a pair
    // of spectacle frames won on raw contrast; weighting by centrality gets all 7.
    centralityWeight = 3,
  } = opts;
  const n = width * height;
  if (n < 256 || rgba.length < n * 4) return null;

  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Rec. 601 luma — matches the PIL "L" conversion the recipe was validated against.
    gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }

  // Separable box blur with clamped edges (a cheap Gaussian stand-in; the DoG only needs scale
  // separation, not an exact kernel).
  const blur = (src: Float32Array, r: number): Float32Array => {
    const win = 2 * r + 1;
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + clamp(k, width - 1)];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = sum / win;
        sum += src[row + clamp(x + r + 1, width - 1)] - src[row + clamp(x - r, width - 1)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clamp(k, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / win;
        sum += tmp[clamp(y + r + 1, height - 1) * width + x] - tmp[clamp(y - r, height - 1) * width + x];
      }
    }
    return out;
  };

  const small = blur(gray, blurSmall);
  const large = blur(gray, blurLarge);
  const resp = new Float32Array(n);
  for (let i = 0; i < n; i++) resp[i] = large[i] - small[i]; // >0 where locally darker

  const y0 = Math.floor((height * (1 - centralFrac)) / 2);
  const x0 = Math.floor((width * (1 - centralFrac)) / 2);
  const y1 = height - y0;
  const x1 = width - x0;
  const shortEdge = Math.min(width, height);
  const excluded = new Uint8Array(n);
  let bestCandidate: { score: number; box: CropBox } | null = null;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    // Strongest remaining response inside the central window.
    let peak = -Infinity;
    let peakIdx = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (!excluded[i] && resp[i] > peak) {
          peak = resp[i];
          peakIdx = i;
        }
      }
    }
    if (peakIdx < 0 || peak < minPeak) return null; // nothing meaningfully darker than its surroundings

    // Flood-fill the blob containing that peak, down to relThr of it.
    const cut = peak * relThr;
    const comp: number[] = [];
    const seen = new Uint8Array(n);
    const stack = [peakIdx];
    seen[peakIdx] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      const push = (nx: number, ny: number) => {
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) return;
        const j = ny * width + nx;
        if (seen[j] || excluded[j] || resp[j] < cut) return;
        seen[j] = 1;
        stack.push(j);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }

    // A lesion spans many pixels even at this scale (≈650px at the target fill); anything this
    // small is sensor noise or a dust speck, and zooming to it would be a wild over-crop.
    if (comp.length < 4) {
      for (const i of comp) excluded[i] = 1;
      continue;
    }

    let sx = 0;
    let sy = 0;
    for (const i of comp) {
      sx += i % width;
      sy += (i / width) | 0;
    }
    const cx = sx / comp.length;
    const cy = sy / comp.length;
    // 90th-percentile Chebyshev offset — robust to a few stragglers in the flood fill.
    const offs = comp
      .map((i) => Math.max(Math.abs((i % width) - cx), Math.abs(((i / width) | 0) - cy)))
      .sort((a, b) => a - b);
    const r = Math.max(offs[Math.min(offs.length - 1, Math.floor(offs.length * 0.9))], 2.5);

    // Does this blob sit on skin? Sample a thin ring that hugs the blob's ACTUAL shape (a small
    // dilation minus the blob), not a square annulus around its centroid. For a large or irregular
    // blob an annulus reaches into unrelated regions — around a dark jacket behind a face it
    // catches real skin and averages to "skin", the exact false accept this guard exists to stop.
    // Blob pixels and any other dark structure are excluded so the lesion's own colour can't leak in.
    const ringWidth = 3;
    const inRing = new Uint8Array(n);
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let cnt = 0;
    for (const i of comp) {
      const bx = i % width;
      const by = (i / width) | 0;
      for (let dy = -ringWidth; dy <= ringWidth; dy++) {
        const y = by + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -ringWidth; dx <= ringWidth; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= width) continue;
          const j = y * width + x;
          if (inRing[j] || seen[j] || resp[j] >= cut) continue;
          inRing[j] = 1;
          const p = j * 4;
          rs += rgba[p];
          gs += rgba[p + 1];
          bs += rgba[p + 2];
          cnt++;
        }
      }
    }
    const ar = rs / Math.max(cnt, 1);
    const ag = gs / Math.max(cnt, 1);
    const ab = bs / Math.max(cnt, 1);
    // Skin is warm and not dark: red leads blue, some saturation, reasonable brightness.
    const skin =
      cnt > 4 && ar > 70 && ar > ab + 8 && ar >= ag && Math.max(ar, ag, ab) - Math.min(ar, ag, ab) > 6;
    const tooBig = (2 * r) / shortEdge > 0.7;

    if (skin && !tooBig) {
      // Collect rather than return: the strongest response is not always the lesion. On real
      // uploads a figure caption or a spectacle frame can out-peak the lesion, so all plausible
      // candidates are scored below and the most central one wins.
      const dist = Math.hypot(cy - height / 2, cx - width / 2) / Math.max(width, height);
      const score = peak * Math.exp(-centralityWeight * dist);
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          score,
          box: { cx: cx / shortEdge, cy: cy / shortEdge, half: r / targetFill / shortEdge },
        };
      }
    }
    for (const i of comp) excluded[i] = 1; // consumed — move on to the next strongest peak
  }
  return bestCandidate ? bestCandidate.box : null;
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

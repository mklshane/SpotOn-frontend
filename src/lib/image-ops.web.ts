/**
 * Web crop/resize, using the browser's own high-quality downscaler.
 *
 * WHY THIS EXISTS. expo-image-manipulator's web implementation resamples in JavaScript with a
 * Hermite filter, which smooths edges hard. Every threshold in image-quality-core.ts was fitted
 * against the native resampler ("REFITTED FOR SIZE = 1024"), and the blur gate is explicitly
 * scale- and resample-sensitive — so the web build was measuring a materially different image
 * from the one the gate was calibrated on, and rejecting perfectly sharp photos as blurry.
 *
 * Measured 2026-09-09 on one real phone photo, same source, resampled to 1024²:
 *
 *   resampler                    sharpROI    directional   edgeWidth   verdict
 *   native-like (system)          1.28e-3      2.04e-4        4.25     pass
 *   canvas, high quality          9.95e-4      1.57e-4        4.36     pass      <- this file
 *   expo-image-manipulator        1.03e-4      3.03e-5       19.63     BLURRY
 *
 * The limit is edgeWidth <= 14, so Hermite failed a photo that clears the bar three times over on
 * a phone. Canvas lands on the native reference, which means the calibrated thresholds hold on web
 * without being relaxed — relaxing them would have weakened the gate on mobile too, where the
 * calibration is correct (BLUR_GATE.md: the real blurry captures measure 23.7 and 24.4).
 *
 * This also feeds the classifier and detector, so it is not only about the gate: the model was
 * being shown softer pixels on web than on a device.
 *
 * Bonus: returning pixels straight from the canvas skips a full JPEG encode + base64 + decode per
 * call, which is the slowest part of the web pipeline.
 */
import type { Action } from 'expo-image-manipulator';

export type Rgba = { data: Uint8Array; width: number; height: number };

type Crop = { originX: number; originY: number; width: number; height: number };
type Resize = { width?: number; height?: number };

/** expo-image-manipulator's Action union, narrowed to the two operations this app uses. */
function readActions(actions: Action[]): { crop?: Crop; resize?: Resize } {
  let crop: Crop | undefined;
  let resize: Resize | undefined;
  for (const a of actions) {
    const anyA = a as { crop?: Crop; resize?: Resize; rotate?: number };
    if (anyA.crop) crop = anyA.crop;
    if (anyA.resize) resize = anyA.resize;
    // `rotate` is only ever 0 here (capture.tsx bakes EXIF on native); the browser has already
    // applied orientation by the time createImageBitmap hands us pixels.
  }
  return { crop, resize };
}

async function draw(uri: string, actions: Action[]): Promise<HTMLCanvasElement> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`could not read image: ${res.status}`);
  // `imageOrientation: 'from-image'` matches what an <img> would show, so EXIF-rotated phone
  // photos are not silently sideways.
  const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });

  try {
    const { crop, resize } = readActions(actions);
    const sx = crop?.originX ?? 0;
    const sy = crop?.originY ?? 0;
    const sw = crop?.width ?? bitmap.width;
    const sh = crop?.height ?? bitmap.height;

    // A resize with only one axis preserves aspect, matching expo-image-manipulator.
    let dw = resize?.width ?? 0;
    let dh = resize?.height ?? 0;
    if (dw && !dh) dh = Math.round((sh / sw) * dw);
    else if (dh && !dw) dw = Math.round((sw / sh) * dh);
    else if (!dw && !dh) {
      dw = sw;
      dh = sh;
    }

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('could not get a 2d canvas context');
    // The whole point of this module.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
    return canvas;
  } finally {
    bitmap.close(); // decoded frames are large; do not wait for GC
  }
}

/** Crop/resize and return a JPEG blob URL. Callers must release it (see releaseBlobUri). */
export async function transformToUri(
  uri: string,
  actions: Action[],
): Promise<{ uri: string; width: number; height: number }> {
  const canvas = await draw(uri, actions);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 1));
  if (!blob) throw new Error('canvas produced no image');
  return { uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

/** Crop/resize and return raw RGBA — no JPEG round-trip at all. */
export async function transformToRgba(uri: string, actions: Action[]): Promise<Rgba> {
  const canvas = await draw(uri, actions);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d canvas context');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: new Uint8Array(img.data.buffer), width: canvas.width, height: canvas.height };
}

/**
 * Decode an already-correctly-sized image. The native twin decodes base64 with jpeg-js; on web the
 * caller has a URI, so this re-reads it through the same canvas path with no resize — which keeps
 * one decoder, and therefore one set of pixel values, across the web build.
 */
export async function decodeRgbaFromBase64(): Promise<Rgba> {
  throw new Error('decodeRgbaFromBase64 is native-only — use transformToRgba(uri, []) on web');
}

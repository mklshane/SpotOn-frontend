/**
 * Crop/resize primitives for the image pipeline.
 *
 * Native re-exports the existing `expo-image-manipulator` + `jpeg-js` behaviour verbatim, so
 * device output is bit-for-bit what it was. The web build resolves `image-ops.web.ts`, which uses
 * the browser's own downscaler instead — see that file for why that is a correctness fix and not
 * an optimisation.
 */
import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

export type Rgba = { data: Uint8Array; width: number; height: number };

/** Crop/resize and return a JPEG URI. */
export async function transformToUri(
  uri: string,
  actions: Action[],
): Promise<{ uri: string; width: number; height: number }> {
  const out = await manipulateAsync(uri, actions, { compress: 1, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

/** Crop/resize and return raw RGBA pixels. */
export async function transformToRgba(uri: string, actions: Action[]): Promise<Rgba> {
  const out = await manipulateAsync(uri, actions, {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(out.base64 ?? '', 'base64'), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return { data: raw.data as Uint8Array, width: raw.width, height: raw.height };
}

/** Decode an image that already has the right dimensions — no resample. */
export async function decodeRgbaFromBase64(base64: string): Promise<Rgba> {
  const raw = jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true, formatAsRGBA: true });
  return { data: raw.data as Uint8Array, width: raw.width, height: raw.height };
}

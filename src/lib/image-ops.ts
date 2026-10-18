/**
 * Crop/resize primitives for the image pipeline.
 *
 * Native re-exports the existing `expo-image-manipulator` + `jpeg-js` behaviour verbatim, so
 * device output is bit-for-bit what it was. The web build resolves `image-ops.web.ts`, which uses
 * the browser's own downscaler instead - see that file for why that is a correctness fix and not
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

/**
 * transformToRgba, but decoded natively by Skia instead of jpeg-js. For the upload's multi-spot
 * search (classifier/lesion-candidates.ts), where jpeg-js decoding the 768px working copy in
 * JavaScript took 0.2-1.1 s of an iPhone's search (measured 2026-10-17). The manipulator still does
 * the resize - and with it the EXIF rotation - and writes a plain JPEG; Skia only decodes that file,
 * so orientation cannot differ from the jpeg-js path. Any failure (Skia unavailable, a decode that
 * returns nothing, unexpected dimensions) falls back to transformToRgba. Not used where outputs must
 * stay bit-for-bit with the training pipeline - the classifier and the quality gate keep jpeg-js.
 */
/** Which decoder the last transformToRgbaFast used - shown in the spot search's diagnostics. */
export let lastFastDecoder: 'skia' | 'jpeg-js' = 'jpeg-js';

export async function transformToRgbaFast(uri: string, actions: Action[]): Promise<Rgba> {
  const out = await manipulateAsync(uri, actions, { compress: 1, format: SaveFormat.JPEG });
  try {
    // Lazy: Skia is otherwise unused at runtime, so it is only loaded when a search runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Skia, AlphaType, ColorType } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(out.uri));
    if (!img) throw new Error('skia decode returned null');
    const width = img.width();
    const height = img.height();
    if (width !== out.width || height !== out.height) throw new Error('skia decode size mismatch');
    const px = img.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!(px instanceof Uint8Array) || px.length !== width * height * 4) throw new Error('skia readPixels failed');
    lastFastDecoder = 'skia';
    return { data: px, width, height };
  } catch {
    lastFastDecoder = 'jpeg-js';
    return transformToRgba(out.uri, []);
  }
}

/** Decode an image that already has the right dimensions - no resample. */
export async function decodeRgbaFromBase64(base64: string): Promise<Rgba> {
  const raw = jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true, formatAsRGBA: true });
  return { data: raw.data as Uint8Array, width: raw.width, height: raw.height };
}

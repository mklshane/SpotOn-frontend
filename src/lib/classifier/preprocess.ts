import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

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
 * Full preprocessing chain for a still image: resize to the model's input size
 * *before* decoding (so jpeg-js only ever touches an inputSize² buffer, never the
 * 1024² crop — same recipe as image-quality.ts), then decode, run any configured
 * pixel steps, and pack to a normalized tensor.
 */
export async function preprocessForClassifier(
  uri: string,
  inputSize: number,
  normalization: Normalization,
): Promise<Float32Array> {
  try {
    const manip = await manipulateAsync(
      uri,
      [{ resize: { width: inputSize, height: inputSize } }],
      { compress: 1, format: SaveFormat.JPEG, base64: true },
    );
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

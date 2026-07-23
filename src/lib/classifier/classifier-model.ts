import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';

import { ClassifierError } from './errors';
import { FALLBACK_INPUT_SIZE, MODEL_ASSET, MODEL_VERSION } from './model-config';

/** The loaded TFLite classifier handle (5-class lesion classifier). */
export type ClassifierModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

let modelPromise: Promise<ClassifierModel> | null = null;

/**
 * Load the classifier once and cache it (same pattern as lesion-model.ts). In dev,
 * Metro serves the asset over http, which the native loader can't fetch directly —
 * download it to a local file first. Call early (e.g. on quality-screen mount) to
 * overlap the load with UI time the user is already spending.
 */
export function getClassifierModel(): Promise<ClassifierModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const src = Image.resolveAssetSource(MODEL_ASSET);
      let uri = src.uri;
      if (uri.startsWith('http')) {
        // Name the cache file after the model version so a model swap can't be served a stale
        // download from a previous build.
        const dest = `${FileSystem.cacheDirectory}${MODEL_VERSION}.tflite`;
        await FileSystem.downloadAsync(uri, dest);
        uri = dest;
      }
      return loadTensorflowModel({ url: uri }, []);
    })().catch((e) => {
      modelPromise = null; // allow a retry on the next call
      throw new ClassifierError('model-load', 'failed to load classifier model', e);
    });
  }
  return modelPromise;
}

/** Input size + class count introspected from the loaded model (NHWC [1,H,W,3] → [1,N]). */
export function readClassifierLayout(model: ClassifierModel): {
  inputSize: number;
  numClasses: number;
} {
  const inShape = model.inputs[0]?.shape ?? [];
  let inputSize = FALLBACK_INPUT_SIZE;
  if (inShape.length === 4) {
    // NHWC [1,H,W,3] is what our export uses; tolerate NCHW [1,3,H,W] just in case.
    const size = inShape[3] === 3 ? inShape[1] : inShape[2];
    if (Number.isFinite(size) && size > 0) inputSize = size;
  }
  const outShape = model.outputs[0]?.shape ?? [];
  const numClasses = outShape.reduce((a, b) => a * (b > 0 ? b : 1), 1);
  return { inputSize, numClasses };
}

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

/** How the graph wants its pixels: interleaved [1,H,W,3] or channel-planar [1,3,H,W]. */
export type InputLayout = 'nhwc' | 'nchw';

/**
 * Input size, input layout and class count introspected from the loaded model
 * ([1,H,W,3] or [1,3,H,W] → [1,N]).
 *
 * The layout is READ, not assumed: exports up to D9 are NHWC, the litert-torch D10 export is NCHW,
 * and the two are indistinguishable by byte count — feeding the wrong one is silently wrong rather
 * than an error. model-config's MODEL_INPUT_LAYOUT records what the bundled file is expected to be
 * and prepareModel cross-checks it against this.
 */
export function readClassifierLayout(model: ClassifierModel): {
  inputSize: number;
  layout: InputLayout;
  numClasses: number;
} {
  const inShape = model.inputs[0]?.shape ?? [];
  let inputSize = FALLBACK_INPUT_SIZE;
  let layout: InputLayout = 'nhwc';
  if (inShape.length === 4) {
    // Channels-first is the only reading when dim 1 is 3 and dim 3 is not (a 3×3 input is not a
    // case this model family has, so the ambiguity is theoretical).
    layout = inShape[1] === 3 && inShape[3] !== 3 ? 'nchw' : 'nhwc';
    const size = layout === 'nchw' ? inShape[2] : inShape[1];
    if (Number.isFinite(size) && size > 0) inputSize = size;
  }
  const outShape = model.outputs[0]?.shape ?? [];
  const numClasses = outShape.reduce((a, b) => a * (b > 0 ? b : 1), 1);
  return { inputSize, layout, numClasses };
}

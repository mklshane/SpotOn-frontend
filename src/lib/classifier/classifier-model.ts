import { assetFileUri } from '@/lib/asset-uri';
import { loadTensorflowModel } from '@/lib/tflite';

import { ClassifierError } from './errors';
import { DEMO_BCC_MODEL_ASSET, FALLBACK_INPUT_SIZE, MODEL_ASSET } from './model-config';

/** The loaded TFLite classifier handle (5-class lesion classifier). */
export type ClassifierModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

const modelPromises: { regular: Promise<ClassifierModel> | null; demo: Promise<ClassifierModel> | null } = {
  regular: null,
  demo: null,
};

/**
 * Load the classifier once and cache it (same pattern as lesion-model.ts). `assetFileUri`
 * turns the bundled asset into a URI the native loader can open on every platform and build
 * type - including an Android release build, where the raw asset resolves to a schemeless
 * res/raw identifier that fast-tflite's loader cannot open (see asset-uri.ts). Call early
 * (e.g. on quality-screen mount) to overlap the load with UI time the user is already spending.
 */
export function getClassifierModel(demo = false): Promise<ClassifierModel> {
  const key = demo ? 'demo' : 'regular';
  if (!modelPromises[key]) {
    modelPromises[key] = (async () => {
      const uri = await assetFileUri(demo ? DEMO_BCC_MODEL_ASSET : MODEL_ASSET);
      return loadTensorflowModel({ url: uri }, []);
    })().catch((e) => {
      modelPromises[key] = null; // allow a retry on the next call
      throw new ClassifierError('model-load', 'failed to load classifier model', e);
    });
  }
  return modelPromises[key];
}

/** How the graph wants its pixels: interleaved [1,H,W,3] or channel-planar [1,3,H,W]. */
export type InputLayout = 'nhwc' | 'nchw';

/**
 * Input size, input layout and class count introspected from the loaded model
 * ([1,H,W,3] or [1,3,H,W] → [1,N]).
 *
 * The layout is READ, not assumed: exports up to D9 are NHWC, the litert-torch D10 export is NCHW,
 * and the two are indistinguishable by byte count - feeding the wrong one is silently wrong rather
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

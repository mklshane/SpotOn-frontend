import { assetFileUri } from '@/lib/asset-uri';
import { loadTensorflowModel } from '@/lib/tflite';

import { FACE_ANCHORS, FACE_INPUT } from '@/lib/classifier/face-core';

/**
 * The bundled face detector - MediaPipe BlazeFace short-range (Apache-2.0), 230 KB - used only by
 * the multi-spot picker to tell an eye from a lesion. See classifier/face-core.ts for the contract
 * and why.
 */
export type FaceModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

// Metro resolves non-JS assets through require(); see lesion-model.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/face_detect_short_v1.tflite');

let modelPromise: Promise<FaceModel> | null = null;

export function getFaceModel(): Promise<FaceModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const m = await loadTensorflowModel({ url: await assetFileUri(MODEL_ASSET) }, []);
      const inS = m.inputs[0]?.shape ?? [];
      if (inS.length !== 4 || inS[1] !== FACE_INPUT || inS[2] !== FACE_INPUT || inS[3] !== 3) {
        throw new Error(`face model: unexpected input ${JSON.stringify(inS)}`);
      }
      try {
        await m.run([new Float32Array(FACE_INPUT * FACE_INPUT * 3).buffer as ArrayBuffer]); // first-invoke cost
      } catch {
        // A failed warm-up is not a failed load.
      }
      return m;
    })().catch((e) => {
      modelPromise = null; // allow a retry on the next call
      throw e;
    });
  }
  return modelPromise;
}

/** Start loading ahead of the upload's spot search - fire-and-forget. */
export function prewarmFaceModel(): void {
  getFaceModel().catch(() => {});
}

/** Serializes runs on the one interpreter; see detectorQueue in classifier/lesion-detector.ts. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Raw outputs for a FACE_INPUT-square RGB tensor in [-1, 1]. The two outputs are told apart by
 * length (896 x 16 regressors, 896 logits) rather than by order, which converters do not keep.
 */
export function detectFacesInTensor(
  tensor: Float32Array,
): Promise<{ regressors: Float32Array; logits: Float32Array }> {
  const run = queue.catch(() => {}).then(async () => {
    const model = await getFaceModel();
    const outs = (await model.run([tensor.buffer as ArrayBuffer])).map((o) => new Float32Array(o as ArrayBuffer));
    const regressors = outs.find((o) => o.length === FACE_ANCHORS * 16);
    const logits = outs.find((o) => o.length === FACE_ANCHORS);
    if (!regressors || !logits) throw new Error('face model: unexpected outputs');
    return { regressors, logits };
  });
  queue = run.catch(() => {});
  return run;
}

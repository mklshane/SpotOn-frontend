import { assetFileUri } from '@/lib/asset-uri';
import { loadTensorflowModel } from '@/lib/tflite';

/**
 * The spot verifier - is this crop CENTRED ON A LESION, or on something else (an eye, a nostril, an
 * ear, hair, a skin fold, plain skin)? The multi-spot picker's judge (classifier/candidate-core.ts).
 *
 * WHY. The lesion detector was trained on close-ups that always contain a lesion, so it cannot say
 * no: it confirmed an iris as confidently as a mole, and scored small or flat lesions 0.2-0.5 even
 * when perfectly framed. Hand-made rules (darkness, contrast, hue, size) each failed on the next
 * photo. This model was trained for exactly the picker's question.
 *
 * MobileNetV3-small, trained by SpotOn-synthetic/synth/spot_verifier/ (v3, 2026-10-17): lesion crops
 * from retrain/base_pool/DDI/Fitzpatrick17k/DermaCon/PAD-UFES framed like a picker proposal, against
 * face anatomy (LFW, CelebA-HQ 1024px, Wikimedia Commons ear/nostril/closed-eye close-ups - as the
 * app's own blob scan proposes them) and non-lesion proposals on skin. Held-out photos (ISIC holdout,
 * dataset_real, the picker's online/user test sets) were never trained on.
 *
 * Contract (checked on load): input [1,128,128,3] float32 NHWC RGB 0..1 (normalisation in the graph),
 * output [1,2] softmax: lesion, not_lesion.
 */
export type SpotVerifierModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

export const SPOT_VERIFIER_INPUT = 128;

// Metro resolves non-JS assets through require(); see lesion-model.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/spot_verifier_v1.tflite');

let modelPromise: Promise<SpotVerifierModel> | null = null;

export function getSpotVerifier(): Promise<SpotVerifierModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const m = await loadTensorflowModel({ url: await assetFileUri(MODEL_ASSET) }, []);
      const inS = m.inputs[0]?.shape ?? [];
      const outS = m.outputs[0]?.shape ?? [];
      if (inS[1] !== SPOT_VERIFIER_INPUT || inS[2] !== SPOT_VERIFIER_INPUT || inS[3] !== 3 || outS[outS.length - 1] !== 2) {
        throw new Error(`spot verifier: unexpected shapes in=${JSON.stringify(inS)} out=${JSON.stringify(outS)}`);
      }
      try {
        // Pay TFLite's slow first invoke here, not on the first proposal of a real search.
        await m.run([new Float32Array(SPOT_VERIFIER_INPUT * SPOT_VERIFIER_INPUT * 3).buffer as ArrayBuffer]);
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

/** Start loading ahead of the upload's spot search - fire-and-forget, like prewarmLesionModel. */
export function prewarmSpotVerifier(): void {
  getSpotVerifier().catch(() => {});
}

/** Serializes runs on the one interpreter; see detectorQueue in classifier/lesion-detector.ts. */
let queue: Promise<unknown> = Promise.resolve();

/** P(the crop is centred on a lesion) for a SPOT_VERIFIER_INPUT-square RGB 0..1 tensor. */
export function lesionProbability(tensor: Float32Array): Promise<number> {
  const run = queue.catch(() => {}).then(async () => {
    const model = await getSpotVerifier();
    const [out] = await model.run([tensor.buffer as ArrayBuffer]);
    const p = new Float32Array(out as ArrayBuffer);
    // A malformed output rejects the spot (0): the verifier is the judge, so failing closed is safe.
    return p.length >= 2 && Number.isFinite(p[0]) ? p[0] : 0;
  });
  queue = run.catch(() => {});
  return run;
}

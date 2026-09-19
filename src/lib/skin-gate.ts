import { assetFileUri } from '@/lib/asset-uri';
import { transformToRgba } from '@/lib/image-ops';
import { loadTensorflowModel } from '@/lib/tflite';

/**
 * The learned skin gate: is this still a close-up of skin, not skin at all, or a whole face?
 *
 * WHY A MODEL. Every hand-built term in the still gate answers a narrower question than "is this a
 * photo of a spot on skin", and four rounds of thresholds were each defeated by the next photo
 * (synth/eval/NONSKIN_GATE.md). On 2026-09-19 two more came in on the same day: a defocused
 * red-and-white patterned object and a selfie, both "Looks great". A face is not a threshold problem
 * at all - it IS sharp, well-lit skin with compact dark regions on it, so every term is right about
 * it. Only something that has seen faces can say "move closer".
 *
 * MobileNetV3-small fine-tuned on skin close-ups (SCIN close-ups, PAD-UFES-20, Fitzpatrick17k, DDI,
 * SpotOn's own training pools) vs textures + everyday scenes (DTD, COCO) vs faces (LFW). Trained and
 * exported by SpotOn-synthetic/synth/skin_gate/ - see SKIN_GATE.md there for data, calibration and
 * the held-out numbers. Contract, checked on load in readSkinGateLayout():
 *   input  [1, 160, 160, 3] float32 NHWC, RGB 0..1 (normalisation is inside the graph)
 *   output [1, 3] softmax, in SKIN_CLASSES order
 */
export const SKIN_CLASSES = ['skin', 'not_skin', 'face'] as const;
export type SkinGateProbs = { skin: number; notSkin: number; face: number };

export type SkinGateModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

// Metro resolves non-JS assets through require(); see lesion-model.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/skin_gate_v1.tflite');

let modelPromise: Promise<SkinGateModel> | null = null;

export function getSkinGateModel(): Promise<SkinGateModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const uri = await assetFileUri(MODEL_ASSET);
      const m = await loadTensorflowModel({ url: uri }, []);
      readSkinGateLayout(m); // fail the load, not every photo, if the file is not this contract
      try {
        const s = m.inputs[0].shape;
        await m.run([new Float32Array(s[1] * s[2] * s[3]).buffer as ArrayBuffer]);
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

/** The model's square input side, after checking the file is this contract. */
export function readSkinGateLayout(m: SkinGateModel): number {
  const inS = m.inputs[0]?.shape ?? [];
  const outS = m.outputs[0]?.shape ?? [];
  if (inS.length !== 4 || inS[3] !== 3 || inS[1] !== inS[2] || outS[outS.length - 1] !== SKIN_CLASSES.length) {
    throw new Error(`skin gate: unexpected shapes in=${JSON.stringify(inS)} out=${JSON.stringify(outS)}`);
  }
  return inS[1];
}

/**
 * A SEPARATE interpreter for the live camera loop (capture.tsx), never the cached one above.
 *
 * The camera invokes its model with runSync on VisionCamera's frame-processor thread, and reaching
 * an interpreter from JS while that thread holds it crashes (see lesion-detector.ts). capture.tsx
 * stays mounted under the quality screen, so sharing one instance with classifySkin() would put
 * exactly that race one navigation away. 3.8 MB twice is the cheaper price.
 */
export async function loadSkinGateForCamera(): Promise<SkinGateModel> {
  const m = await loadTensorflowModel({ url: await assetFileUri(MODEL_ASSET) }, []);
  readSkinGateLayout(m);
  return m;
}

/** Start loading ahead of the quality screen - fire-and-forget, like prewarmLesionModel. */
export function prewarmSkinGate(): void {
  getSkinGateModel().catch(() => {});
}

/** Serializes runs on the one cached interpreter; see detectorQueue in lesion-detector.ts. */
let queue: Promise<unknown> = Promise.resolve();

/** Class probabilities for a still (crop.tsx's square 1024² output). Throws if the model can't run. */
export function classifySkin(uri: string): Promise<SkinGateProbs> {
  const run = queue.catch(() => {}).then(() => runSkinGate(uri));
  queue = run.catch(() => {});
  return run;
}

async function runSkinGate(uri: string): Promise<SkinGateProbs> {
  const model = await getSkinGateModel();
  const size = readSkinGateLayout(model);
  // Same resize path as the detector, so web and native feed the model the same pixels.
  const { data } = await transformToRgba(uri, [{ resize: { width: size, height: size } }]);
  const tensor = new Float32Array(size * size * 3);
  for (let i = 0, p = 0; i < tensor.length; i += 3, p += 4) {
    tensor[i] = data[p] / 255;
    tensor[i + 1] = data[p + 1] / 255;
    tensor[i + 2] = data[p + 2] / 255;
  }
  const [out] = await model.run([tensor.buffer as ArrayBuffer]);
  const p = new Float32Array(out as ArrayBuffer);
  return { skin: p[0], notSkin: p[1], face: p[2] };
}

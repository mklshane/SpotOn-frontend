import { pickTopClass } from '../triage/tps-core';
import type { ClassificationOutput, LesionClass } from '../triage/types';
import { getClassifierModel, readClassifierLayout } from './classifier-model';
import { asClassifierError, ClassifierError } from './errors';
import {
  CLASS_ORDER,
  CONFIDENCE_TEMPERATURE,
  INFERENCE_TIMEOUT_MS,
  MODEL_VERSION,
  NORMALIZATION,
  REFINE_CONFIDENCE,
  REFINE_ENABLED,
  REFINE_TARGET_FILL,
  SCALE_CHECK_CROPS,
  SCALE_CHECK_ENABLED,
  TTA_ENABLED,
} from './model-config';
import {
  type CropBox,
  locateLesionInImage,
  preprocessForClassifier,
  ttaViews,
} from './preprocess';

const DEBUG = __DEV__;

/**
 * Numerically stable softmax with temperature scaling (the exported graph ends in a Gemm — raw
 * logits). Dividing by T>1 softens the over-confident logits; it never changes the argmax.
 */
function softmax(logits: number[], temperature = 1): number[] {
  const z = temperature === 1 ? logits : logits.map((l) => l / temperature);
  const max = Math.max(...z);
  const exps = z.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function looksLikeProbabilities(values: number[]): boolean {
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) <= 0.01 && values.every((v) => v >= 0 && v <= 1);
}

/**
 * Run the 5-class lesion classifier on a captured still image.
 *
 * Runs on the JS thread via the async `model.run()` (execution happens off-thread in
 * the native interpreter — never use runSync here). Throws ClassifierError; never
 * returns a fabricated result.
 */
export async function classifyLesion(uri: string, attempt: 1 | 2): Promise<ClassificationOutput> {
  const run = (async () => {
    const model = await getClassifierModel();
    const { inputSize, numClasses } = readClassifierLayout(model);
    if (numClasses !== CLASS_ORDER.length) {
      throw new ClassifierError(
        'invalid-output',
        `model reports ${numClasses} classes, expected ${CLASS_ORDER.length}`,
      );
    }

    /** One full prediction at a given crop: preprocess → TTA → averaged softmax. */
    const predictAt = async (cropFraction: number, cropBox?: CropBox) => {
      const input = await preprocessForClassifier(
        uri,
        inputSize,
        NORMALIZATION,
        cropFraction,
        cropBox,
      );
      // 4-view dihedral TTA (the configuration D4's operating point was selected under), or a
      // single pass when disabled. Views run sequentially so only one buffer is live at a time.
      const views = TTA_ENABLED ? ttaViews(input, inputSize) : [input];
      let logitSum: Float64Array | null = null;
      try {
        for (const view of views) {
          // fast-tflite wants the raw ArrayBuffer, not the TypedArray view — same slice the
          // proven detector path uses (capture.tsx runSync).
          const buffer = view.buffer.slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
          ) as ArrayBuffer;
          const outputs = await model.run([buffer]);
          const out = new Float32Array(outputs?.[0] ?? new ArrayBuffer(0));
          if (out.length !== CLASS_ORDER.length) {
            throw new ClassifierError('invalid-output', `bad output tensor (${out.length} values)`);
          }
          logitSum ??= new Float64Array(out.length);
          for (let i = 0; i < out.length; i++) logitSum[i] += out[i];
        }
      } catch (e) {
        throw asClassifierError(e, 'inference');
      }

      // Averaging in logit space is what the threshold was calibrated on — never average softmaxes.
      const values = Array.from(logitSum ?? []).map((v) => v / views.length);
      if (values.length !== CLASS_ORDER.length || values.some((v) => !Number.isFinite(v))) {
        throw new ClassifierError('invalid-output', `bad output tensor (${values.length} values)`);
      }
      // Tolerate a future export that bakes softmax in; otherwise apply calibrated softmax here.
      const p = looksLikeProbabilities(values) ? values : softmax(values, CONFIDENCE_TEMPERATURE);
      const byClass = {} as Record<LesionClass, number>;
      CLASS_ORDER.forEach((cls, i) => {
        byClass[cls] = p[i];
      });
      return { probs: byClass, ...pickTopClass(byClass), views: views.length };
    };

    const started = Date.now();
    // The full-frame prediction. Its probabilities are the result unless the zoom refinement below
    // adopts a better-framed one.
    let result = await predictAt(1);
    const fullFrame = result;

    // Confidence-gated zoom refinement: a low-confidence full-frame call is usually a lesion framed
    // too wide (out of distribution — training only ever crops in). Locate the lesion, crop to it,
    // and re-classify; adopt the zoomed prediction. Only fires below the gate, so a confident
    // (well-framed) prediction is never disturbed. See model-config.ts for the validation.
    let refined = false;
    if (REFINE_ENABLED && result.topConfidence < REFINE_CONFIDENCE) {
      const box = await locateLesionInImage(uri, { targetFill: REFINE_TARGET_FILL });
      if (box) {
        const zoomed = await predictAt(1, box);
        // Adopt only when the zoom is MORE confident than the full frame. Measured on
        // SpotOn-synthetic/retrain (972 images): adopting unconditionally gives +2.7 pts but
        // corrupts 65 previously-correct images; requiring a confidence gain gives +3.8 pts and
        // nearly halves that to 36. A zoom that lowers confidence is evidence the crop was wrong
        // (mislocated lesion), so keeping the original is the safer read.
        if (zoomed.topConfidence > result.topConfidence) {
          result = zoomed;
          refined = true;
        }
      }
    }
    const probsByClass = result.probs;
    const { topClass, topConfidence } = result;

    // Optional scale-consistency backstop (default off — superseded by the refinement above).
    // A class that changes across center-crops is driven by framing, not the lesion; when enabled
    // this routes such cases to the rescan path (analysis.tsx), never treating them as risk.
    let scaleUnstable = false;
    if (SCALE_CHECK_ENABLED) {
      for (const fraction of SCALE_CHECK_CROPS.slice(1)) {
        const alt = await predictAt(fraction);
        if (alt.topClass !== topClass) scaleUnstable = true;
      }
    }
    const inferenceMs = Date.now() - started;

    if (DEBUG) {
      console.log(
        '[classifier]',
        `attempt=${attempt}`,
        `top=${topClass}@${topConfidence.toFixed(3)}`,
        CLASS_ORDER.map((c) => `${c}=${probsByClass[c].toFixed(3)}`).join(' '),
        `${inferenceMs}ms @${inputSize}px ×${result.views}view`,
        refined ? `refined(from ${fullFrame.topClass}@${fullFrame.topConfidence.toFixed(2)})` : '',
        SCALE_CHECK_ENABLED && scaleUnstable ? 'scaleUNSTABLE' : '',
      );
    }

    return {
      probs: probsByClass,
      topClass,
      topConfidence,
      attempt,
      modelVersion: MODEL_VERSION,
      inputSize,
      normalization: NORMALIZATION,
      temperature: CONFIDENCE_TEMPERATURE,
      inferenceMs,
      scaleUnstable,
      refined,
    } satisfies ClassificationOutput;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ClassifierError('timeout', `inference exceeded ${INFERENCE_TIMEOUT_MS}ms`)),
      INFERENCE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
    // Keep a late rejection from surfacing as an unhandled promise after a timeout won the race.
    run.catch(() => {});
  }
}

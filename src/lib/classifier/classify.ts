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
} from './model-config';
import { preprocessForClassifier } from './preprocess';

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

    const input = await preprocessForClassifier(uri, inputSize, NORMALIZATION);

    const started = Date.now();
    let outputs: ArrayBuffer[];
    try {
      // fast-tflite wants the raw ArrayBuffer, not the TypedArray view — same slice the
      // proven detector path uses (capture.tsx runSync).
      const buffer = input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ) as ArrayBuffer;
      outputs = await model.run([buffer]);
    } catch (e) {
      throw asClassifierError(e, 'inference');
    }
    const inferenceMs = Date.now() - started;

    const values = Array.from(new Float32Array(outputs?.[0] ?? new ArrayBuffer(0))).map(Number);
    if (values.length !== CLASS_ORDER.length || values.some((v) => !Number.isFinite(v))) {
      throw new ClassifierError('invalid-output', `bad output tensor (${values.length} values)`);
    }
    // Tolerate a future export that bakes softmax in; otherwise apply calibrated softmax here.
    const probs = looksLikeProbabilities(values) ? values : softmax(values, CONFIDENCE_TEMPERATURE);

    const probsByClass = {} as Record<LesionClass, number>;
    CLASS_ORDER.forEach((cls, i) => {
      probsByClass[cls] = probs[i];
    });
    const { topClass, topConfidence } = pickTopClass(probsByClass);

    if (DEBUG) {
      console.log(
        '[classifier]',
        `attempt=${attempt}`,
        `top=${topClass}@${topConfidence.toFixed(3)}`,
        CLASS_ORDER.map((c) => `${c}=${probsByClass[c].toFixed(3)}`).join(' '),
        `${inferenceMs}ms @${inputSize}px`,
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

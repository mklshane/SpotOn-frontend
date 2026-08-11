import { pickTopClass } from '../triage/tps-core';
import {
  detectDisagreementAmong,
  looksLikeProbabilities,
  meanLogits as meanLogitsCore,
  softmaxT,
  toLogitSpace,
} from './aggregate-core';
import type { ClassificationOutput, LesionClass, PerImageResult } from '../triage/types';
import {
  type ClassifierModel,
  getClassifierModel,
  readClassifierLayout,
} from './classifier-model';
import { asClassifierError, ClassifierError } from './errors';
import {
  CLASS_ORDER,
  CONFIDENCE_TEMPERATURE,
  IMAGE_AGREEMENT_MIN_CONFIDENCE,
  INFERENCE_TIMEOUT_MS,
  DETECTOR_CROP_ENABLED,
  MULTI_IMAGE_AGGREGATION_ENABLED,
  MODEL_OUTPUTS_PROBABILITIES,
  MODEL_VERSION,
  NORMALIZATION,
  REFINE_CONFIDENCE,
  REFINE_ENABLED,
  REFINE_TARGET_FILL,
  SCALE_CHECK_CROPS,
  SCALE_CHECK_ENABLED,
  TTA_ENABLED,
} from './model-config';
import { detectLesionBox, lesionBoxToCrop } from './lesion-detector';
import {
  type CropBox,
  locateLesionInImage,
  preprocessForClassifier,
  ttaViews,
} from './preprocess';

const DEBUG = __DEV__;

// The pure arithmetic lives in aggregate-core.ts so scripts/test-multiview.mjs can pin it without
// a device (this file require()s the bundled .tflite and cannot be compiled standalone).
const softmax = softmaxT;

/**
 * One prediction at one crop: the TTA-averaged model output plus everything derived from it.
 *
 * `logits` is the mean of the per-view logits — the space MALIGNANT_THRESHOLD and
 * CONFIDENCE_TEMPERATURE were calibrated in (see model-config.ts). It is carried here so that
 * pooling *across images* can happen in that same space; averaging softmaxes instead would
 * silently invalidate the calibrated operating point. Nothing on the single-image path reads it.
 *
 * For a softmax-baked export (MODEL_OUTPUTS_PROBABILITIES, i.e. D8) these are log-probabilities,
 * which are the true logits up to a per-view additive constant. Softmax, temperature and pooling
 * are all invariant to a class-independent shift, so every consumer behaves identically — but the
 * absolute values are not comparable against records written by a raw-logit export like D7.
 */
export type Prediction = {
  logits: number[];
  probs: Record<LesionClass, number>;
  topClass: LesionClass;
  topConfidence: number;
  views: number;
  /** True when the graph already emitted probabilities (a future softmax-baked export). */
  probsFromModel: boolean;
};

/** Everything one image's pipeline produces, before it is shaped into a ClassificationOutput. */
export type SingleImageResult = {
  prediction: Prediction;
  detectorUsed: boolean;
  refined: boolean;
  scaleUnstable: boolean;
  inferenceMs: number;
  /** The full-frame prediction the DoG zoom replaced, when it did. Dev logging only. */
  fullFrame: Prediction | null;
};

export type LoadedModel = { model: ClassifierModel; inputSize: number };

/** Load the interpreter and verify the graph matches the class contract. */
export async function prepareModel(): Promise<LoadedModel> {
  const model = await getClassifierModel();
  const { inputSize, numClasses } = readClassifierLayout(model);
  if (numClasses !== CLASS_ORDER.length) {
    throw new ClassifierError(
      'invalid-output',
      `model reports ${numClasses} classes, expected ${CLASS_ORDER.length}`,
    );
  }
  return { model, inputSize };
}

/**
 * Run the full per-image pipeline on one still: detector-canonical crop, or the full frame plus a
 * confidence-gated zoom refinement. Crop selection compares softmax confidence exactly as before —
 * the added `logits` on each Prediction is inert here.
 *
 * Callers own the timeout race and the ClassificationOutput shaping.
 */
export async function classifyOne(
  uri: string,
  model: ClassifierModel,
  inputSize: number,
): Promise<SingleImageResult> {
  /** One full prediction at a given crop: preprocess → TTA → averaged logits → softmax. */
  const predictAt = async (cropFraction: number, cropBox?: CropBox): Promise<Prediction> => {
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
        // Fail loudly when the bundled graph disagrees with MODEL_OUTPUTS_PROBABILITIES. Getting
        // this wrong is silent — top-1 survives either way — so it has to be checked, not assumed.
        const raw = Array.from(out);
        if (looksLikeProbabilities(raw) !== MODEL_OUTPUTS_PROBABILITIES) {
          throw new ClassifierError(
            'invalid-output',
            `model output is ${MODEL_OUTPUTS_PROBABILITIES ? 'not ' : ''}a probability vector, ` +
              `but MODEL_OUTPUTS_PROBABILITIES is ${MODEL_OUTPUTS_PROBABILITIES}`,
          );
        }
        // Convert BEFORE accumulating. A softmax-baked export (D8) must be pulled back into log
        // space here, or this loop would average probabilities — a different estimator that
        // compresses confidence and rescales the malignant score against a threshold fitted on
        // logit-mean output. See aggregate-core `toLogitSpace` for why the log makes it exact.
        const viewLogits = MODEL_OUTPUTS_PROBABILITIES ? toLogitSpace(raw) : raw;
        logitSum ??= new Float64Array(viewLogits.length);
        for (let i = 0; i < viewLogits.length; i++) logitSum[i] += viewLogits[i];
      }
    } catch (e) {
      throw asClassifierError(e, 'inference');
    }

    // Averaging in logit space is what the threshold was calibrated on — never average softmaxes.
    const values = Array.from(logitSum ?? []).map((v) => v / views.length);
    if (values.length !== CLASS_ORDER.length || values.some((v) => !Number.isFinite(v))) {
      throw new ClassifierError('invalid-output', `bad output tensor (${values.length} values)`);
    }
    // `values` is logit space for every export, so the calibrated softmax always applies — which is
    // what keeps CONFIDENCE_TEMPERATURE live on a probability-emitting graph.
    const p = softmax(values, CONFIDENCE_TEMPERATURE);
    const byClass = {} as Record<LesionClass, number>;
    CLASS_ORDER.forEach((cls, i) => {
      byClass[cls] = p[i];
    });
    return {
      logits: values,
      probs: byClass,
      ...pickTopClass(byClass),
      views: views.length,
      probsFromModel: MODEL_OUTPUTS_PROBABILITIES,
    };
  };

  const started = Date.now();

  // 1) Detector-canonical crop (primary). Run the YOLO detector, re-crop to the training geometry,
  // and classify that. This removes the user's framing from the input, so the answer depends on
  // the lesion, not the zoom — and reproduces the crop the model was trained on. See model-config.
  let result: Prediction | null = null;
  let detectorUsed = false;
  if (DETECTOR_CROP_ENABLED) {
    const detBox = await detectLesionBox(uri).catch((e) => {
      if (DEBUG) console.warn('[classifier] detector failed', e);
      return null;
    });
    if (detBox) {
      result = await predictAt(1, lesionBoxToCrop(detBox));
      detectorUsed = true;
    }
  }

  // 2) Fallback for images the detector can't localize: the full frame, then the confidence-gated
  // DoG zoom refinement (a low-confidence full-frame call is usually a lesion framed too wide).
  let refined = false;
  let fullFrame: Prediction | null = null;
  if (!result) {
    result = await predictAt(1);
    fullFrame = result;
    if (REFINE_ENABLED && result.topConfidence < REFINE_CONFIDENCE) {
      const box = await locateLesionInImage(uri, { targetFill: REFINE_TARGET_FILL });
      if (box) {
        const zoomed = await predictAt(1, box);
        // Adopt only when the zoom is MORE confident than the full frame. Measured on
        // SpotOn-synthetic/retrain (972 images): adopting unconditionally gives +2.7 pts but
        // corrupts 65 previously-correct images; requiring a confidence gain gives +3.8 pts and
        // nearly halves that to 36. A zoom that lowers confidence is evidence the crop was wrong.
        if (zoomed.topConfidence > result.topConfidence) {
          result = zoomed;
          refined = true;
        }
      }
    }
  }

  // Optional scale-consistency backstop (default off — superseded by the refinement above).
  // A class that changes across center-crops is driven by framing, not the lesion; when enabled
  // this routes such cases to the rescan path (analysis.tsx), never treating them as risk.
  let scaleUnstable = false;
  if (SCALE_CHECK_ENABLED) {
    for (const fraction of SCALE_CHECK_CROPS.slice(1)) {
      const alt = await predictAt(fraction);
      if (alt.topClass !== result.topClass) scaleUnstable = true;
    }
  }

  return {
    prediction: result,
    detectorUsed,
    refined,
    scaleUnstable,
    inferenceMs: Date.now() - started,
    fullFrame: refined ? fullFrame : null,
  };
}

/** Dev diagnostic for one image's pipeline. */
function logImageResult(r: SingleImageResult, inputSize: number, prefix: string) {
  const { probs, topClass, topConfidence, views } = r.prediction;
  console.log(
    '[classifier]',
    prefix,
    `top=${topClass}@${topConfidence.toFixed(3)}`,
    CLASS_ORDER.map((c) => `${c}=${probs[c].toFixed(3)}`).join(' '),
    `${r.inferenceMs}ms @${inputSize}px ×${views}view`,
    r.detectorUsed ? 'crop=detector' : 'crop=fullframe',
    r.refined && r.fullFrame
      ? `refined(from ${r.fullFrame.topClass}@${r.fullFrame.topConfidence.toFixed(2)})`
      : '',
    SCALE_CHECK_ENABLED && r.scaleUnstable ? 'scaleUNSTABLE' : '',
  );
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
    const { model, inputSize } = await prepareModel();
    const r = await classifyOne(uri, model, inputSize);

    if (DEBUG) logImageResult(r, inputSize, `attempt=${attempt}`);

    return {
      probs: r.prediction.probs,
      topClass: r.prediction.topClass,
      topConfidence: r.prediction.topConfidence,
      attempt,
      modelVersion: MODEL_VERSION,
      inputSize,
      normalization: NORMALIZATION,
      temperature: CONFIDENCE_TEMPERATURE,
      inferenceMs: r.inferenceMs,
      scaleUnstable: r.scaleUnstable,
      refined: r.refined,
      detectorUsed: r.detectorUsed,
    } satisfies ClassificationOutput;
  })();

  return withTimeout(run, INFERENCE_TIMEOUT_MS);
}

/** Race a run against a ClassifierError('timeout'), without leaking an unhandled late rejection. */
async function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ClassifierError('timeout', `inference exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
    // Keep a late rejection from surfacing as an unhandled promise after a timeout won the race.
    run.catch(() => {});
  }
}

/** True when confident per-image predictions disagree. Near-ties are the Safety Floor's job. */
export function detectDisagreement(results: readonly PerImageResult[]): boolean {
  return detectDisagreementAmong(results, IMAGE_AGREEMENT_MIN_CONFIDENCE);
}

/**
 * Classify 1–3 photos of the SAME lesion into one ClassificationOutput.
 *
 * POOLING IS A UNIFORM MEAN OF THE PER-IMAGE LOGIT VECTORS, then a single softmax — arithmetically
 * the same operation the 4-view dihedral TTA above already performs, so an N-image run is a
 * 4N-view logit average. Averaging softmaxes instead would compress confidence toward 1/K and
 * rescale the malignant score against a threshold fitted on logit-mean output.
 *
 * Whether pooling happens at all is MULTI_IMAGE_AGGREGATION_ENABLED, which ships FALSE on measured
 * evidence (see model-config and synth/eval/MULTIVIEW_EVAL.md). With it off, every image is still
 * classified and recorded in `perImage`, but the reported result is the primary image's — bit-identical
 * to the single-photo path, so the shipped operating point is untouched.
 *
 * Images run SEQUENTIALLY, never in parallel: there is one native interpreter, so concurrent runs
 * would serialize anyway while tripling peak memory.
 */
export async function classifyLesionSet(
  uris: readonly string[],
  attempt: 1 | 2,
  opts?: { onImageDone?: (r: PerImageResult) => void },
): Promise<ClassificationOutput> {
  if (uris.length === 0) throw new ClassifierError('preprocess', 'no images to classify');
  const { model, inputSize } = await prepareModel();
  const parts: SetPart[] = [];
  for (let index = 0; index < uris.length; index++) {
    const part = await classifyImageAt(uris[index], index, model, inputSize, attempt, uris.length);
    parts.push(part);
    opts?.onImageDone?.(part.entry);
  }
  return composeSetResult(parts, attempt, inputSize);
}

/** One image's contribution to a set: the audit record plus the raw result, when it succeeded. */
export type SetPart = { entry: PerImageResult; result: SingleImageResult | null; error?: unknown };

/**
 * Classify one image of a set, converting a failure into an excluded `PerImageResult` rather than
 * throwing. One bad photo must not cost the user the whole screening.
 */
export async function classifyImageAt(
  uri: string,
  index: number,
  model: ClassifierModel,
  inputSize: number,
  attempt: 1 | 2,
  total = 1,
): Promise<SetPart> {
  try {
    const r = await withTimeout(classifyOne(uri, model, inputSize), INFERENCE_TIMEOUT_MS);
    if (DEBUG) logImageResult(r, inputSize, `attempt=${attempt} image=${index + 1}/${total}`);
    return {
      result: r,
      entry: {
        index,
        uri,
        logits: r.prediction.logits,
        probs: r.prediction.probs,
        topClass: r.prediction.topClass,
        topConfidence: r.prediction.topConfidence,
        detectorUsed: r.detectorUsed,
        refined: r.refined,
        inferenceMs: r.inferenceMs,
      },
    };
  } catch (e) {
    const kind = (e as { kind?: string })?.kind ?? 'inference';
    if (DEBUG) console.warn(`[classifier] image ${index} excluded (${kind})`, e);
    return {
      result: null,
      error: e,
      entry: {
        index,
        uri,
        logits: null,
        probs: null,
        topClass: null,
        topConfidence: null,
        detectorUsed: false,
        refined: false,
        inferenceMs: 0,
        excludedReason: kind,
      },
    };
  }
}

/**
 * Fold per-image results into one ClassificationOutput.
 *
 * With MULTI_IMAGE_AGGREGATION_ENABLED off (the shipped default) the reported result is the primary
 * image's, bit-identical to the single-photo path — the other images are still classified and kept
 * in `perImage` for the audit trail and for a future refit. Throws only when EVERY image failed, so
 * analysis.tsx's error state behaves exactly as before.
 */
export function composeSetResult(
  parts: readonly SetPart[],
  attempt: 1 | 2,
  inputSize: number,
): ClassificationOutput {
  const ordered = [...parts].sort((a, b) => a.entry.index - b.entry.index);
  const perImage = ordered.map((p) => p.entry);
  const usable = ordered.filter((p) => p.result).map((p) => p.result!);
  if (usable.length === 0) {
    throw asClassifierError(ordered.find((p) => p.error)?.error, 'inference');
  }

  const shouldPool = MULTI_IMAGE_AGGREGATION_ENABLED && usable.length > 1;
  let probs: Record<LesionClass, number>;
  let topClass: LesionClass;
  let topConfidence: number;
  if (shouldPool) {
    const values = meanLogitsCore(usable.map((r) => r.prediction.logits));
    // Per-image `logits` are always logit space (a softmax-baked export was converted per view in
    // predictAt), so the calibrated softmax applies uniformly here too.
    const p = softmax(values, CONFIDENCE_TEMPERATURE);
    probs = {} as Record<LesionClass, number>;
    CLASS_ORDER.forEach((cls, i) => {
      probs[cls] = p[i];
    });
    ({ topClass, topConfidence } = pickTopClass(probs));
  } else {
    const primary = usable[0].prediction; // the first image that classified successfully
    probs = primary.probs;
    topClass = primary.topClass;
    topConfidence = primary.topConfidence;
  }

  return {
    probs,
    topClass,
    topConfidence,
    attempt,
    modelVersion: MODEL_VERSION,
    inputSize,
    normalization: NORMALIZATION,
    temperature: CONFIDENCE_TEMPERATURE,
    inferenceMs: usable.reduce((sum, r) => sum + r.inferenceMs, 0),
    // Only the images that actually produced the answer may set these flags.
    scaleUnstable: shouldPool ? usable.some((r) => r.scaleUnstable) : usable[0].scaleUnstable,
    refined: shouldPool ? usable.some((r) => r.refined) : usable[0].refined,
    // D7's validated numbers hold only at detector geometry, so ALL is the honest reading.
    detectorUsed: shouldPool ? usable.every((r) => r.detectorUsed) : usable[0].detectorUsed,
    imageCount: shouldPool ? usable.length : 1,
    aggregate: shouldPool ? 'logit-mean' : 'single',
    perImage,
    imageDisagreement: detectDisagreement(perImage),
  } satisfies ClassificationOutput;
}

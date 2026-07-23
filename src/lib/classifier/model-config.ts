import type { LesionClass } from '../triage/types';

/**
 * Single source of truth for the deployed classifier. Swapping in a new model export
 * (e.g. a float16/INT8 re-export, or a retrained version) should only require changes
 * in this file.
 *
 * Verified against the bundled spoton_classifier_D4_float32.tflite (litert interpreter, 2026-07-23):
 *   input  "input"  [1, 260, 260, 3] float32 NHWC  (EfficientNet-B2)
 *   output "logits" [1, 5]           float32       (Gemm head — NO softmax in the graph;
 *                                                   classify.ts applies softmax on-device)
 */

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
// D4 (2026-07-23): retrained on the hard-benign/confident-error set (see
// SpotOn-synthetic/retrain_hard_benign/WHY_CONFIDENT_ERRORS.md). Same B2 backbone and I/O layout
// as D3, but the saturated-logit defect is largely gone — it no longer needs a temperature
// band-aid. Use float32 — the float16 export can't run (TFLite CONV_2D rejects float16 input).
export const MODEL_ASSET = require('../../../assets/models/spoton_classifier_D4_float32.tflite');

/** Recorded on every ScreeningRecord so historical results stay interpretable. */
export const MODEL_VERSION = 'spoton_classifier_D4_float32';

/**
 * Index → class mapping of the output logits. The training pipeline used
 * torchvision/timm ImageFolder conventions, i.e. alphabetical by folder name
 * (confirmed by the model owner, 2026-07-14).
 */
export const CLASS_ORDER: readonly LesionClass[] = ['BCC', 'BENIGN', 'MEL', 'OTHER', 'SCC'];

/**
 * The three malignant classes live in tps-core.ts (MALIGNANT_CLASSES) alongside the gate that
 * consumes them, re-exported here so the classifier's model card reads as one document.
 */
export { MALIGNANT_CLASSES } from '../triage/tps-core';

/**
 * Decision threshold on the malignant score (BCC+MEL+SCC softmax sum), consumed by the Malignant
 * Gate in tps-core.ts (`evaluateMalignantGate`), which floors the tier at Moderate when it fires.
 *
 * DERIVED, not supplied. The model owner's two operating points (0.3454 "90%-sensitivity" and
 * 0.6173 "F1-optimal") do not reproduce those labels on our held-out set — 0.3454 measures 77.8%
 * sensitivity here, and F1 actually peaks at 0.28, not 0.6173. Whatever set they were selected on,
 * it is not this one, so the value below is re-derived from the sensitivity/specificity curve on
 * `dataset_real` (94 images, D4 + 4-view TTA, T=1.0) via
 * `SpotOn-synthetic` → rederive_threshold.py, 2026-07-24.
 *
 * 0.28 is where three independent selection rules converge — Youden's J, F1, and the
 * 80%-sensitivity point all land on 0.2801 — which is a stronger signal than any single rule at
 * this sample size. Measured there: sens 80.6% / spec 87.9%, 7 of 36 malignancies missed.
 *
 * End-to-end (all-"no" questionnaire), the gate takes malignancies under-triaged as `low` from
 * 18/36 down to 7/36, at a cost of 4 of 58 benign lesions floored to Moderate. Against the
 * previously shipped 0.3454 that is one more malignancy rescued for two more benign lesions
 * flagged — worth taking when the flag means "worth having checked", not "urgent".
 *
 * Note 0.28 rather than the exact 0.2801 optimum: a benign lesion scores 0.2801, so the optimum is
 * literally defined by one data point. Rounding down costs that one lesion and keeps the value
 * honest about its own precision.
 *
 * WHY NOT LOWER. Chasing 90% sensitivity would put the threshold at 0.093 (spec 63.8%). Two
 * reasons not to: the out-of-bag bootstrap below shows that point does not hold up, and
 * `dataset_real` is 38% malignant while a real screening population is a few percent — at low
 * prevalence, specificity dominates the false-alarm count, so 0.093 would roughly triple
 * escalations to catch a handful more cancers, and a Moderate tier that fires on a third of
 * benign lesions stops carrying information.
 *
 * PRECISION WARNING — 2000-resample out-of-bag bootstrap (pick the threshold on a resample, score
 * it on the held-out remainder): the Youden-rule threshold has a 90% range of [0.164, 0.623], and
 * out-of-bag sensitivity averages 78.0% ±13.0 against 80.6% in-sample. n=94 (36 malignant, only 6
 * SCC) cannot pin this down more finely than "high 0.2s". Treat 0.28 as the centre of a broad
 * plateau, not a precise value, and do not re-tune it on this set — the next real improvement is
 * more held-out data, especially SCC.
 *
 * COUPLED TO CONFIDENCE_TEMPERATURE: the score is a sum of *post-temperature* softmax values, so
 * changing T rescales it. Refit this threshold whenever either T or the bundled model changes.
 */
export const MALIGNANT_THRESHOLD = 0.28;

export type Normalization = 'zeroOne' | 'imagenet' | 'plusMinusOne';

/**
 * ImageNet mean/std (timm default). Verified empirically 2026-07-14 against 94 real
 * dataset_real images: under x/255 the model collapses ~everything to BENIGN (~24%
 * top-1); under ImageNet normalization it works — 56% top-1 with a clean diagonal
 * (BCC 86%, BENIGN 81%, MEL 56%) and the alphabetical class order aligns exactly.
 */
export const NORMALIZATION: Normalization = 'imagenet';

/** ImageNet stats, used only when NORMALIZATION === 'imagenet'. */
export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/** Used when the model reports a dynamic input shape; the real value is introspected. */
export const FALLBACK_INPUT_SIZE = 260;

/** Hard ceiling well inside the 30 s NFR; a hung interpreter surfaces as a 'timeout' error. */
export const INFERENCE_TIMEOUT_MS = 20_000;

/**
 * Post-hoc temperature scaling applied to the logits before softmax (classify.ts).
 * Dividing logits by T leaves the predicted class unchanged (accuracy identical) but makes the
 * confidence honest so the <40% Safety Floor and Triage Priority Score behave correctly.
 *
 * COUPLED TO THE BUNDLED MODEL FILE — refit whenever the bundled .tflite changes.
 * D4 ships calibrated (label smoothing during retraining), so no post-hoc rescaling is applied —
 * the model owner specifies T = 1.0 and the old D3 band-aid of 5.289 is dropped. Confirmed on
 * `dataset_real` at T=1.0: ECE 0.46 (D3) → 0.26 (D4), mean confidence 94% → 78% at 51% accuracy.
 * Still over-confident, but within the range the Safety Floor was designed for.
 */
export const CONFIDENCE_TEMPERATURE = 1.0;

/**
 * Test-time augmentation: run the 4 dihedral flips (original, h-flip, v-flip, both) and average
 * the raw logits before softmax. This is the configuration MALIGNANT_THRESHOLD was selected under,
 * so the two must move together. Costs 4× inference (still well inside INFERENCE_TIMEOUT_MS).
 * Set to false to fall back to a single forward pass.
 */
export const TTA_ENABLED = true;

/**
 * Optional pixel-domain steps applied between JPEG decode and tensor packing
 * (e.g. a CLAHE pass if training/inference parity ever demands it). Empty by design.
 */
export type PreprocessStep = (img: {
  data: Uint8Array;
  width: number;
  height: number;
}) => { data: Uint8Array; width: number; height: number };

export const PREPROCESS_STEPS: readonly PreprocessStep[] = [];

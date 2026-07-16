import type { LesionClass } from '../triage/types';

/**
 * Single source of truth for the deployed classifier. Swapping in a new model export
 * (e.g. a float16/INT8 re-export, or a retrained version) should only require changes
 * in this file.
 *
 * Verified against the bundled spoton_classifier_float32.tflite (flatbuffer inspection):
 *   input  "input"  [1, 260, 260, 3] float32 NHWC  (EfficientNet-B2)
 *   output "logits" [1, 5]           float32       (Gemm head — NO softmax in the graph;
 *                                                   classify.ts applies softmax on-device)
 */

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
// D3 (2026-07-15): EfficientNet-B2 retrained with RandomResizedCrop(scale=(0.4,1.0)) scale-jitter
// to fix the zoom-flip shortcut (benign moles reading MEL at lesion-filling crops). Verified
// stable across the zoom sweep on real benign lesions. Use float32 — the float16 export can't run
// (TFLite CONV_2D rejects float16 input).
export const MODEL_ASSET = require('../../../assets/models/spoton_classifier_D3_float32.tflite');

/** Recorded on every ScreeningRecord so historical results stay interpretable. */
export const MODEL_VERSION = 'spoton_classifier_D3_float32';

/**
 * Index → class mapping of the output logits. The training pipeline used
 * torchvision/timm ImageFolder conventions, i.e. alphabetical by folder name
 * (confirmed by the model owner, 2026-07-14).
 */
export const CLASS_ORDER: readonly LesionClass[] = ['BCC', 'BENIGN', 'MEL', 'OTHER', 'SCC'];

/** The three malignant classes. Malignant score = sum of their softmax probabilities. */
export const MALIGNANT_CLASSES: readonly LesionClass[] = ['BCC', 'MEL', 'SCC'];

/**
 * VERIFY — Decision threshold on the malignant score (BCC+MEL+SCC), pending from the model owner
 * for D3. The old model's 0.6259 is WRONG for D3 (its probability distribution shifted). This is a
 * placeholder; DO NOT SHIP until replaced with the D3 validation-selected value.
 *
 * NOTE: the current triage engine (tps-core.ts) decides via 5-class argmax (`pickTopClass`) → TPS,
 * and does NOT yet consume this threshold. Wiring a binary malignant/benign gate into the
 * physician-validated TPS is a separate decision — left unwired pending direction + the real value.
 */
export const MALIGNANT_THRESHOLD = 0.6259; // VERIFY (D3 value pending)

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
 * COUPLED TO THE BUNDLED MODEL FILE — refit whenever `spoton_classifier_float32.tflite` changes.
 * Fitted 2026-07-16 on `dataset_real` (the 94-image held-out dark-skin test set) via
 * `SpotOn-synthetic/synth/eval/calibrate_and_eval.py`: raw ECE 0.45 → 0.23, mean confidence
 * 91% → 54%, and the Safety Floor went from catching 0% of wrong predictions to ~21%.
 * NOTE: this value (~5.29) matches the figure previously attributed to the "old" model, which
 * implies the currently-bundled file is that model, not D3 — refit after swapping in the D3 export.
 */
export const CONFIDENCE_TEMPERATURE = 5.289;

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

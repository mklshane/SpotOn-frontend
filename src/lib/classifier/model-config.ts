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
export const MODEL_ASSET = require('../../../assets/models/spoton_classifier_float32.tflite');

/** Recorded on every ScreeningRecord so historical results stay interpretable. */
export const MODEL_VERSION = 'spoton_classifier_float32';

/**
 * Index → class mapping of the output logits. The training pipeline used
 * torchvision/timm ImageFolder conventions, i.e. alphabetical by folder name
 * (confirmed by the model owner, 2026-07-14).
 */
export const CLASS_ORDER: readonly LesionClass[] = ['BCC', 'BENIGN', 'MEL', 'OTHER', 'SCC'];

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
 * Optional pixel-domain steps applied between JPEG decode and tensor packing
 * (e.g. a CLAHE pass if training/inference parity ever demands it). Empty by design.
 */
export type PreprocessStep = (img: {
  data: Uint8Array;
  width: number;
  height: number;
}) => { data: Uint8Array; width: number; height: number };

export const PREPROCESS_STEPS: readonly PreprocessStep[] = [];

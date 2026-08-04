import type { LesionClass } from '../triage/types';

/**
 * Single source of truth for the deployed classifier. Swapping in a new model export
 * (e.g. a float16/INT8 re-export, or a retrained version) should only require changes
 * in this file.
 *
 * Verified against the bundled spoton_classifier_D7_float32.tflite (flatbuffer inspection,
 * 2026-07-30) — byte-for-byte the same graph shape as the D3/D4 exports (686 tensors,
 * 397 operators, `onnx2tf flatbuffer_direct`), so the swap is drop-in:
 *   input  "input"  [1, 260, 260, 3] float32 NHWC  (EfficientNet-B2)
 *   output "logits" [1, 5]           float32       (Gemm head — NO softmax in the graph;
 *                                                   classify.ts applies softmax on-device)
 */

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
// D7 (2026-07-30, `D7_zoomout_mm.pt` → SpotOn_D7_export_threshold_temperature.ipynb): the
// scale-INVARIANT retrain. D4's core defect is that its augmentation (`RandomResizedCrop`) can only
// crop *in*, so a lesion that fills a small part of the frame is out of distribution and the class
// flips with framing (~57% flip-rate across zoom levels). D7 adds
// `RandomZoomOut(padding_mode="edge")` *before* the crop — zooming out into real skin tone rather
// than the solid-colour fill that made the D5 attempt a shortcut — over loose base crops (~0.36
// fill) so there is margin to zoom into, and adds OHSU MoleMapper benign nevi train-only (capped,
// deduped, self-reported so never in val/test). Same B2 backbone and I/O layout as D3/D4.
// Crucially D7 was validated on *deployment geometry* (detector crop_pad 0.45, ~0.69 fill — the
// exact crop lesion-detector.ts produces), so DETECTOR_CROP_ENABLED below must stay on for its
// numbers to hold. Use float32 — the float16 export can't run (TFLite CONV_2D rejects float16 input).
export const MODEL_ASSET = require('../../../assets/models/spoton_classifier_D7_float32.tflite');

/** Recorded on every ScreeningRecord so historical results stay interpretable. */
export const MODEL_VERSION = 'spoton_classifier_D7_float32';

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
 * REFIT FOR D7, 2026-07-30 (scratchpad `refit_d7_threshold.py`). Derived by the same protocol the
 * D4 value was — converge several independent rules on `dataset_real`, then bootstrap to state how
 * precisely 94 images can pin it down — with one deliberate change: fitted at DEPLOYMENT geometry
 * (detector crop, the app default since DETECTOR_CROP_ENABLED went true) rather than the raw full
 * frame the D4 value used. That difference alone moves D4's own optimum from 0.28 to 0.536, so the
 * jump below is mostly geometry, not the model.
 *
 * Youden's J, F1, and the 90%-sensitivity point all converge on 0.5183 (sens 91.7% / spec 86.2%).
 * Shipping 0.50 rather than that optimum, for the same reason D4 shipped 0.28 rather than 0.2801:
 * rounding down is the conservative direction, and 0.52 tips a fourth malignancy into the missed
 * column. At 0.50: sens 91.7% / spec 84.5%, 3 of 36 malignancies missed (2 MEL, 1 SCC), 9 of 58
 * benign lesions floored to Moderate.
 *
 * WHY THIS IS AN IMPROVEMENT, not just a rescaling. Against the previously shipped D4 @ 0.28 —
 * measured on the same 94 images through the same pipeline — D7 @ 0.50 misses the *same number* of
 * malignancies (3) while flagging 9 benign lesions instead of 14. Same sensitivity in absolute
 * terms, a third fewer false alarms. (Only 1 of the 3 missed lesions is common to both, so this is
 * a different 3, not a strictly nested improvement.)
 *
 * WHY NOT 0.28 ON D7. It yields sens 100% / spec 67.2% — every malignancy caught, but 19 of 58
 * benign lesions floored to Moderate. At `dataset_real`'s 38% malignant prevalence that reads as a
 * fair trade; at a real screening population's few percent, specificity dominates the false-alarm
 * count and a Moderate tier that fires on a third of benign lesions stops carrying information.
 * Same argument the D4 note makes against dropping to 0.093.
 *
 * PRECISION WARNING — 2000-resample out-of-bag bootstrap: the Youden-rule threshold has a 90% range
 * of [0.364, 0.755] (median 0.518), and out-of-bag sensitivity averages 85.0% ±12.7 against 91.7%
 * in-sample. As with D4, treat 0.50 as the centre of a broad plateau, not a precise value, and do
 * not re-tune it on this set. Two caveats specific to D7, both unresolved:
 *   - `dataset_real` may not be held out for D7 at all. ZOOM_OUT_RETRAIN.md says to hold it out, but
 *     the export notebook splits `stage3` on Drive 70/15/15 without excluding it. If these 94 images
 *     are in `stage3`, ~70% of them were in D7's train set and the numbers above are optimistic.
 *     Check: print `sorted(tr)` in the notebook and grep for `dataset_real` basenames.
 *   - Cell 3 of `~/Downloads/SpotOn_D7_export_threshold_temperature.ipynb` derives this on D7's own
 *     val split. Its outputs were never saved, so it has not been cross-checked against this value.
 *     Prefer the notebook's number if the two disagree — its split is genuinely held out.
 *
 * --- provenance of the superseded D4 value (0.28), kept for the reasoning ---
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
export const MALIGNANT_THRESHOLD = 0.5;

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
 *
 * D7 (2026-07-30): MEASURED AND DELIBERATELY LEFT AT 1.0. D7 is already better calibrated than D4
 * at T = 1.0 on `dataset_real` at deployment geometry — ECE 0.275 (D4) → 0.197 (D7), mean confidence
 * 0.757 → 0.675, at identical top-1 (59.6%). Fitting T by NLL on those 94 images gives T = 1.42
 * (NLL 1.157 → 1.110, ECE 0.197 → 0.162). Not adopted, for three reasons:
 *   1. It would be fitted and evaluated on the same 94 images — circular, and the gain is modest.
 *   2. T is coupled to *two* behaviours, not one. It rescales the malignant score (so
 *      MALIGNANT_THRESHOLD would have to move with it: at T = 1.42 the converged optimum is 0.5484)
 *      AND it lowers mean confidence to 0.572, which changes how often the <40% Safety Floor fires.
 *      That is a second behavioural change I am not willing to infer from n=94.
 *   3. Cell 3 of the export notebook fits T on D7's own val split. That number should win.
 * So exactly one constant moved for D7 (the threshold). If you adopt a fitted T later, refit the
 * threshold in the same commit — the two are not independent.
 *
 * D4 shipped calibrated (label smoothing during retraining), so no post-hoc rescaling is applied —
 * the model owner specified T = 1.0 and the old D3 band-aid of 5.289 was dropped. Confirmed on
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
 * Scale-consistency check. The classifier is only reliable over a band of lesion-fill fractions:
 * `RandomResizedCrop(scale=(0.4, 1.0))` during training can crop *in* but never *out*, so a lesion
 * that occupies a small part of the frame is out of distribution. Measured on a real benign mole
 * (2026-07-24, D4 + TTA): stable BENIGN at 0.73–0.92 confidence across fill 0.27–0.54, flipping to
 * MEL below fill ≈0.25 — and also destabilising at fill 0.81 (BENIGN 0.44 / MEL 0.40), so tight
 * framing is out of distribution too. There is no single "correct" crop to standardise on.
 *
 * So instead of guessing a crop, we measure the instability: classify the image at several
 * center-crop fractions and see whether the predicted class survives. If it does not, the photo's
 * framing — not the lesion — is driving the answer, and the result is not clinically actionable.
 * classify.ts reports that as `scaleUnstable`; analysis.tsx routes it into the same two-strike
 * rescan path as the Safety Floor.
 *
 * 1.0 must stay first — it is the primary prediction and the one whose probabilities are returned.
 * The extra fraction crops *in* toward the stable band, the direction that rescues a too-wide photo.
 *
 * The ladder was chosen by measurement, not intuition (dataset_real, 94 images, 2026-07-24).
 * Cropping harder is actively worse: a 0.5 crop of an already-tight photo manufactures the same
 * out-of-distribution framing the check exists to detect, so it flags good images too.
 *
 *   ladder            flags   accuracy of flagged / kept   catches the reported bug
 *   [1.0, 0.7]         26%            29% / 59%                     yes
 *   [1.0, 0.85, 0.7]   30%            36% / 58%                     yes
 *   [1.0, 0.7, 0.5]    40%            42% / 57%                     yes
 *   [1.0, 0.8]         20%            21% / 59%                     NO
 *
 * [1.0, 0.7] gives the widest gap between what it rejects and what it keeps (29% vs 59%, against a
 * 51% baseline) at the lowest flag rate that still catches the wide-framing failure — and at two
 * TTA passes rather than three. A flag rate of 26% is high, but those images are ones the model
 * gets right less than a third of the time; asking for a better photo is the honest response.
 */
export const SCALE_CHECK_CROPS: readonly number[] = [1.0, 0.7];

/**
 * Superseded by the confidence-gated zoom refinement below, which *fixes* wide-framing errors
 * instead of deferring them to a rescan. Kept behind this flag (default off) as an optional
 * backstop; flip on to also route residual scale-instability to the rescan path.
 */
export const SCALE_CHECK_ENABLED = false;

/**
 * Confidence-gated zoom refinement — the real fix for small/wide-framed lesions.
 *
 * The training augmentation `RandomResizedCrop(scale=(0.4, 1.0))` only ever crops *in*, so a
 * lesion that fills a small part of the frame is out of distribution and the model drifts toward
 * MEL (a benign mole photographed from a distance read Melanoma@0.61 in the field, 2026-07-24).
 * Rescanning can't fix a genuinely small or distant mole — it is small at every retake. Zooming
 * the *existing* photo to the lesion can.
 *
 * Rule (validated on dataset_real, 94 images): when the full-frame prediction lands below
 * REFINE_CONFIDENCE, locate the lesion (preprocess.ts `locateLesion`), crop to REFINE_TARGET_FILL,
 * and re-classify; adopt the zoomed result. This is applied regardless of the predicted class —
 * the reported failure was a *malignant* call at low confidence, so gating on "benign only" would
 * miss it. Measured effect at 0.65: top-1 51.1% → 58.5% (+7.4 pts), 7 images corrected, and
 * **zero** previously-correct images broken — because a confident prediction is confident precisely
 * because it is already well framed, so the gate never touches it. The field case flips
 * MEL@0.61 → BENIGN@0.85.
 *
 * 0.65 is the lowest gate that catches the field failure (its MEL call sat at 0.61); 0.60 misses
 * it. Raising it further only adds cost without breaking anything, so 0.65 is the efficient point.
 */
/**
 * Detector-canonical crop — the structural fix for zoom-dependence and capture/upload disagreement.
 *
 * The classifier is intrinsically scale-sensitive (training only ever cropped inward), so the
 * inference patches below (DoG locate + zoom refine) reduce but cannot remove the dependence on how
 * the user framed the shot. This removes the user's framing from the input entirely: run the YOLO
 * detector on the still, re-crop to the training geometry (lesion-detector.ts), and classify that.
 * Measured 2026-07-25 — one benign mole across 7 simulated zoom levels: raw classification flips
 * MEL↔BENIGN; the detector re-crop stays BENIGN at every level. It is also the training-match
 * (YOLO box + crop_pad 0.45), which on the 94-image real set lifts top-1 51% → 61%.
 *
 * When the detector finds no lesion, classify.ts falls back to the full frame + the DoG zoom
 * refinement below, so nothing regresses on images the detector can't localize.
 */
export const DETECTOR_CROP_ENABLED = true;

export const REFINE_ENABLED = true;
export const REFINE_CONFIDENCE = 0.65;
/** Lesion diameter ÷ crop side the zoom aims for — the middle of the model's stable framing band. */
export const REFINE_TARGET_FILL = 0.45;

/**
 * Target lesion-fill fraction for the manual crop guide (scan/crop.tsx). Deliberately the same
 * value the auto-refinement zooms to, so the circle a user is asked to fill and the crop the model
 * prefers are one number — telling the user "make the spot fill this circle" produces exactly the
 * framing the classifier is most reliable on (stable band 0.27–0.54, measured 2026-07-24).
 */
export const LESION_TARGET_FILL = REFINE_TARGET_FILL;

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

/* ---------------------------------------------------------------------------------------------
 * Multi-image screenings (1–3 photos of one lesion)
 * ------------------------------------------------------------------------------------------- */

/** Hard cap. More photos is more wall clock and more storage for diminishing variance reduction. */
export const MAX_IMAGES_PER_SCREENING = 3;

/**
 * Whether the classifier POOLS several photos into one prediction, or classifies the primary photo
 * only. **Default false, on measured evidence** — see synth/eval/MULTIVIEW_EVAL.md.
 *
 * The pooling rule itself (uniform mean of per-image logits, then one softmax) is the only
 * defensible one: it is arithmetically what the 4-view dihedral TTA above already does, so an
 * N-image run is a 4N-view logit average. Averaging softmaxes instead would compress confidence
 * toward 1/K and rescale the malignant score against a threshold fitted on logit-mean output.
 *
 * WHY IT SHIPS OFF. Measured N=1 vs N=2 vs N=3 through the deployment pipeline on 61 real two-view
 * pairs and on 94 + 270 lesions with simulated capture views (2026-08-03):
 *   - top-1 moved by under a point in either direction; McNemar p = 1.000 on the real pairs
 *   - malignant AUROC was flat-to-slightly-better (0.847 → 0.854 on the 270-lesion set)
 *   - BUT sensitivity at 0.50 fell 81.1% → 79.1% on that same set, and the bootstrapped Youden
 *     optimum MOVED with N — down on one dataset (0.563 → 0.385), UP on the other (0.518 → 0.610),
 *     with 0.50 falling outside the N=3 plateau [0.516, 0.701].
 * A threshold drift that reverses sign between datasets is not a stable property of pooling; it
 * means MALIGNANT_THRESHOLD is not pinned down finely enough to survive a change in how the
 * probabilities are produced. And it cannot simply be refit per N: synth/eval/ANCHOR.md shows the
 * original D7 fit is not even reproducible from the artifacts on disk, so there is nothing to refit
 * against. Capture and storage ship; pooling waits for a held-out refit.
 *
 * Per-image classifications are computed and recorded either way (per_image_json), so the field
 * data a future refit needs accumulates from day one at no behavioural cost.
 */
export const MULTI_IMAGE_AGGREGATION_ENABLED = false;

/**
 * Minimum per-image confidence for a cross-image disagreement to count. Two 0.30-confidence coin
 * flips landing on different classes is the Safety Floor's job, not evidence that the lesion is
 * unreadable — without this gate the check would fire on near-ties constantly.
 */
export const IMAGE_AGREEMENT_MIN_CONFIDENCE = 0.5;

/**
 * Whether a cross-image disagreement ROUTES to the rescan/floor path (tps-core
 * `evaluateImageAgreement`). Default false, for the same reason SCALE_CHECK_ENABLED is:
 * measured, the separation does not justify the friction.
 *
 * From MULTIVIEW_EVAL.md — disagreeing sets are less accurate, but by 9–14 points, against the
 * 30-point gap the scale check achieved (29% flagged vs 59% kept), and that check ships disabled.
 * At N=3 this would prompt a retake on 12–22% of sessions; on one dataset at N=2 the flagged set
 * was actually *more* accurate than the kept set (53% vs 51%), i.e. no signal at all.
 *
 * `imageDisagreement` is computed and recorded regardless, so the real-world flag rate becomes
 * measurable without shipping the behaviour.
 */
export const IMAGE_AGREEMENT_CHECK_ENABLED = false;

/**
 * Whole-set backstop. INFERENCE_TIMEOUT_MS stays the per-IMAGE ceiling (so a one-photo run behaves
 * exactly as before, and one hung image is dropped rather than holding the whole screening); this
 * only bounds the pathological case where all three photos are captured faster than they classify.
 */
export const SET_INFERENCE_TIMEOUT_MS = 45_000;

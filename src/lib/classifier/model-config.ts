import type { LesionClass } from '../triage/types';

/**
 * Single source of truth for the deployed classifier. Swapping in a new model export
 * (e.g. a float16/INT8 re-export, or a retrained version) should only require changes
 * in this file.
 *
 * Verified against the bundled spoton_d12_fp32.tflite (interpreter inspection, 2026-08-18), and
 * matching the contract its own `model_meta_d12.json` states:
 *   input  "serving_default_args_0"       [1, 3, 260, 260] float32 **NCHW** (EfficientNet-B2)
 *   output "serving_default_output_0_..." [1, 5]           float32        (raw LOGITS — no softmax
 *                                                   in the graph; classify.ts applies it on-device)
 * Confirmed empirically over 8 ImageNet-normalized random inputs: outputs carry negatives and do
 * not sum to 1. The wide-logit behaviour D11 introduced persists — D12 reaches -356 on those probes
 * against D10's -1.78 — and it is now intermittent: 5 of 8 probes return a tame ~7-sum vector and
 * 3 blow out past -100. See CONFIDENCE_TEMPERATURE for what this does to confidence on real images.
 *
 * THE INPUT LAYOUT CHANGED AT D10 — see MODEL_INPUT_LAYOUT below. Every export up to D9 was NHWC
 * [1, 260, 260, 3]; D10 onward is channel-planar. The byte count is identical either way, so a
 * mismatch does not fail at the interpreter, it just scrambles the image.
 *
 * NOT EVERY EXPORT SHARES THAT I/O CONTRACT. The D8 export bakes a softmax into the graph
 * (`SOFTMAX = True` in its `ExportWrap`), so it emits probabilities, not logits. Bundling such a
 * file without setting MODEL_OUTPUTS_PROBABILITIES below double-softmaxes the result — see that
 * constant for the measured damage. Check a new export's output before assuming it is drop-in.
 */

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
//
// === D12 / D12_curated_mm, bundled 2026-08-18 at Shane's instruction. ===
//
// The third swap in two days (D10 -> D11 -> D12). From `D12_latest_curated.ipynb` (train) +
// `D12_export_download.ipynb` (export, identical to D11's exporter apart from checkpoint and output
// paths), with the contract and calibration in `~/Downloads/model_meta_d12.json`:
//     MALIGNANT_THRESHOLD    0.6541   (90%-sens on the D12 valid split @ deploy geometry)
//     CONFIDENCE_TEMPERATURE 0.7159   (LBFGS/NLL on the same logits, same run)
//
// WHAT CHANGED FROM D11 — data only, again. Same recipe, same curated `synapse-iiqly` v2 benigns
// (train-only), latest stage3 plus `spoton-synthetic` **v8** (D11 used v6, D10 v5). All working
// dirs and cache flags are d12-suffixed so nothing from D8-D11 can leak in.
//
// THE SPLIT MOVED AGAIN. Seed-42 lesion-level 70/15/15 recomputed over the current stage3, so the
// test set differs from D11's AND from the ORIGINAL slice. That is now three consecutive exports on
// three different test sets, which is why nothing in this file compares their notebook-printed
// numbers. The notebook is explicit that the built-in three-way head-to-head (D12 vs D11 vs
// D8_slice, one split, same TTA and threshold protocol) is "the real gate", and that D12 should only
// be wired in if it won that.
//
// I/O contract verified by interpreter inspection 2026-08-18: input "serving_default_args_0"
// [1, 3, 260, 260] float32 NCHW, output "serving_default_output_0_output" [1, 5] float32 raw LOGITS,
// so MODEL_INPUT_LAYOUT stays 'nchw' and MODEL_OUTPUTS_PROBABILITIES stays false — mechanically a
// drop-in for D11.
//
// WHAT IS NOT KNOWN — THE SAME GAP FOR THE THIRD TIME. Both D12 notebooks were saved without
// outputs, so the three-way head-to-head its own exporter gates on does not exist on this disk, and
// neither does its valid AUROC/ECE or its PyTorch-vs-TFLite parity margin. Every D10/D11/D12 swap
// has been made on the strength of "the artifact exists" alone. If one of these runs is to be
// defended (thesis, TestFlight, a clinician asking), re-run the notebook with outputs saved — it is
// the only source for the numbers that decide between them.
//
// WHAT WAS MEASURED HERE, 2026-08-18 (`synth/eval/model_bakeoff.py isic_holdout` — all seven exports
// through the shipped pipeline: detector crop, 4-view TTA, logit mean, each under its own contract).
// CAVEAT FIRST: this is the FULL 200-image ISIC holdout, the set the D9 note below calls
// contaminated. The de-duplicated 107-image version cannot be rebuilt on this disk — that dedup ran
// against the Roboflow pool and `synth/eval/roboflow_pool` is gone (a fresh perceptual-hash scan
// against every LOCAL corpus drops exactly 1 of 200 at Hamming <= 8 on both hashes, and finds no
// duplicates inside the holdout). These rows are comparable to EACH OTHER — same images, same
// pipeline, same run — and not to the 107-image table further down.
//     model        top1   AUROC   AUPRC   MEL rec   sens@own thr   spec    ECE   thr for 90% sens
//     D7          0.680   0.839   0.847    0.575       0.792       0.762   0.083      0.2206
//     D7_s3_mm    0.720   0.864   0.880    0.650       0.825       0.775   0.091      0.2551
//     D8          0.690   0.863   0.886    0.600       0.833       0.762   0.085      0.2431
//     D9          0.705   0.858   0.878    0.700       0.708       0.863   0.133      0.2464
//     D10         0.680   0.843   0.878    0.525       0.808       0.750   0.089      0.1020
//     D11         0.675   0.857   0.892    0.550       0.683       0.850   0.143      0.1298
//     D12         0.710   0.849   0.888    0.525       0.725       0.838   0.115      0.0936
//
// D12 IS THE BEST OF THE THREE curated_mm RUNS, AND THE FIRST THAT IS NOT A REGRESSION. Top-1 0.710
// against D10's 0.680 and D11's 0.675, second only to D7_s3_mm (0.720) — and the gap to that
// baseline is now noise (McNemar 13 vs 11, p = 0.84, against p = 0.09-0.15 for D10/D11). It also
// reverses the specific damage the curated-MoleMapper line had done to BENIGN: recall 0.725 here,
// against 0.600-0.625 for every other export scored, which is what a train-only benign corpus was
// supposed to buy in the first place.
//
// TWO THINGS IT DOES NOT FIX. MEL recall is 0.525, tied with D10 for the worst of the seven — three
// consecutive exports have now traded melanoma sensitivity for benign specificity, in a product
// whose whole purpose is catching melanoma. And its shipped threshold is the most conservative yet
// relative to this set: 0.6541 measures sensitivity 0.725 (33 of 120 malignancies missed) where the
// 90%-sensitivity point is 0.0936, a ratio of ~7.0x (D9 ~3.1x, D10 ~3.8x, D11 ~5.3x). The same model
// at 0.40 measures sens 0.775 / spec 0.750; at 0.20, sens 0.850 / spec 0.688. So the discrimination
// is there and the threshold is where the sensitivity goes.
//
// --- previously bundled: D11 / D11_curated_mm (bundled and superseded 2026-08-17) ---
//
// D10's successor, same day. From `D11_expanded_curated.ipynb` (train) + `D11_export_download.ipynb`
// (export, byte-identical to D10's exporter apart from the checkpoint and output paths), with the
// contract and calibration in `~/Downloads/model_meta_d11.json`:
//     MALIGNANT_THRESHOLD    0.6819   (90%-sens on the D11 valid split @ deploy geometry)
//     CONFIDENCE_TEMPERATURE 0.7283   (LBFGS/NLL on the same logits, same run)
//
// WHAT CHANGED FROM D10 — data only, recipe untouched. Same B2/L2-SP/zoom-out/balanced-sampler
// recipe, same curated `synapse-iiqly` v2 benigns (train-only), but on an EXPANDED stage3 plus
// `spoton-synthetic` **v6** (D10 used v5). Every working dir and cache flag is d11-suffixed so no
// stale D8-D10 crop can leak in.
//
// THE SPLIT MOVED, SO PRINTED NUMBERS ARE NOT COMPARABLE. The notebook says it plainly: the split is
// still seed-42 lesion-level 70/15/15, but recomputed over the expanded stage3, so the test set is
// NOT byte-identical to the ORIGINAL slice D4/D8_slice/D10 were scored on. Its own header calls
// cross-run comparisons "indicative" and asks for a re-run of D8_slice on THIS split for a strict
// head-to-head. That re-run is not on this disk.
//
// I/O contract verified by interpreter inspection 2026-08-17: input "serving_default_args_0"
// [1, 3, 260, 260] float32 NCHW, output "serving_default_output_0_output" [1, 5] float32 raw LOGITS,
// so MODEL_INPUT_LAYOUT stays 'nchw' and MODEL_OUTPUTS_PROBABILITIES stays false — mechanically a
// drop-in for D10. The logit SCALE is not a drop-in; see CONFIDENCE_TEMPERATURE.
//
// WHAT IS NOT KNOWN, same gap as D10. Both D11 notebooks were saved without outputs, so none of its
// own numbers exist here: not the head-to-head its exporter gates on ("Only export if D11 beat/tied
// D8_slice in the head-to-head on the same split. Otherwise the deployment artifact stays
// D8_slice."), not the valid AUROC/ECE, not the PyTorch-vs-TFLite parity margin. That the artifact
// was exported and handed over is the only evidence here that the gate passed.
//
// MEASURED ON THE ISIC HOLDOUT — see the seven-model table in the D12 block above, which includes
// this export. In short: D11's ranking is strong (top AUPRC 0.892, second AUROC 0.857) but 0.6819
// sits badly on that score — sensitivity 0.683, the lowest of the seven, 38 of 120 malignancies
// missed; the same model at 0.40 gives sens 0.817 / spec 0.762. Top-1 0.675 was the lowest of the
// seven and MEL recall 0.550 second-lowest.
//
// --- previously bundled: D10 / D10_curated_mm (bundled and superseded 2026-08-17) ---
//
// From `D10_curated_synapse_benign.ipynb` (train) + `D10_export_download.ipynb` (export), with the
// contract and calibration in `~/Downloads/model_meta_d10.json` — the first export to ship a
// machine-readable model card rather than a `deploy_config.txt`:
//     MALIGNANT_THRESHOLD    0.3859   (90%-sens on seed-42 valid @ deploy geometry; F1 point 0.6310)
//     CONFIDENCE_TEMPERATURE 0.7889   (LBFGS/NLL on the same logits, same run)
// Both are stated by the meta as fitted on T-SCALED probabilities, which is exactly how classify.ts
// consumes them (softmax(logits / T), then sum over BCC+MEL+SCC), so they are adopted verbatim by
// the same rule D7_s3_mm's and D9's were: a held-out val fit beats anything derivable on this disk.
//
// WHAT D10 IS. The D7/D8/D9 recipe (B2, L2-SP, zoom-out aug, no hue/sat, balanced sampler,
// lesion-level seed-42 70/15/15) trained on stage3 + synthetic v5 + **hand-curated** MoleMapper
// benign moles (Roboflow `synapse-iiqly` v2, 2,928 images, benign-only, TRAIN-only, YOLO
// loose-cropped, phash-deduped against everything already cropped). No SLICE-3D anywhere. Its
// stated purpose is to isolate whether the CURATED MoleMapper set behaves better than the raw
// Synapse pull did in D9 — the test slice is the clean original real one, so it is directly
// comparable to D4 and D8_slice's original numbers.
//
// I/O CONTRACT — THE INPUT LAYOUT CHANGED. Verified by interpreter inspection 2026-08-17: input
// "serving_default_args_0" [1, 3, 260, 260] float32 **NCHW**, output
// "serving_default_output_0_output" [1, 5] float32 raw LOGITS (min -1.78 over 8 ImageNet-normalized
// random inputs; no run sums to 1), so MODEL_OUTPUTS_PROBABILITIES stays false. The layout is the
// break: every export up to D9 was NHWC. litert-torch traces the PyTorch graph as-is instead of
// inserting the transpose the older exporters did. See MODEL_INPUT_LAYOUT below.
//
// WHAT IS NOT KNOWN. The notebooks were saved without outputs, so NONE of D10's own numbers exist
// on this disk — not the gates its own header sets (MEL recall >= ~0.938, fairness gap near D4's
// -0.022 rather than D9's +0.082, benign FP strictly lower than D8_slice at matched sensitivity,
// flip-rate < 10%, AUROC >= ~0.96), not the valid AUROC/ECE the export prints, not the
// PyTorch-vs-TFLite parity margin its own gate asserts. The export notebook says plainly: "Only
// export D10 if it passed the gates … If it didn't, the deployment artifact stays D8_slice." That
// the artifact was exported and handed over is the only evidence here that it did. Re-run either
// notebook with outputs saved before quoting a D10 number anywhere, thesis included.
//
// MEASURED ON THE ISIC HOLDOUT — see the six-model table in the D11 block above, which includes
// this export. In short: D10 is the weakest there on MEL recall (0.525), tied-lowest on top-1
// (0.680), and its threshold buys back most of the sensitivity D9's 0.7519 gave away (0.708 ->
// 0.808) at a cost in specificity (0.863 -> 0.750). McNemar against the D7_s3_mm baseline is not
// significant (16 vs 8, p = 0.15). The MEL number is the one to weigh: D10's own gate demanded MEL
// recall >= ~0.938 on its own test slice — different set, but the direction is against the export.
//
// --- previously bundled: D9 / D6_multiscale (2026-08-12 → 2026-08-17) ---
//
// READ THE FILENAME WITH CARE: `spoton_d9_fp32.tflite` is NOT a training run newer than D8. It is
// the **D6_multiscale** export from `~/Downloads/SpotOn_D6_multiscale_export.ipynb`, which writes
// `spoton_d6_multiscale_fp32.tflite`; the file was renamed on download. Never infer lineage order
// from a `d<N>` filename in assets/models — check the matching `deploy_config*.txt`.
//
// Calibration is taken verbatim from `~/Downloads/deploy_config (1).txt` (D6_multiscale, exported
// 2026-08-12), both constants below fitted together on deploy-geometry val:
//     MALIGNANT_THRESHOLD    0.7519   (90%-sens, no TTA; F1 point 0.7332 for reference)
//     CONFIDENCE_TEMPERATURE 0.7828
//
// I/O contract verified by interpreter inspection 2026-08-12 — input "serving_default_args_0"
// [1, 260, 260, 3] float32 NHWC, output "serving_default_output_0_output" [1, 5] float32 raw
// LOGITS (signed: min -22.0 across 12 ImageNet-normalized random inputs). So this is a drop-in on
// geometry and MODEL_OUTPUTS_PROBABILITIES stays false. Note a single N(0,1) probe returns all
// -positive values and looks deceptively like a non-logit graph; use normalized inputs to check.
//
// EVIDENCE AGAINST THIS MODEL, recorded so the choice is not re-made blind. The export notebook's
// own header says D6 "has the documented zoom-in regression and the widest fairness gap of the
// D-runs (-0.064 at deploy geometry) … shipping it is not the plan". On the de-duplicated 107-image
// ISIC holdout it is the weakest of the four candidates on both discrimination and sensitivity at
// its own shipped threshold:
//     model        top1   AUROC   sens@own thr   spec    thr for 90% sens
//     D7          0.598   0.837       0.725      0.815        0.1965
//     D7_s3_mm    0.636   0.858       0.750      0.852        0.1448
//     D8          0.579   0.832       0.762      0.741        0.2192
//     D9          0.617   0.826       0.613      0.852        0.2336
// Two caveats on that table, both stated by Shane 2026-08-12: the 107 images are what survives
// dropping 93 exact duplicates, which wrecks the 40/class balance (BCC 40->14, OTHER 40->11); and
// the earlier 200-image figures for the same comparison are contaminated and must not be quoted.
// Either way the direction holds — every model needs ~0.14-0.23 to reach 90% sensitivity, against
// shipped values of 0.41-0.75, and 0.7519 is the furthest of any candidate from its own 90% point.
//
// --- previously bundled: D7_s3_mm ---
// (2026-08-10, `D7_s3_mm.pt` → SpotOn_D7_s3_molemapper.ipynb, exported by
// SpotOn_D7_s3_mm_export.ipynb). The D7 recipe with the training SOURCES narrowed: Drive `stage3`
// real images plus OHSU MoleMapper benign nevi (Synapse syn51602723, train-only, capped at 3000,
// deduped) — and nothing else. No synthetic, no Roboflow hard-negative pull. Mechanics are
// unchanged from D7: RandomZoomOut(edge) before RandomResizedCrop, loose ~0.36-fill base crops for
// train, eval on deployment geometry (crop_pad 0.45, ~0.69 fill), anchor stage1, label smoothing
// 0.1, lesion-level split seed 42, balanced sampler, cosine 5e-5, 25 epochs.
//
// UNLIKE D7 AND D8, THE D7_s3_mm EXPORT SHIPS ITS OWN CALIBRATION. `exports/D7_s3_mm/
// deploy_config.txt` (fetched from Drive 2026-08-11) carries the constants it was bundled with,
// both derived on deploy-geometry VAL crops — genuinely held out, unlike anything measurable
// offline here:
//     MALIGNANT_THRESHOLD    0.4069   (90%-sensitivity point; F1 point 0.5729 for reference)
//     CONFIDENCE_TEMPERATURE 0.9594
// They are adopted verbatim rather than re-derived. Note they are a PAIR from one fit: T rescales
// the malignant score, so neither may be changed without the other.
//
// OFFLINE SANITY CHECK ONLY (1320 Roboflow `spoton-dataset` images, 2026-08-11). These are ~70%
// training data for this lineage — stage3 now contains the imported hard set — so this is fit, not
// generalization, and the numbers are quoted only to show nothing is grossly wrong: top-1 0.882,
// malignant AUROC 0.972, ECE 0.057, Safety Floor fires on 1.4%.
//
// --- D7 (2026-07-30, `D7_zoomout_mm.pt` → SpotOn_D7_export_threshold_temperature.ipynb) ---
// The predecessor, kept because its reasoning still explains the geometry constants below: the
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
//
// D8 WAS TRIALLED AND REVERTED (2026-08-11). `spoton_d8_fp32.tflite` is still in assets/models but
// is not bundled. It measured better on the Roboflow `spoton-dataset` images (top-1 0.773 → 0.851,
// malignant AUROC 0.915 → 0.959, McNemar p = 1.1e-10) — but all 1320 of those images are
// `split:train` for both models, so that is fit on hard examples, not generalization. Against it:
// D8's own held-out seed-42 split gives AUROC 0.958 while `D8_export_tflite.ipynb` records the
// predecessor at 0.979 and says the export "exists to trial the trade-off, not as the new
// default"; and D8's run reports a Fitzpatrick sIII-VI sensitivity gap of +0.129 against D4's
// -0.022, which for a Fitz III-V-focused product outweighs a top-1 gain.
// To trial it again: point MODEL_ASSET/MODEL_VERSION at it, set MODEL_OUTPUTS_PROBABILITIES true
// (its graph emits probabilities — see that constant), and refit MALIGNANT_THRESHOLD; D8's own
// thr90 is 0.4057 and its thrF1 is 0.6188, and those do NOT converge, so the value is a policy
// choice rather than a measured optimum. Settle it with `~/Downloads/D7_vs_D8_heldout.ipynb`,
// which scores both models on the identical held-out split.
export const MODEL_ASSET = require('../../../assets/models/spoton_d12_fp32.tflite');

/** Recorded on every ScreeningRecord so historical results stay interpretable. */
export const MODEL_VERSION = 'spoton_d12_fp32';

/**
 * How the bundled graph wants its pixels: 'nhwc' [1,H,W,3] (every export up to D9) or 'nchw'
 * [1,3,H,W] (D10 onward, exported with litert-torch, which traces the PyTorch graph without
 * inserting a transpose).
 *
 * DECLARED, NOT INFERRED SILENTLY — for the same reason MODEL_OUTPUTS_PROBABILITIES is. The two
 * layouts hold the identical byte count, so feeding the wrong one does not fail at the interpreter;
 * the model just sees a scrambled image and returns confident nonsense. classify.ts `prepareModel`
 * cross-checks this against the shape the loaded graph reports and throws 'invalid-output' on a
 * mismatch, so a stale constant surfaces at model load rather than as wrong triage; preprocess.ts
 * `nhwcToNchw` does the repack, applied per TTA view immediately before `model.run` (the flips and
 * crops upstream are all written against interleaved RGB).
 */
export const MODEL_INPUT_LAYOUT: 'nhwc' | 'nchw' = 'nchw';

/**
 * Whether the bundled graph already ends in a softmax, i.e. emits probabilities rather than logits.
 *
 * FALSE for the bundled D7, and for every export up to it — they emit raw logits and classify.ts
 * applies the softmax. It is TRUE only for a softmax-baked export such as D8. Declared rather than
 * sniffed because the consequence of getting it wrong is silent and severe, and a heuristic can
 * only see it after the fact — by which point the TTA views have already been averaged in the
 * wrong space.
 *
 * classify.ts uses this to convert each view back to log space (aggregate-core `toLogitSpace`)
 * BEFORE averaging, so the 4-view TTA, CONFIDENCE_TEMPERATURE and multi-image pooling all keep
 * operating in the logit space MALIGNANT_THRESHOLD is calibrated on. It also cross-checks each raw
 * output against this flag and fails loudly on a mismatch, so a mis-set constant surfaces as a
 * caught 'invalid-output' rather than as quietly wrong triage.
 *
 * WHAT GOES WRONG IF THIS IS LEFT FALSE WITH A SOFTMAX-BAKED MODEL BUNDLED — measured on D8 over
 * 1320 images, 2026-08-11. classify.ts would softmax an already-softmaxed vector. Top-1 is
 * untouched (softmax is monotone), so it looks fine, but confidence collapses and everything
 * downstream that reads confidence breaks: mean top-class confidence 0.784 → 0.343, the malignant
 * score compresses from [0.002, 0.998] to [0.447, 0.702] (so sens/spec @0.50 becomes 0.984/0.642),
 * and the <40% Safety Floor fires on 96.1% of images instead of 2.8%. classify.ts guards against
 * this: it cross-checks every raw output against this flag and throws 'invalid-output' on a
 * mismatch, so a mis-set constant surfaces as a caught error rather than as quietly wrong triage.
 */
export const MODEL_OUTPUTS_PROBABILITIES = false;

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
 * === D12 / D12_curated_mm, 2026-08-18: 0.6541, TAKEN VERBATIM FROM `model_meta_d12.json`. ===
 *
 * The 90%-sensitivity point on T-scaled malignant probabilities over the D12 valid split at deploy
 * geometry, fitted in the same run as CONFIDENCE_TEMPERATURE 0.7159. Adopted unrounded, by the rule
 * every export since D7_s3_mm has been adopted under.
 *
 * ITS TWO SELECTION RULES DIVERGE THIS TIME — thr90 0.6541 against thrF1 0.7669, ~0.11 apart, where
 * D11's two landed eleven ten-thousandths from each other. Nothing is wrong with that (the rules
 * optimize different things and D4's shipped value came from a similar spread), but it removes the
 * one weak corroboration D11 had. The shipped value is the 90%-sens point, i.e. the SENSITIVITY-
 * favouring end of that range, which is the right end to pick for this product.
 *
 * MEASURED, AND THIS IS THE COST: on the 200-image ISIC holdout 0.6541 yields sensitivity 0.725 —
 * 33 of 120 malignancies missed — at specificity 0.838. Better than D11's 0.683 at its own value,
 * still well below D7_s3_mm's 0.825. That set's own 90%-sensitivity point for D12 is 0.0936, so the
 * shipped threshold sits ~7.0x above it — the widest shipped-vs-needed ratio of any export scored
 * (D9 ~3.1x, D10 ~3.8x, D11 ~5.3x). The gap between where these exports are calibrated and where
 * this holdout says 90% sensitivity lives has widened at every swap; it is the single most
 * persistent finding in this file and it is still unexplained. Two candidate explanations, neither
 * tested: the val splits these thresholds are fitted on are easier than the holdout (plausible —
 * they are deploy-crops of stage3, which shares sources with training), or the holdout's 40/class
 * balance misrepresents the score distribution. Settling it needs a genuinely held-out set that is
 * not this one.
 *
 * PAIRED WITH CONFIDENCE_TEMPERATURE 0.7159 — same fit, same export. Never move one alone.
 *
 * --- superseded D11 / D11_curated_mm value (0.6819), from `model_meta_d11.json` ---
 *
 * The 90%-sensitivity point on T-scaled malignant probabilities over the D11 valid split at deploy
 * geometry, fitted in the same run as CONFIDENCE_TEMPERATURE 0.7283. Adopted unrounded, by the rule
 * every export since D7_s3_mm has been adopted under.
 *
 * ITS TWO SELECTION RULES CONVERGE — thr90 0.6819 and thrF1 0.6808, eleven ten-thousandths apart.
 * On D4 and D7 that kind of convergence was the strongest available evidence that a threshold is
 * real rather than an artifact of one rule (see the D4 note at the bottom). It is weaker evidence
 * here, but not empty: D11's malignant score is more polarized than D10's (56 of 200 holdout images
 * above 0.95 against D10's 33), and the more mass sits at the ends, the more thresholds across a
 * broad middle band score alike — so two rules can agree without the operating point being
 * well determined. It is not the degenerate case, though: 89 of 200 images still land between 0.05
 * and 0.95. Read the convergence as suggestive, not as confirmation.
 *
 * IT ALSO MOVES BACK UP, HARD: 0.3859 (D10) -> 0.6819, near D9's 0.7519. Nothing about the policy
 * changed; the score's SCALE did. Do not read the direction as a deliberate tightening, and do not
 * compare this number to any earlier one — a threshold is only meaningful against the export it was
 * fitted with.
 *
 * MEASURED: on the ISIC holdout 0.6819 yielded sensitivity 0.683 — the lowest of the seven exports
 * scored, 38 of 120 malignancies missed — at specificity 0.850, and ~5.3x above that set's own
 * 90%-sensitivity point of 0.1298. See the table in the MODEL_ASSET block, caveats included.
 *
 * PAIRED WITH CONFIDENCE_TEMPERATURE 0.7283 — same fit, same export. Never move one alone.
 *
 * --- superseded D10 / D10_curated_mm value (0.3859), from `model_meta_d10.json` ---
 *
 * The 90%-sensitivity point on T-scaled malignant probabilities over the seed-42 VALID split at
 * deploy geometry (crop_pad 0.45 — the crop lesion-detector.ts produces), fitted in the same run as
 * CONFIDENCE_TEMPERATURE 0.7889. Adopted unrounded, by the rule D7_s3_mm's and D9's values were.
 *
 * THIS IS A LARGE MOVE DOWN — 0.7519 → 0.3859, roughly halving the bar the Malignant Gate has to
 * clear. It is not a policy change: it is the same 90%-sens rule refitted on a different model, and
 * the score it applies to is not comparable across exports. Expect the gate to fire MORE often than
 * under D9 and the Moderate floor with it. That direction is consistent with the standing finding
 * that every shipped threshold in this project has sat well above its own holdout 90%-sens point
 * (see the D9 note below: 0.7519 measured 61.3% sensitivity on the 107-image ISIC holdout, where
 * ~0.2336 was needed for 90%). 0.3859 is the closest any shipped value has come to that band.
 *
 * ITS OWN HOLDOUT NUMBER IS NOT RECORDED YET. The D10 notebooks were saved without outputs, so
 * nothing about this export has been measured on this disk. `synth/eval/model_bakeoff.py` carries a
 * D10 spec (added with this swap, NCHW-aware) and scores it on the de-duplicated ISIC holdout
 * through the exact shipped pipeline; run it before quoting a sensitivity figure for D10.
 *
 * PAIRED WITH CONFIDENCE_TEMPERATURE 0.7889 — same fit, same export. Never move one alone.
 *
 * --- superseded D9 / D6_multiscale value (0.7519), from `deploy_config (1).txt` ---
 *
 * The 90%-sensitivity point on deploy-geometry VAL crops for the D6_multiscale export, fitted in
 * the same run as CONFIDENCE_TEMPERATURE 0.7828. Adopted unrounded, by the same rule D7_s3_mm's
 * value was: a held-out val fit beats anything derivable from the sets on this disk.
 *
 * IT IS ALSO THE HIGHEST THRESHOLD THIS PROJECT HAS SHIPPED, AND THE HOLDOUT DISAGREES WITH IT.
 * On the de-duplicated 107-image ISIC holdout, 0.7519 measures 61.3% sensitivity — the lowest of
 * the four candidates — and reaching 90% there would need ~0.2336. That gap is not unique to this
 * model (every candidate's shipped threshold is 2-4x its own holdout 90%-sens point, which is the
 * finding, not an argument for this export in particular), but D9 has the widest gap of the four
 * and the lowest sensitivity at its own value. See the MODEL_ASSET note above for the full table
 * and for why the older 200-image version of it cannot be quoted.
 *
 * PAIRED WITH CONFIDENCE_TEMPERATURE 0.7828 — same fit, same export. Never move one alone.
 *
 * --- superseded D7_s3_mm value (0.4069), kept for the protocol it documents ---
 *
 * That was the first export to arrive with its own calibration, and it is a better-founded number
 * than anything derived here: the 90%-sensitivity operating point on temperature-scaled
 * DEPLOY-GEOMETRY VALIDATION crops (crop_pad 0.45, ~0.69 fill — the exact crop lesion-detector.ts
 * produces), verified on test, from `SpotOn_D7_s3_mm_export.ipynb`. The val split is genuinely held
 * out; every set available offline here is not. So it is adopted unrounded and unmodified.
 *
 * PAIRED WITH CONFIDENCE_TEMPERATURE 0.9594 — same fit, same notebook. T rescales the softmax and
 * therefore the malignant score, so these two constants are one unit. Never move one alone.
 *
 * THE ONE MISMATCH, MEASURED AND ACCEPTED. deploy_config.txt derives both constants from a SINGLE
 * forward pass, and the notebook asserts that is "same as the phone". It is not — TTA_ENABLED is
 * true, so the app averages 4 dihedral views. Measured on 1320 images (2026-08-11) the difference
 * is small and in the safe direction:
 *   - malignant score shifts by mean +0.0038 / median +0.0009 (p5 -0.098, p95 +0.115)
 *   - only 40 of 1320 images (3.0%) cross 0.4069 at all when TTA is switched on
 *   - the empirical 90%-sens point moves +0.0150, an order of magnitude less than the ±0.2-wide
 *     bootstrap plateau the D7 note below documents for a threshold of this kind
 *   - TTA is slightly BETTER on every headline metric (top-1 0.882 vs 0.874, AUROC 0.972 vs 0.965)
 * So TTA stays on and the published threshold stands. If TTA_ENABLED is ever flipped off, this
 * constant becomes exactly right rather than approximately right — no refit needed in that
 * direction.
 *
 * DO NOT re-tune this on the Roboflow `spoton-dataset` images. They are ~70% training data for this
 * lineage; the model fits them well enough that 0.4069 measures 96.7% sensitivity there rather than
 * the intended 90%, and the empirical 90%-sens point on that set is ~0.69. That gap is
 * memorization, not evidence the threshold is wrong.
 *
 * --- superseded D7 value (0.50), kept for the protocol it documents ---
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
export const MALIGNANT_THRESHOLD = 0.6541;

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
 * === D12 / D12_curated_mm, 2026-08-18: 0.7159, from `model_meta_d12.json`. ===
 *
 * A scalar T fit by NLL (LBFGS) on the D12 valid logits at deploy geometry, in the same cell that
 * produced MALIGNANT_THRESHOLD 0.6541. Adopted verbatim. The fourth sharpening temperature in a row
 * (0.7828 -> 0.7889 -> 0.7283 -> 0.7159, all T < 1, all scaling logits up), and the wide-logit
 * behaviour D11 introduced is still present — D12 hits -356 on random probes against D10's -1.78,
 * now intermittently (5 of 8 probes look tame, 3 blow out).
 *
 * ON REAL IMAGES IT IS SLIGHTLY BETTER THAN D11, NOT WORSE. Measured on the 200-image ISIC holdout
 * through the shipped pipeline (2026-08-18):
 *                              D11      D12
 *     mean top-class conf     0.818    0.815
 *     ECE                     0.143    0.115   (D11 was the worst of the seven; D12 is 5th)
 *     Safety Floor (<0.40)     2.0%     1.5%   (3 images of 200)
 *     conf < REFINE_CONFIDENCE 19.0%    22.0%
 *     malignant score in mid   89/200   94/200 (0.05 .. 0.95)
 * So the polarization stopped worsening: calibration error comes back down a fifth, the score
 * distribution is marginally less piled at the ends, and the confidence-gated zoom refinement fires
 * a little MORE often (44 images vs 38). What has not recovered is the Safety Floor, now at 1.5%
 * against 3.0-4.5% for the pre-D10 exports. A floor that fires on 3 images in 200 is close to
 * decorative; if the intent is a floor that actually catches unreadable photos under these models,
 * the 0.40 constant needs refitting to this confidence distribution rather than left at a value
 * chosen when mean confidence was 0.73.
 *
 * COUPLED TO MALIGNANT_THRESHOLD 0.6541 — one fit, one unit, replaced together.
 *
 * --- superseded D11 / D11_curated_mm value (0.7283), from `model_meta_d11.json` ---
 *
 * A scalar T fit by NLL (LBFGS) on the D11 valid logits at deploy geometry, in the same cell that
 * produced MALIGNANT_THRESHOLD 0.6819. Adopted verbatim. Nominally the third sharpening temperature
 * in a row (0.7828 -> 0.7889 -> 0.7283, all T < 1, all scaling logits UP), but it does not mean what
 * the D9/D10 values meant.
 *
 * THE LOGIT SCALE IS THE STORY, NOT T. On identical ImageNet-normalized random probes, D10's logits
 * bottom out at -1.78 and D11's at -437 — roughly 200x wider — and dividing by 0.7283 widens them
 * another ~37%. Random noise is not real data, though, so the question is what that does to REAL
 * images. Measured on the 200-image ISIC holdout through the shipped pipeline (2026-08-17), against
 * D10 on the same images:
 *                              D10      D11
 *     mean top-class conf     0.755    0.818   (highest of the six exports scored)
 *     ECE                     0.089    0.143   (worst of the six)
 *     Safety Floor (<0.40)     3.0%     2.0%
 *     conf < REFINE_CONFIDENCE 34.5%    19.0%
 *     malignant score >0.95    33/200   56/200
 *     malignant score in mid   121/200  89/200  (0.05 .. 0.95)
 * So the polarization is REAL BUT PARTIAL — not the saturation the random-probe logits suggest. The
 * distribution stays usable: the floor still fires, the zoom refinement still triggers on about one
 * image in five, and 89 images still land in the middle of the malignant score. What genuinely
 * degrades is calibration quality: ECE 0.143 is the worst of any export measured here, i.e. this
 * model's confidence is the least honest of the six even after its own fitted T. Treat
 * `topConfidence` under D11 as a weaker signal than under D10 wherever it is read as strength of
 * evidence — the TPS confidence term, IMAGE_AGREEMENT_MIN_CONFIDENCE, the REFINE_CONFIDENCE gate.
 * Re-run `synth/eval/model_bakeoff.py isic_holdout` after any future swap; those five rows are the
 * cheapest way to see this kind of drift before it ships.
 *
 * COUPLED TO MALIGNANT_THRESHOLD 0.6819 — one fit, one unit, replaced together.
 *
 * --- superseded D10 / D10_curated_mm value (0.7889), from `model_meta_d10.json` ---
 *
 * A scalar T fit by NLL (LBFGS, 100 iters) on the seed-42 VALID logits at deploy geometry, in the
 * same cell that produced MALIGNANT_THRESHOLD 0.3859. Adopted verbatim. Essentially unchanged from
 * D9's 0.7828 — again SHARPENING by ~27%, i.e. this export is under-confident on val to almost
 * exactly the same degree its predecessor was.
 *
 * The Safety Floor caveat from D9 carries over unchanged: confidence rising ~27% pushes the
 * distribution away from the <40% floor, so a floor that rarely fires is expected under this model
 * rather than a bug. Still not measured on an uncontaminated local set.
 *
 * COUPLED TO MALIGNANT_THRESHOLD 0.3859 — one fit, one unit, replaced together.
 *
 * --- superseded D9 / D6_multiscale value (0.7828), from `deploy_config (1).txt` ---
 *
 * Same rule as D7_s3_mm below — a scalar T fitted on deploy-geometry VAL logits, in the same run
 * that produced MALIGNANT_THRESHOLD 0.7519, adopted verbatim. Also T < 1, i.e. SHARPENING, but
 * much harder than D7_s3_mm's 0.9594: dividing logits by 0.7828 scales them up ~28% rather than
 * ~4%, so this export was substantially more under-confident on val than its predecessor.
 *
 * WATCH THE SAFETY FLOOR. Confidence rising ~28% pushes the whole distribution away from the <40%
 * floor, so the floor should fire LESS often than the 1.4% measured under D7_s3_mm. It has not
 * been re-measured for this export — there is no uncontaminated local set to measure it on — so
 * treat a floor that has gone silent in the field as expected under this model rather than as a
 * bug, and re-derive the rate from field data once it accumulates.
 *
 * COUPLED TO MALIGNANT_THRESHOLD 0.7519 — one fit, one unit, replaced together.
 *
 * --- superseded D7_s3_mm value (0.9594), the first non-1.0 temperature since D3 ---
 *
 * From that export's own `deploy_config.txt`: a scalar T fit by NLL (LBFGS) on deploy-geometry
 * VALIDATION logits, in the same notebook and the same run that produced MALIGNANT_THRESHOLD
 * 0.4069. Adopted verbatim, for the reason D7 gave for NOT adopting its own fitted T=1.42 — the
 * objection there was that the fit was circular (fitted and evaluated on the same 94 images) and
 * that a genuinely held-out notebook value should win. This IS that value.
 *
 * T < 1 SHARPENS rather than softens: dividing logits by 0.9594 scales them up ~4%, so confidence
 * rises slightly. That is the opposite direction from the usual over-confidence correction, and it
 * says this model was mildly UNDER-confident on val. Measured consequence offline (1320 images,
 * contaminated so indicative only): mean confidence 0.828, ECE 0.057, and the <40% Safety Floor
 * fires on 1.4% of images — comfortably inside its design band, and no risk of the floor going
 * quiet or firing constantly.
 *
 * COUPLED TO MALIGNANT_THRESHOLD — the score is a sum of post-temperature softmax values. The two
 * were fitted together and must be replaced together.
 *
 * NOTE ON MECHANISM: with MODEL_OUTPUTS_PROBABILITIES true, T is applied to the log-space vector
 * recovered by `toLogitSpace`, not to the graph's probabilities. That is exact, not an
 * approximation — see the proof in aggregate-core.ts. (Simply skipping the softmax for a
 * probability-emitting graph would make T an unreachable no-op.) Inert for the bundled D7, which
 * emits logits.
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
export const CONFIDENCE_TEMPERATURE = 0.7159;

/**
 * Test-time augmentation: run the 4 dihedral flips (original, h-flip, v-flip, both) and average
 * the raw logits before softmax. This is the configuration MALIGNANT_THRESHOLD was selected under,
 * so the two must move together. Costs 4× inference (still well inside INFERENCE_TIMEOUT_MS).
 * Set to false to fall back to a single forward pass.
 *
 * D7_s3_mm (2026-08-11): STAYS ON, though its constants were fitted single-pass. See the mismatch
 * note on MALIGNANT_THRESHOLD — measured at 1320 images, enabling TTA moves the malignant score by
 * a median +0.0009, flips 3.0% of images across the threshold, and improves top-1 and AUROC. Off is
 * the strictly-calibrated configuration and on is the slightly more accurate one; on wins because
 * the calibration error it introduces is far smaller than the threshold's own uncertainty.
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
 * Target lesion-fill fraction for the manual crop guide and the upload auto-frame (scan/crop.tsx):
 * lesion diameter ÷ crop side, so the visible field is 1/LESION_TARGET_FILL lesion diameters.
 *
 * DECOUPLED FROM REFINE_TARGET_FILL, 2026-08-11. It was an alias of it (0.45), on the reasoning
 * that the circle a user is asked to fill and the crop the model prefers should be one number.
 * That conflates two different jobs, and the shared value was tuned for the model's job:
 *   - REFINE_TARGET_FILL is an INFERENCE crop, seen only by the classifier, on the fallback path
 *     when the detector cannot localize. 0.45 is the middle of the measured stable band.
 *   - This one is a VIEWFINDER, seen by a person. At 0.45 the upload preview opens showing just
 *     2.2 lesion diameters, which reads as jarringly over-zoomed — the reported symptom.
 * 0.32 shows ~3.1 diameters instead (a 41% wider field) while staying inside the same 0.27–0.54
 * stable band, so a photo framed to this guide is still in-distribution if it ever reaches the
 * classifier uncropped.
 *
 * WHY THIS DOES NOT MOVE THE OPERATING POINT. DETECTOR_CROP_ENABLED is on, so the classifier
 * re-crops with the YOLO detector at crop_pad 0.45 regardless of how the user framed the shot —
 * the manual crop only has to CONTAIN the lesion with enough margin for the detector to localize
 * it. Wider is the safer direction there too: the detector discards any box spanning more than
 * FULL_FRAME (0.95) of the image as "not a localized lesion", which over-zooming walks toward.
 *
 * Turn it down further to zoom out more, up to zoom in. Below ~0.27 the classifier's own stability
 * band gives out, so treat that as the floor rather than going wider still.
 */
export const LESION_TARGET_FILL = 0.32;

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

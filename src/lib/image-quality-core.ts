/**
 * Pure, dependency-free core of the still-image quality gate. No native imports (no
 * expo-image-manipulator, no jpeg-js) so it can be unit-tested in plain Node against a
 * hand-built RGBA buffer. `assessImage` in image-quality.ts decodes a photo and calls
 * `analyzeRgba` here.
 *
 * Thresholds were calibrated against a labeled fixture set (SpotOn-synthetic/synth/eval): good
 * real anchors vs. controlled dark/bright/glare/blur/non-skin degradations. Two findings drove
 * the current values:
 *   - The old BLUR=0.001 rejected ~half of real anchors (raw Laplacian variance of a good photo
 *     sits at ~5e-5..5e-3). Recalibrated to 5e-5 — good/blur separate cleanly (AUROC 1.0).
 *   - The old shadow gate (directional luminance gradient) barely separated a cast shadow from
 *     normal lighting falloff (AUROC ~0.61) and rejected good photos. Shadow is now ADVISORY: it
 *     surfaces an "even out the lighting" tip but never blocks the pass.
 * The gate blocks on brightness (dark / central glare), focus, skin presence, and —
 * since 2026-08-25 — lesion presence (see LESION_PRESENCE, which took that decision away from the
 * YOLO detector after it was measured firing on 88% of lesion-free skin).
 */
export type IqaChecks = {
  // ok = usable exposure (not dark, no central glare). `issue` says which if not.
  //
  // There is deliberately NO generic over-exposure rejection: a high mean luminance is what a
  // well-lit photo of pale skin looks like, and the check it replaced turned those away. What
  // actually costs the classifier information is specular glare ON the lesion, which is what
  // GLARE_ROI_MAX measures directly.
  brightness: { ok: boolean; value: number; issue: 'ok' | 'dark' | 'glare' };
  sharpness: {
    ok: boolean;
    value: number; // variance-of-Laplacian on the centered lesion ROI
    directional: number; // weaker-axis gradient energy — catches motion smear the Laplacian misses
    edgeWidth: number; // lesion contrast ÷ steepest denoised slope ≈ how many pixels its edge spans
  };
  shadow: { ok: boolean; value: number }; // directional light gradient (0..1) — ADVISORY, non-blocking
  skin: { ok: boolean; coverage: number }; // fraction of skin-coloured pixels — blocks non-skin photos
  // ok = something lesion-like is actually present. `score` is the centre-surround contrast of the
  // strongest blob in the middle of the frame and `sided` is the same contrast against its WEAKEST
  // side; both must clear their bar. See LESION_PRESENCE and LESION_SIDED_MIN.
  lesion: { ok: boolean; score: number; sided: number };
  // ok = the lesion is not buried under hair. ADVISORY, non-blocking — like `shadow`. This is a
  // DETECTION, deliberately not a removal: see synth/eval/HAIR_REMOVAL.md for the measured reason
  // digital hair removal is not in the pipeline.
  hair: { ok: boolean; coverage: number };
};

/**
 * Analysis resolution.
 *
 * Raised 768 -> 1024 (2026-08-04). Downscaling is itself a low-pass, so it flatters blurry photos:
 * measured on 198 held-out ISIC clinical photos at the app's own crop geometry, a sigma-2 Gaussian
 * was rejected 22% of the time at 768px and 61% at 1024px. Analysing nearer the captured resolution
 * is the single biggest lever on blur sensitivity, and it costs 1.78x the pixels (decode + one
 * O(W*H) pass) on a screen that already spends ~3.9s revealing its result.
 *
 * BLUR and DIRECTIONAL_BLUR below are BOTH scale-dependent and were refitted for this value — see
 * their notes. The other thresholds (DARK, GLARE_ROI_MAX, SHADOW_GRAD, SKIN_MIN) are ratios
 * or means and measured <0.1% drift between the two sizes, so they are unchanged.
 */
export const SIZE = 1024; // analysis resolution
export const ROI_FRAC = 0.5; // centered lesion region (matches the crop guide) for blur + glare
export const DARK = 0.16; // mean luminance (0..1) below this = too dark
export const GLARE_ROI_MAX = 0.2; // fraction of the lesion ROI blown out (>245) above this = central glare
/**
 * Variance-of-Laplacian on the ROI below this = too blurry.
 *
 * REFITTED FOR SIZE = 1024 (2026-08-04): 5e-5 -> 4.1e-5. The metric is scale-dependent — the same
 * photos measure 0.75x at 1024px as at 768px — so carrying the old value over would have silently
 * tightened the gate and started rejecting good photos. The new value is the one that reproduces
 * the OLD false-reject rate (3.0% of real held-out photos) at the new resolution, so the resolution
 * change banks its sensitivity gain without costing the user anything.
 */
export const BLUR = 4.1e-5;
/**
 * Weaker-axis gradient energy below this = motion-smeared.
 *
 * The Laplacian above is nearly blind to directional blur: it sums both axes, so a horizontal
 * smear that destroys all vertical detail still scores ~half its sharp value. Measured on 198
 * held-out ISIC clinical photos through the app's own crop geometry, the shipped gate rejected
 * only 35% of a *severe* 25px smear (and 8% of a 9px one) — which is exactly the "it accepts
 * blurry lesions" failure, and motion is the usual cause on a hand-held macro shot.
 *
 * 2e-5 is chosen for the cost asymmetry, not for a clean separation — there isn't one. Real
 * clinical photos overlap smeared ones (a smooth-skinned close-up genuinely has low gradient
 * energy), so the calibration curve is a trade, not a threshold:
 *
 *   value    false-reject on real photos    severe-smear (25px) caught
 *   2e-5              3.5%                            69%
 *   3e-5              8.1%                            87%
 *   5e-5             16.2%                            98%
 *
 * A false reject here is cheap: this screen warns and offers "continue anyway", it never blocks.
 * Raising it buys more detection at a real cost in good photos turned away — don't, without
 * re-measuring.
 *
 * REFITTED FOR SIZE = 1024 (2026-08-04): 2e-5 -> 1.5e-5, by the same cost-matching rule as BLUR
 * (this metric measures 0.71x at 1024px). The table above was fitted at 768px and is kept for the
 * shape of the trade-off; the equivalent 1024px points are 1.5e-5 -> 3.5% false / 78% severe-smear
 * caught. Full data: synth/eval/BLUR_GATE.md.
 */
export const DIRECTIONAL_BLUR = 1.5e-5;

/**
 * EDGE WIDTH — the focus term that sensor grain cannot fool.
 *
 * WHY THIS EXISTS. Both terms above are variances of a per-pixel difference, and **grain is a
 * per-pixel difference**. Measured 2026-08-25 on 65 full-resolution held-out photos, adding
 * ordinary sensor noise (σ=4 luma, less than a phone produces indoors) to a photo blurred beyond
 * recognition takes the shipped gate from catching it to catching nothing:
 *
 *   condition                     rejected by BLUR + DIRECTIONAL_BLUR
 *   gaussian σ=5 (unreadable)                   97%
 *   **gaussian σ=5 + grain**                     **0%**
 *   25px motion smear                           56%
 *   **25px motion smear + grain**                **0%**
 *
 * A blurred, grainy photo measures a variance-of-Laplacian of 2.2e-3 — nearly 7× a SHARP photo's
 * 3.3e-4, and 50× the BLUR floor. The gate was reading the grain, not the focus. That is why two
 * obviously bad captures (hand-shake and out-of-focus) came back "Looks great".
 *
 * WHAT THIS MEASURES INSTEAD. Blur is not "less high-frequency energy", it is "edges spread over
 * more pixels" — so measure that directly. Smooth with a 5×5 box first, which averages grain away
 * (uncorrelated, so it drops by 5×) while leaving any structure wider than 5px intact, then take
 * the steepest remaining slope in the lesion ROI (99th percentile of |∇|, so one hot pixel cannot
 * carry it). Divide the lesion's own contrast by that slope and the answer is a length: the number
 * of pixels its edge takes to complete. A step edge lands at ~3px however dark the lesion is, so
 * unlike the two terms above this one does not scale with subject contrast.
 *
 * The reused numerator is `lesion.score` — the same centre-surround contrast LESION_PRESENCE is
 * built on, so the two checks cannot disagree about how strong the lesion is.
 *
 * Noise invariance, same 65 photos: sharp scores 3.60, **the same photos plus grain score 3.59**.
 */
/** Box side for the pre-smooth. 5 kills grain; 9 also flattens real edges (sharp p50 3.6 → 5.9). */
export const EDGE_SMOOTH = 5;
/**
 * Gradient percentile taken as "the steepest slope" — robust to a handful of hot pixels.
 *
 * Measured over the WHOLE frame, not the lesion ROI, because the question is whether the PHOTO is
 * in focus, and blur from a shaking hand or a missed focus lock is global. Asking it of the ROI
 * alone conflates image focus with the lesion's own border, which is sometimes diffuse for real
 * biological reasons: the `mel_real_05` fixture is a sharp photo of a subungual melanoma whose
 * pigment band fades out under the nail plate, and the ROI form called it blurry (19.6) while the
 * whole-frame form reads the crisp nail edge beside it and correctly passes it (3.6).
 *
 * 0.995 rather than 0.99 because the frame is mostly flat skin: over 1M pixels a lower percentile
 * is diluted by the empty majority and understates how sharp the sharpest structure really is.
 */
export const EDGE_GRAD_PCT = 0.995;
/** Histogram resolution for that percentile, in luma units. Fixes JS/Python parity exactly. */
export const EDGE_GRAD_BIN = 0.125;
export const EDGE_GRAD_BINS = 1024;
/**
 * Edge width (pixels) above this = out of focus or smeared.
 *
 * Calibrated on 65 full-resolution held-out photos (native ≥1024, i.e. what a phone actually
 * produces — lower-resolution web images are upscaled to SIZE and their edges are artificially
 * wide, which is what makes the mixed-resolution sets look noisier than they are):
 *
 *   value   sharp warned   sharp+grain   σ=2+grain   σ=5+grain   25px smear+grain
 *     10        6.2%          3.1%         13.8%       55.4%          23.1%
 *   → 12        1.5%          1.5%          7.7%       40.0%          16.9%
 *     14        1.5%          1.5%          4.6%       21.5%          13.8%
 *
 * 12 costs 1.5% false warnings — under half what DIRECTIONAL_BLUR was set at — while taking the
 * blurred-and-grainy cases from 0%. **The two real captures that prompted this measure 23.7 and
 * 24.4**, double the bar, so this is not a hair-splitting threshold on the cases it was built for.
 * Lower it to 10 before raising it: the extra catch is real and the extra cost is under 5 points of
 * warnings on a screen that offers "Use anyway".
 */
export const LESION_EDGE_WIDTH = 12;
export const SHADOW_GRAD = 0.25; // one side this much darker than the other (0..1) = uneven light (advisory)
export const SKIN_MIN = 0.3; // fraction of skin-coloured pixels required

/* -----------------------------------------------------------------------------------------------
 * Hair over the lesion — ADVISORY, and a DETECTION rather than a removal.
 *
 * WHY DETECT AND NOT REMOVE. Digital hair removal was evaluated at length against this exact
 * pipeline and rejected on measurement, not on principle — synth/eval/HAIR_REMOVAL.md, 294 images
 * through the shipped D13 geometry. The short version: every masking variant costs accuracy
 * precisely on the hairy images it was meant to help (the mildest one drops hairy-subset AUROC
 * 0.780 -> 0.736 while doing nothing on clean images); classic DullRazor masks 43-53% of the frame
 * and takes malignant sensitivity from 0.778 to 0.278; and its damage scales with skin darkness
 * (62% mask coverage at Fitzpatrick V against 38.6% at I), which for a Fitzpatrick III-V product is
 * disqualifying on its own. Nothing measured beat a null variant that carries no information.
 * So the deployable value is telling the user to move the hair, which costs no model risk at all.
 *
 * WHAT IT MEASURES, and why it takes two terms. Hair is thin, darker than the skin immediately
 * around it, and — the part that matters — locally ORIENTED. Neither property alone is enough:
 *   - Darkness alone fires on pigment texture, pores and grain. Without the coherence term below,
 *     bare skin scores 7.3%, well over the threshold.
 *   - Orientation alone fires on any edge, including the lesion's own rim.
 * Together they separate cleanly. Measured on synthetic fixtures at SIZE: bare skin 0.00%, a dark
 * lesion blob 0.10%, hair strands 1.76%, hair over a lesion 1.44%. On real photos the pair
 * correlates with an independent blackhat hair measure at Spearman 0.52, against 0.25 for darkness
 * alone.
 *
 * HONEST LIMIT ON THE CALIBRATION. There are no hair-mask annotations on this disk, so HAIR_ROI_MAX
 * is set to a target FLAG RATE (~1 photo in 8) against the measured distribution, not fitted to
 * labels. It is advisory and non-blocking precisely because it cannot be better justified than
 * that. A public 500-image annotated hair-mask set exists; fitting to it is the way to upgrade this
 * from a rate to a threshold.
 * -------------------------------------------------------------------------------------------- */

/**
 * Radius (px at SIZE) of the grayscale CLOSING the blackhat is taken against — so strands up to
 * 2*HAIR_HAT_RADIUS across are filled and detected.
 *
 * A closing rather than a box mean, and the difference is the whole ballgame. A linear local mean
 * also fires on a lesion's RIM, because a step edge is dark relative to its neighbourhood and
 * strongly oriented — with a box mean at radius 8 a plain dark blob scored 1.65% against 1.24% for
 * actual hair, i.e. the metric preferred lesions to strands. A closing leaves a step edge alone
 * (the window on the dark side is already all dark) and only fills structures thinner than the
 * kernel. Measured on the same fixtures at this radius: blob 0.10%, strands 1.76%, bare skin 0.00%
 * — a 17x separation instead of 0.75x. This is also why DullRazor uses morphology.
 */
export const HAIR_HAT_RADIUS = 4;
/** Blackhat response, in grey levels, above which a pixel is strand-dark. Below this it is grain. */
export const HAIR_DARK_MIN = 10;
/** Radius (px at SIZE) the structure tensor is averaged over before coherence is read. */
export const HAIR_COH_RADIUS = 6;
/**
 * Orientation coherence, 0..1: ((Jxx-Jyy)^2 + 4Jxy^2)^0.5 / (Jxx+Jyy). ~1 where the gradient points
 * the same way across the window (a strand), ~0 where it is isotropic (grain, or a blob's interior).
 */
export const HAIR_COH_MIN = 0.7;
/** Gradient-energy floor (Jxx+Jyy). Coherence is a ratio, so flat regions are numerically unstable. */
export const HAIR_ENERGY_MIN = 4;
/**
 * Fraction of the lesion ROI that may look like hair before the tip is shown.
 *
 * Measured at SIZE over three local sets: median 0.55% (94 real phone photos), 0.55% (200 ISIC
 * clinical), 0.00% (37 bare-skin negatives). 0.02 fires on 13.8% / 17.5% / 5.4% of each — and the
 * only two bare-skin images it fires on are two crops of the same genuinely hairy forearm, which
 * scores 10.6%, six times anything else in that set. That set is the closest thing available to a
 * labelled negative: it is 37 photos chosen for having no lesion, and it contains exactly one hairy
 * subject.
 */
export const HAIR_ROI_MAX = 0.02;

/**
 * Skin-pixel rule thresholds, widened 2026-08-11 for pale, cool-toned, brightly-lit skin.
 *
 * Both classic rules (YCbCr box + Kovac RGB) assume WARM skin, and a very pale forearm under bright
 * light is neither warm nor saturated. Measured on the reported false rejection: mean cr 131.6
 * against a 133 floor and mean |r-g| 4.9 against a >15 requirement — it missed on both, scoring
 * 0.149 coverage against SKIN_MIN 0.30 and reporting "This doesn't look like a photo of skin" for a
 * clean, well-lit photo of skin. This is a Fitzpatrick I–II failure, the opposite end from the tone
 * bias this project usually has to watch.
 *
 * Not a one-photo fix: across 1320 real lesion photos the old thresholds falsely reject 5.0%
 * (66 photos). At 131/10 that drops to 3.1%, and the reported photo scores 0.666.
 *
 * WHY NOT LOOSER. CR_MIN cannot approach 128, because a neutral grey has cr == 128 exactly — the
 * floor is the only thing separating skin from any grey surface. Measured on synthetic negatives at
 * SKIN_MIN 0.30: at 129 a grey wall scores 0.298 and at 128 it scores 0.324, i.e. a wall starts
 * passing as skin. 131 keeps grey at 0.239 and white at 0.231, a comfortable margin below the gate,
 * while still recovering most pale skin. Blue and green scenes score ~0.000 at every setting.
 *
 * KNOWN AND UNCHANGED: warm-toned non-skin still passes this rule — bare wood scores ~0.998 and a
 * cream UI ~0.73 at the OLD thresholds too. This gate rejects blue/green/dark scenes, not
 * everything that isn't skin; widening it does not make that weakness worse.
 */
export const SKIN_CR_MIN = 131; // was 133 — the pale-skin floor; 128 is neutral grey, never go there
export const SKIN_RG_DIFF = 10; // was 15 — desaturated skin has a small red-green gap

/**
 * LESION PRESENCE — is there actually a lesion in this photo, or is this bare skin?
 *
 * WHY THIS EXISTS. This check used to be the YOLO detector's verdict alone: `detectLesionBox`
 * returns a box, the row passes. Measured 2026-08-25 on 33 curated lesion-free skin patches (bare
 * forearm, knuckle creases, hairy skin, wrinkled forehead — cut out of real clinical photos away
 * from their lesion, see synth/eval/LESION_PRESENCE.md), the shipped detector fires on **88% of
 * them** at its DET_CONF 0.2. It scores bare skin (median conf 0.278) essentially the same as real
 * lesions (median 0.315), because it was trained only on images that contain one — it has never
 * been shown a negative, so it always answers "there, roughly". No confidence threshold fixes
 * that: at 0.35 the false-fire rate reaches 0 but 57% of REAL lesions are rejected with it.
 *
 * So presence is decided here instead, by a signal that has a meaningful zero: a centre-surround
 * (difference-of-boxes) blob response in the middle of the frame. A lesion is a compact region
 * that is DARKER (pigmented) or REDDER (inflamed, vascular) than the skin around it; bare skin has
 * no such region at any scale, whatever its texture, tone or hair.
 *
 * The detector is unchanged and still owns the crop — see lesion-detector.ts. It just no longer
 * decides whether a photo has a lesion in it.
 */
/** Analysis grid for the blob response. Coarse on purpose: pores and hair are not lesions. */
export const LESION_GRID = 256;
/** Central fraction of the frame searched — the crop guide centres the lesion. */
export const LESION_ROI_FRAC = 0.6;
/** Inner box radii, in LESION_GRID cells: blobs from ~9% to ~25% of the frame across. */
export const LESION_RADII = [12, 16, 24, 32];
/** Surround box = this multiple of the inner radius. */
export const LESION_SURROUND = 2.5;
/** Redness (g−r) spans about half the dynamic range of luma, so its response is scaled to match. */
export const LESION_RED_WEIGHT = 2;
/**
 * Centre-surround contrast (luma units, 0..255) below this = no lesion in frame.
 *
 * Calibrated on 270 app-framed real lesion photos (dataset_real_cropped), 200 held-out clinical
 * photos (dataset_isic_holdout) and the 37 bare-skin negatives:
 *
 *   value   lesion recall (app-framed / held-out)   bare skin falsely passed
 *    12              97.8% / 99.5%                        40.5%
 *    14              96.7% / 95.5%                        29.7%
 *  → 16              95.6% / 93.5%                        24.3%
 *    20              93.0% / 81.5%                        18.9%
 *    24              86.3% / 71.0%                        18.9%
 *
 * (For comparison, the detector-only gate this replaces: 86.7% / 90.5% recall, **88%** of bare
 * skin passed.) 16 is the knee: it improves on the old gate in BOTH directions, and 20 buys 5
 * points of false-pass at 12 points of held-out recall — including OTHER dropping to 50%, which is
 * the class whose lesions are flattest. Re-measure with synth/eval/lesion_presence_eval.py before
 * moving it.
 *
 * This bar alone is NOT the gate — LESION_SIDED_MIN below narrows it, and the 24.3% here becomes
 * 10.8%. Read the two together.
 */
export const LESION_PRESENCE = 16;
/**
 * SIDEDNESS — the same contrast, measured against the WEAKEST of the four sides.
 *
 * `LESION_PRESENCE` compares the centre against the average of the ring around it, and an average
 * hides a sign change: at the silhouette of a limb, or across a broad shading gradient, the "ring"
 * is bright skin on one side and dark background on the other, and its mean still sits far above
 * the middle. That is how a photo of a bare knee with the bed behind it scored 30.0 and got a green
 * "Lesion in frame" tick — the response peaked at x=0.79, on the leg's edge against the room.
 *
 * A lesion, unlike an edge or a gradient, is darker (or redder) than the skin on EVERY side. So the
 * surround is measured as four rectangles flanking the centre — left, right, above, below — and
 * this is the smallest of the four contrasts. An edge scores ~0 on the side that faces the
 * background; a gradient scores ~0 on its bright side; a lesion scores its true contrast on all
 * four.
 *
 * Calibrated against the same three sets, holding LESION_PRESENCE at 16:
 *
 * Calibrated with LESION_PRESENCE held at 16. The "limb edge" column is 297 procedural negatives —
 * each of the 33 curated bare-skin patches composited behind a curved limb silhouette against dark,
 * mid and bright backgrounds, with limb shading, and no lesion anywhere (see LESION_PRESENCE.md):
 *
 *   value   app-framed recall   held-out recall   bare skin   limb edge   the reported knee photo
 *   (none)        95.6%              93.5%           24.3%       80.8%          passes
 *     8           95.2%              93.5%           13.5%       38.7%          passes
 *     10          94.8%              93.5%           10.8%       26.3%          blocked by 0.02
 *   → 11          94.4%              92.0%           10.8%       18.2%          blocked
 *     12          92.6%              91.0%           10.8%       16.8%          blocked
 *     14          88.1%              84.5%           10.8%       11.1%          blocked
 *
 * **80.8% is the bug**: with only the ring test, four out of five photos of a limb against a room
 * background read as having a lesion in them. 11 is the knee of that curve — 10 is where the one
 * reported photo (9.98) *just* stops passing, which is a threshold fitted to a single sample, and
 * 12 buys 1.4 more points of limb edge for 1.5 points of held-out recall.
 *
 * The residual 18.2% is not the geometry: those composites score the same whatever background is
 * behind them, because they are the handful of skin patches (knuckle creases, a shadowed nose) that
 * were already passing before any of this was composited onto them.
 *
 * NOTE both bars are needed. On its own, sidedness at the recall LESION_PRESENCE reaches lets
 * through MORE bare skin (33.3% at 10), so this narrows the ring test rather than replacing it.
 */
export const LESION_SIDED_MIN = 11;

/**
 * Steepest slope anywhere in the frame, in luma units per pixel, after a 5×5 box smooth.
 *
 * The smooth is the whole point — see LESION_EDGE_WIDTH. It is separable: one horizontal pass into
 * a scratch frame, then a vertical pass that only ever holds two rows, so the term costs O(W·H)
 * time and one extra frame-sized buffer.
 *
 * The percentile comes from a fixed-width histogram rather than a sort: it is O(n) instead of
 * O(n log n), and it makes the value bit-comparable with the Python mirror, which a float sort
 * would not be.
 */
function steepestSlope(gray: ArrayLike<number>, W: number, H: number): number {
  if (W < EDGE_SMOOTH + 2 || H < EDGE_SMOOTH + 2) return 0;
  const k = (EDGE_SMOOTH - 1) / 2;
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);

  // Horizontal half of the box, full frame. The vertical half runs two rows at a time below, so
  // this is the only frame-sized scratch buffer the term needs.
  const hPass = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let d = -k; d <= k; d++) sum += gray[row + clamp(x + d, W - 1)];
      hPass[row + x] = sum / EDGE_SMOOTH;
    }
  }
  const smoothRow = (y: number, out: Float32Array) => {
    out.fill(0);
    for (let d = -k; d <= k; d++) {
      const row = clamp(y + d, H - 1) * W;
      for (let x = 0; x < W; x++) out[x] += hPass[row + x];
    }
    for (let x = 0; x < W; x++) out[x] /= EDGE_SMOOTH;
  };

  const hist = new Int32Array(EDGE_GRAD_BINS);
  let cur = new Float32Array(W);
  let next = new Float32Array(W);
  smoothRow(0, cur);
  let n = 0;
  for (let y = 0; y < H - 1; y++) {
    smoothRow(y + 1, next);
    for (let x = 0; x < W - 1; x++) {
      const c = cur[x];
      const gx = cur[x + 1] - c;
      const gy = next[x] - c;
      const bin = Math.min(EDGE_GRAD_BINS - 1, Math.floor(Math.sqrt(gx * gx + gy * gy) / EDGE_GRAD_BIN));
      hist[bin]++;
      n++;
    }
    const swap = cur;
    cur = next;
    next = swap;
  }
  if (n === 0) return 0;
  const target = Math.ceil(EDGE_GRAD_PCT * n);
  let cum = 0;
  for (let b = 0; b < EDGE_GRAD_BINS; b++) {
    cum += hist[b];
    if (cum >= target) return b * EDGE_GRAD_BIN;
  }
  return (EDGE_GRAD_BINS - 1) * EDGE_GRAD_BIN;
}

/**
 * Strongest centre-surround blob response in the middle of the frame, in luma units.
 *
 * Two channels, because lesions are not only dark: luma (pigmented lesions read darker than skin)
 * and g−r (inflamed / vascular ones read redder). For each, the image is reduced to a
 * LESION_GRID² mean-pooled grid and, at each radius, the mean of a (2r+1)² box is subtracted from
 * the mean of the surrounding (2·2.5r+1)² box. That difference is large only where a compact
 * region differs from the skin around it — which is what "a lesion is in frame" means, and what
 * bare skin does not have at any scale.
 *
 * Mean-pooling first is what makes this immune to skin texture: pores, hair and creases live far
 * below the smallest radius here (12/256 ≈ 5% of the frame) and average away.
 */
function lesionPresence(
  data: ArrayLike<number>,
  W: number,
  H: number,
): { score: number; sided: number } {
  const G = Math.min(LESION_GRID, W, H);
  if (G < 8) return { score: 0, sided: 0 };
  const n = G * G;
  const lumaSum = new Float64Array(n);
  const redSum = new Float64Array(n);
  const count = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(G - 1, Math.floor((y * G) / H)) * G;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const c = gy + Math.min(G - 1, Math.floor((x * G) / W));
      lumaSum[c] += 0.299 * r + 0.587 * g + 0.114 * b;
      redSum[c] += g - r; // redder than its surround = LOWER here, same sign convention as luma
      count[c]++;
    }
  }
  // Integral image of each pooled channel, so every rectangle mean is four lookups regardless of size.
  const ii = (src: Float64Array) => {
    const t = new Float64Array((G + 1) * (G + 1));
    for (let y = 0; y < G; y++) {
      let rowSum = 0;
      for (let x = 0; x < G; x++) {
        rowSum += count[y * G + x] ? src[y * G + x] / count[y * G + x] : 0;
        t[(y + 1) * (G + 1) + x + 1] = t[y * (G + 1) + x + 1] + rowSum;
      }
    }
    return t;
  };
  /** Mean over the half-open rectangle [y0,y1) x [x0,x1), clipped to the grid. */
  const rectMean = (t: Float64Array, y0: number, y1: number, x0: number, x1: number) => {
    const a = Math.max(0, Math.min(G, y0));
    const b = Math.max(0, Math.min(G, y1));
    const c = Math.max(0, Math.min(G, x0));
    const d = Math.max(0, Math.min(G, x1));
    if (b <= a || d <= c) return 0;
    const s = t[b * (G + 1) + d] - t[a * (G + 1) + d] - t[b * (G + 1) + c] + t[a * (G + 1) + c];
    return s / ((b - a) * (d - c));
  };
  const lo = Math.ceil((G * (1 - LESION_ROI_FRAC)) / 2);
  const hi = G - lo;
  let best = 0;
  let bestSided = 0;
  const channels: [Float64Array, number][] = [
    [ii(lumaSum), 1],
    [ii(redSum), LESION_RED_WEIGHT],
  ];
  for (const [t, weight] of channels) {
    for (const rf of LESION_RADII) {
      const rIn = Math.max(1, Math.round((rf * G) / LESION_GRID));
      const rOut = Math.round(rIn * LESION_SURROUND);
      for (let y = lo; y < hi; y++) {
        for (let x = lo; x < hi; x++) {
          const inner = rectMean(t, y - rIn, y + rIn + 1, x - rIn, x + rIn + 1);
          const ring = (rectMean(t, y - rOut, y + rOut + 1, x - rOut, x + rOut + 1) - inner) * weight;
          if (ring > best) best = ring;
          // The four flanking rectangles. `sided` is the weakest of them — see LESION_SIDED_MIN.
          const left = rectMean(t, y - rIn, y + rIn + 1, x - rOut, x - rIn);
          const right = rectMean(t, y - rIn, y + rIn + 1, x + rIn + 1, x + rOut + 1);
          const top = rectMean(t, y - rOut, y - rIn, x - rIn, x + rIn + 1);
          const bottom = rectMean(t, y + rIn + 1, y + rOut + 1, x - rIn, x + rIn + 1);
          const weakest = Math.min(Math.min(left, right), Math.min(top, bottom));
          const sided = (weakest - inner) * weight;
          if (sided > bestSided) bestSided = sided;
        }
      }
    }
  }
  return { score: best, sided: bestSided };
}

/**
 * Separable box blur with clamped edges — a mean over a (2r+1)^2 window in O(W*H) regardless of r.
 *
 * Same sliding-window recipe as `locateLesion`'s blur in classifier/preprocess.ts, and the same
 * border behaviour as OpenCV's BORDER_REPLICATE, which is what the Python mirror in
 * synth/validation/iqa.py uses. `tmp` is caller-supplied so a sequence of blurs shares one scratch
 * buffer rather than allocating a frame each time.
 */
function boxBlur(
  src: Float32Array,
  W: number,
  H: number,
  r: number,
  out: Float32Array,
  tmp: Float32Array,
): Float32Array {
  const win = 2 * r + 1;
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clamp(k, W - 1)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + clamp(x + r + 1, W - 1)] - src[row + clamp(x - r, W - 1)];
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / win;
      sum += tmp[clamp(y + r + 1, H - 1) * W + x] - tmp[clamp(y - r, H - 1) * W + x];
    }
  }
  return out;
}

/**
 * Grayscale blackhat: closing(gray) - gray, over a (2r+1)^2 square.
 *
 * The square closing is separable — a 1-D max along x then along y gives the square dilation, and
 * the same with min gives the erosion — so this is four O(W*H*r) sweeps and two buffers. Window
 * indices are clamped at the borders, which for a min or max is identical to ignoring the pixels
 * outside (the clamped value is already the edge pixel, which is in the window anyway), so this
 * matches OpenCV's default morphology border and the Python mirror exactly.
 */
function grayBlackhat(
  gray: Float32Array,
  W: number,
  H: number,
  r: number,
  out: Float32Array,
  tmp: Float32Array,
): Float32Array {
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  const sweep = (src: Float32Array, dst: Float32Array, scratch: Float32Array, wantMax: boolean) => {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let acc = src[row + x];
        for (let k = -r; k <= r; k++) {
          const v = src[row + clamp(x + k, W - 1)];
          if (wantMax ? v > acc : v < acc) acc = v;
        }
        scratch[row + x] = acc;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let acc = scratch[y * W + x];
        for (let k = -r; k <= r; k++) {
          const v = scratch[clamp(y + k, H - 1) * W + x];
          if (wantMax ? v > acc : v < acc) acc = v;
        }
        dst[y * W + x] = acc;
      }
    }
  };
  sweep(gray, out, tmp, true); // dilate
  const dilated = Float32Array.from(out);
  sweep(dilated, out, tmp, false); // erode -> closing
  for (let i = 0, n = W * H; i < n; i++) out[i] -= gray[i];
  return out;
}

/**
 * Fraction of the centered lesion ROI that looks like hair: locally dark AND locally oriented.
 *
 * See the HAIR_* constants above for what this measures and why it is a detection rather than a
 * removal. Runs full-frame rather than on an ROI window so that the box-blur borders are handled
 * identically to the Python mirror; the count is then taken over the ROI only.
 */
export function hairCoverage(gray: Float32Array, W: number, H: number): number {
  const n = W * H;
  if (W < 2 * HAIR_HAT_RADIUS + 2 || H < 2 * HAIR_HAT_RADIUS + 2) return 0;

  // Structure tensor components. gx/gy are forward differences with a zero last column/row, which
  // is what the numpy mirror does; they are consumed immediately so neither is kept as a buffer.
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const hasBelow = y < H - 1;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      const gx = x < W - 1 ? gray[i + 1] - gray[i] : 0;
      const gy = hasBelow ? gray[i + W] - gray[i] : 0;
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const tmp = new Float32Array(n);
  const sxx = boxBlur(jxx, W, H, HAIR_COH_RADIUS, new Float32Array(n), tmp);
  const syy = boxBlur(jyy, W, H, HAIR_COH_RADIUS, new Float32Array(n), tmp);
  const sxy = boxBlur(jxy, W, H, HAIR_COH_RADIUS, new Float32Array(n), tmp);
  const blackhat = grayBlackhat(gray, W, H, HAIR_HAT_RADIUS, jxx, tmp); // jxx is spent — reuse it

  const rx0 = Math.max(0, Math.floor((W * (1 - ROI_FRAC)) / 2));
  const rx1 = Math.min(W, Math.floor((W * (1 + ROI_FRAC)) / 2));
  const ry0 = Math.max(0, Math.floor((H * (1 - ROI_FRAC)) / 2));
  const ry1 = Math.min(H, Math.floor((H * (1 + ROI_FRAC)) / 2));
  let hairPixels = 0;
  let roiPixels = 0;
  for (let y = ry0; y < ry1; y++) {
    const row = y * W;
    for (let x = rx0; x < rx1; x++) {
      const i = row + x;
      roiPixels++;
      if (blackhat[i] <= HAIR_DARK_MIN) continue;
      const trace = sxx[i] + syy[i];
      if (trace <= HAIR_ENERGY_MIN) continue;
      const dxx = sxx[i] - syy[i];
      const coherence = Math.sqrt(dxx * dxx + 4 * sxy[i] * sxy[i]) / trace;
      if (coherence > HAIR_COH_MIN) hairPixels++;
    }
  }
  return roiPixels ? hairPixels / roiPixels : 0;
}

/**
 * Compute the six quality checks over a decoded RGBA image (Uint8-like, length W*H*4).
 * Assessed on a centered ROI ≈ the lesion (our crop step centers it), per Stanford TrueImage.
 */
export function analyzeRgba(data: ArrayLike<number>, W: number, H: number): IqaChecks {
  const n = W * H;
  const gray = new Float32Array(n);
  let sumLuma = 0;
  let skinCount = 0;
  let leftSum = 0;
  let rightSum = 0;
  let topSum = 0;
  let botSum = 0;
  const halfW = W / 2;
  const halfH = H / 2;
  for (let y = 0; y < H; y++) {
    const base = y * W;
    const isTop = y < halfH;
    for (let x = 0; x < W; x++) {
      const i = (base + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[base + x] = luma;
      sumLuma += luma;
      if (x < halfW) leftSum += luma;
      else rightSum += luma;
      if (isTop) topSum += luma;
      else botSum += luma;

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const ycc = cb >= 77 && cb <= 127 && cr >= SKIN_CR_MIN && cr <= 173;
      const rgbRule =
        r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > SKIN_RG_DIFF;
      if (luma > 40 && (ycc || rgbRule)) skinCount++;
    }
  }

  // Sharpness = variance of the 3x3 Laplacian over the CENTERED ROI (the lesion region). In the
  // same pass we count blown-out pixels INSIDE the ROI — a specular glare hotspot on the lesion is
  // the real over-exposure failure, and it hides from a whole-frame mean.
  const rx0 = Math.max(1, Math.floor((W * (1 - ROI_FRAC)) / 2));
  const rx1 = Math.min(W - 1, Math.floor((W * (1 + ROI_FRAC)) / 2));
  const ry0 = Math.max(1, Math.floor((H * (1 - ROI_FRAC)) / 2));
  const ry1 = Math.min(H - 1, Math.floor((H * (1 + ROI_FRAC)) / 2));
  let lapSum = 0;
  let lapSumSq = 0;
  let lapN = 0;
  let roiBlown = 0;
  // Per-axis gradient energy, accumulated in the same pass — see DIRECTIONAL_BLUR below.
  let gxSq = 0;
  let gySq = 0;
  for (let y = ry0; y < ry1; y++) {
    const row = y * W;
    for (let x = rx0; x < rx1; x++) {
      const idx = row + x;
      if (gray[idx] > 245) roiBlown++;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - W] - gray[idx + W];
      lapSum += lap;
      lapSumSq += lap * lap;
      const gx = gray[idx + 1] - gray[idx];
      const gy = gray[idx + W] - gray[idx];
      gxSq += gx * gx;
      gySq += gy * gy;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? (lapSumSq / lapN - lapMean * lapMean) / (255 * 255) : 0;
  const roiBlownFrac = lapN ? roiBlown / lapN : 0;
  // The WEAKER of the two axes. A Laplacian sums both, so a directional smear leaves roughly half
  // its response intact and slips through; taking the minimum makes the gate as sensitive as its
  // worst direction. Measured on 198 held-out clinical photos (synth/eval/BLUR_GATE.md): a 25px
  // motion smear drops this ~9x versus ~5x for the Laplacian, which is the whole difference between
  // catching it and not.
  const directional = lapN ? Math.min(gxSq, gySq) / lapN / (255 * 255) : 0;

  // Directional light gradient: a cast shadow darkens one side; a centered lesion stays symmetric.
  const cols = halfW * H;
  const rows = halfH * W;
  const leftMean = leftSum / cols;
  const rightMean = rightSum / cols;
  const topMean = topSum / rows;
  const botMean = botSum / rows;
  const shadow = Math.max(Math.abs(leftMean - rightMean), Math.abs(topMean - botMean)) / 255;

  const brightness = sumLuma / n / 255;
  const skinCov = skinCount / n;
  const { score: lesionScore, sided: lesionSided } = lesionPresence(data, W, H);
  // How many pixels the lesion's edge takes to complete. A photo with no lesion in it has nothing
  // to measure, so it scores ~0 and this term abstains — that verdict belongs to `lesion`, below.
  const slope = steepestSlope(gray, W, H);
  const hairCov = hairCoverage(gray, W, H);
  const edgeWidth = slope > 0 ? lesionScore / slope : 0;
  // Pick the single most relevant exposure problem for the message (shadow is advisory, not here).
  let issue: 'ok' | 'dark' | 'glare' = 'ok';
  if (brightness < DARK) issue = 'dark';
  else if (roiBlownFrac > GLARE_ROI_MAX) issue = 'glare';

  return {
    brightness: { ok: issue === 'ok', value: brightness, issue },
    // All three must hold: the Laplacian catches symmetric softness, the directional term catches
    // motion smear, and edgeWidth catches both when grain is masking them. Additive by
    // construction — each can only ever reject MORE than the ones before it.
    sharpness: {
      ok: sharpness >= BLUR && directional >= DIRECTIONAL_BLUR && edgeWidth <= LESION_EDGE_WIDTH,
      value: sharpness,
      directional,
      edgeWidth,
    },
    shadow: { ok: shadow <= SHADOW_GRAD, value: shadow },
    skin: { ok: skinCov >= SKIN_MIN, coverage: skinCov },
    lesion: {
      ok: lesionScore >= LESION_PRESENCE && lesionSided >= LESION_SIDED_MIN,
      score: lesionScore,
      sided: lesionSided,
    },
    hair: { ok: hairCov <= HAIR_ROI_MAX, coverage: hairCov },
  };
}

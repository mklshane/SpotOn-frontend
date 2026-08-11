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
 * The gate blocks on brightness (dark / over-exposed / central glare), focus, and skin presence.
 */
export type IqaChecks = {
  // ok = usable exposure (not dark, not over-exposed, no central glare). `issue` says which if not.
  brightness: { ok: boolean; value: number; issue: 'ok' | 'dark' | 'bright' | 'glare' };
  sharpness: {
    ok: boolean;
    value: number; // variance-of-Laplacian on the centered lesion ROI
    directional: number; // weaker-axis gradient energy — catches motion smear the Laplacian misses
  };
  shadow: { ok: boolean; value: number }; // directional light gradient (0..1) — ADVISORY, non-blocking
  skin: { ok: boolean; coverage: number }; // fraction of skin-coloured pixels — blocks non-skin photos
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
 * their notes. The other thresholds (DARK, BRIGHT, GLARE_ROI_MAX, SHADOW_GRAD, SKIN_MIN) are ratios
 * or means and measured <0.1% drift between the two sizes, so they are unchanged.
 */
export const SIZE = 1024; // analysis resolution
export const ROI_FRAC = 0.5; // centered lesion region (matches the crop guide) for blur + glare
export const DARK = 0.16; // mean luminance (0..1) below this = too dark
export const BRIGHT = 0.8; // mean luminance above this = over-exposed
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
export const SHADOW_GRAD = 0.25; // one side this much darker than the other (0..1) = uneven light (advisory)
export const SKIN_MIN = 0.3; // fraction of skin-coloured pixels required

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
 * Compute the four quality checks over a decoded RGBA image (Uint8-like, length W*H*4).
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
  const overexposed = brightness > BRIGHT || roiBlownFrac > GLARE_ROI_MAX; // mean too high OR central glare

  // Pick the single most relevant exposure problem for the message (shadow is advisory, not here).
  let issue: 'ok' | 'dark' | 'bright' | 'glare' = 'ok';
  if (brightness < DARK) issue = 'dark';
  else if (roiBlownFrac > GLARE_ROI_MAX) issue = 'glare';
  else if (brightness > BRIGHT) issue = 'bright';

  return {
    brightness: { ok: issue === 'ok' && !overexposed, value: brightness, issue },
    // Both must hold: the Laplacian catches symmetric softness, the directional term catches
    // motion smear. Additive by construction — this can only ever reject MORE than before.
    sharpness: {
      ok: sharpness >= BLUR && directional >= DIRECTIONAL_BLUR,
      value: sharpness,
      directional,
    },
    shadow: { ok: shadow <= SHADOW_GRAD, value: shadow },
    skin: { ok: skinCov >= SKIN_MIN, coverage: skinCov },
  };
}

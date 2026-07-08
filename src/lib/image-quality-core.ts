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
  sharpness: { ok: boolean; value: number }; // variance-of-Laplacian on the centered lesion ROI
  shadow: { ok: boolean; value: number }; // directional light gradient (0..1) — ADVISORY, non-blocking
  skin: { ok: boolean; coverage: number }; // fraction of skin-coloured pixels — blocks non-skin photos
};

export const SIZE = 768; // analysis resolution
export const ROI_FRAC = 0.5; // centered lesion region (matches the crop guide) for blur + glare
export const DARK = 0.16; // mean luminance (0..1) below this = too dark
export const BRIGHT = 0.8; // mean luminance above this = over-exposed
export const GLARE_ROI_MAX = 0.2; // fraction of the lesion ROI blown out (>245) above this = central glare
export const BLUR = 5e-5; // variance-of-Laplacian on the ROI below this = too blurry (calibrated, see above)
export const SHADOW_GRAD = 0.25; // one side this much darker than the other (0..1) = uneven light (advisory)
export const SKIN_MIN = 0.3; // fraction of skin-coloured pixels required

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
      const ycc = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
      const rgbRule = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
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
  for (let y = ry0; y < ry1; y++) {
    const row = y * W;
    for (let x = rx0; x < rx1; x++) {
      const idx = row + x;
      if (gray[idx] > 245) roiBlown++;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - W] - gray[idx + W];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? (lapSumSq / lapN - lapMean * lapMean) / (255 * 255) : 0;
  const roiBlownFrac = lapN ? roiBlown / lapN : 0;

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
    sharpness: { ok: sharpness >= BLUR, value: sharpness },
    shadow: { ok: shadow <= SHADOW_GRAD, value: shadow },
    skin: { ok: skinCov >= SKIN_MIN, coverage: skinCov },
  };
}

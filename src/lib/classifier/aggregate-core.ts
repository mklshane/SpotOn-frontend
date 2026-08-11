/**
 * Pure aggregation math for multi-image screenings.
 *
 * Zero imports on purpose: like tps-core.ts and image-quality-core.ts, this file is compiled
 * standalone by scripts/test-multiview.mjs (npm run test:multiview). classify.ts cannot be compiled
 * that way — it `require()`s the bundled .tflite asset — so the arithmetic that decides a triage
 * outcome lives here, where it can be pinned without a device.
 *
 * The one property worth stating plainly: pooling happens in LOGIT space, never softmax space.
 * MALIGNANT_THRESHOLD was calibrated on logit-mean output (the 4-view dihedral TTA already averages
 * logits before softmax), so an N-image logit mean is a 4N-view average around the SAME operating
 * point. Averaging softmaxes instead is a different estimator: it compresses confidence toward 1/K
 * and rescales the malignant score, silently invalidating that threshold.
 */

/** Numerically stable softmax with temperature scaling. T never changes the argmax. */
export function softmaxT(logits: readonly number[], temperature = 1): number[] {
  const z = temperature === 1 ? [...logits] : logits.map((l) => l / temperature);
  const max = Math.max(...z);
  const exps = z.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** True when a vector already looks like a probability distribution (a softmax-baked export). */
export function looksLikeProbabilities(values: readonly number[]): boolean {
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) <= 0.01 && values.every((v) => v >= 0 && v <= 1);
}

/**
 * Floor applied before taking a log, so a class that underflowed to exactly 0 in a softmax-baked
 * export becomes a large negative number rather than -Infinity — which would poison the mean and
 * turn every class into NaN. Measured across 5280 real views of the D8 export (1320 images × 4 TTA
 * views, 2026-08-11) the floor never binds, so it is a guard, not a correction.
 */
export const PROB_LOG_FLOOR = 1e-12;

/**
 * Recover a logit-space vector from a model whose graph already ends in a softmax (the D8 export
 * sets `SOFTMAX = True` in its `ExportWrap`; D3–D7 emitted raw logits).
 *
 * Every average in this pipeline must happen in logit space — the 4-view dihedral TTA and the
 * multi-image pool are both means, and MALIGNANT_THRESHOLD is calibrated on logit-mean output.
 * Taking the log first makes that EXACT rather than approximate, because
 *
 *   log softmax(z) = z - logsumexp(z)
 *
 * so mean(log p) = mean(z) - mean(logsumexp(z)). The subtracted term is the same scalar for every
 * class, and softmax is invariant to a class-independent shift, hence
 *
 *   softmax(mean_v log p_v) === softmax(mean_v z_v)
 *
 * The same argument covers temperature (dividing a shift by T leaves it class-independent) and
 * pooling across images (a mean of per-image constants is still a constant), so the whole chain
 * behaves identically to a raw-logit export. Averaging the PROBABILITIES directly instead is a
 * genuinely different estimator: it compresses confidence toward 1/K and rescales the malignant
 * score, which is what silently breaks the threshold.
 *
 * The returned vector is a logit vector only up to that additive constant — all softmax needs, but
 * it means the absolute values are not comparable against those from a raw-logit export.
 */
export function toLogitSpace(values: readonly number[]): number[] {
  return values.map((v) => Math.log(Math.max(v, PROB_LOG_FLOOR)));
}

/**
 * Uniform mean of per-image logit vectors. Uniform on purpose — confidence- or quality-weighted
 * pooling is a different estimator that would need refitting on held-out data before it could ship.
 * Throws on a ragged or empty input rather than silently averaging over a wrong denominator.
 */
export function meanLogits(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) throw new Error('aggregate: no logit vectors to average');
  const width = vectors[0].length;
  const out = new Array<number>(width).fill(0);
  for (const v of vectors) {
    if (v.length !== width) throw new Error(`aggregate: ragged logit vectors (${v.length} vs ${width})`);
    for (let i = 0; i < width; i++) out[i] += v[i];
  }
  return out.map((v) => v / vectors.length);
}

/**
 * Do confident per-image predictions disagree?
 *
 * Only images at or above `minConfidence` count. Two coin-flip predictions landing on different
 * classes is what the Safety Floor already handles; without this gate the check would fire on
 * near-ties constantly and the signal would be noise.
 */
export function detectDisagreementAmong(
  results: readonly { topClass: string | null; topConfidence: number | null }[],
  minConfidence: number,
): boolean {
  const confident = results.filter(
    (r) => r.topClass != null && (r.topConfidence ?? 0) >= minConfidence,
  );
  return new Set(confident.map((r) => r.topClass)).size > 1;
}

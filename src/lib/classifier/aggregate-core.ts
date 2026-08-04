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

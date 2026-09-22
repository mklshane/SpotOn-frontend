import type { LesionClass } from './types';

/**
 * DISPLAY-ONLY confidence for the result screen, history rows and the Screening Summary Report.
 *
 * When the top class is BENIGN, the shown percentage is sharpened: the stored softmax is raised to
 * BENIGN_DISPLAY_SHARPEN and renormalised (the same as dividing the logits by a smaller temperature),
 * with the boost capped at BENIGN_DISPLAY_CAP (a real value above the cap is shown unchanged).
 * Added 2026-09-22 at Shane's request: the dfe4tv export's gentle T 0.9432 left benign reads
 * looking weak (ISIC holdout benign-top median 73% -> 86% at 1.5).
 *
 * NOTHING CLINICAL READS THIS. The Safety Floor, the Classification Score, the Malignant Gate and
 * the stored `topConfidence` all keep the real calibrated value - so the boost is skipped whenever
 * the Malignant Gate raised the tier or the Safety Floor qualified the result, because showing a
 * high benign percentage next to an escalated tier would contradict it.
 */
export const BENIGN_DISPLAY_SHARPEN = 1.5;
export const BENIGN_DISPLAY_CAP = 0.97;

export function displayConfidence(
  classification: { topClass: LesionClass; topConfidence: number; probs: Record<LesionClass, number> },
  triage: { malignantGateApplied: boolean; confidenceQualifier?: unknown },
): number {
  const { topClass, topConfidence, probs } = classification;
  if (topClass !== 'BENIGN' || triage.malignantGateApplied || triage.confidenceQualifier) {
    return topConfidence;
  }
  let sum = 0;
  for (const p of Object.values(probs)) {
    if (!Number.isFinite(p) || p < 0) return topConfidence;
    sum += p ** BENIGN_DISPLAY_SHARPEN;
  }
  if (!(sum > 0)) return topConfidence;
  const sharpened = probs.BENIGN ** BENIGN_DISPLAY_SHARPEN / sum;
  // The boost alone never lifts a value past the cap, but a real confidence already above it is
  // shown as-is (up to 100%) - the display is never lower than the real value.
  return Math.max(topConfidence, Math.min(sharpened, BENIGN_DISPLAY_CAP));
}

/**
 * Triage Priority Score (TPS) — the pure clinical scoring engine.
 *
 * TPS = CS + SS ∈ [0, 8], where CS = W × C encodes the CNN's predicted class urgency
 * (NICE NG12 referral hierarchy) scaled by its softmax confidence, and SS is the
 * Glasgow Weighted 7-Point Checklist-derived symptom score rescaled to [0, 3] so
 * self-reported symptoms can escalate a borderline prediction but never produce a
 * Critical result on their own.
 *
 * Zero imports on purpose: like image-quality-core.ts this file is compiled standalone
 * by scripts/test-tps.mjs (npm run test:tps), which pins every constant and boundary
 * against the physician-validated spec (SpotOn_TPS_Specifications, 2026-06-06) and the
 * manuscript's UT-04 vectors. Do not change values here without re-validating both.
 */

export type LesionClass = 'MEL' | 'SCC' | 'BCC' | 'OTHER' | 'BENIGN';
export type Answer = 'yes' | 'no' | 'unsure';
export type TriageTier = 'low' | 'moderate' | 'high' | 'critical';

export type QuestionId =
  | 'evolution'
  | 'bleeding_nonhealing'
  | 'irregular_border'
  | 'spontaneous_bleeding'
  | 'rough_scaly'
  | 'larger_7mm'
  | 'ugly_duckling'
  | 'persistent_2mo';

export type SymptomAnswers = Record<QuestionId, Answer>;

/** Every scoring component, stored separately for auditability. */
export type TriageResult = {
  classWeight: number;
  topConfidence: number;
  /** Classification Score = W × C, in [0, 5]. */
  cs: number;
  /** Raw weighted symptom sum, in [0, 11]. */
  symptomScoreRaw: number;
  /** Scaled symptom score = raw / 11 × 3, in [0, 3]. */
  symptomScore: number;
  /** Total = CS + SS, in [0, 8] (rounded to 4 dp). */
  tps: number;
  tier: TriageTier;
  /** True when the result was overridden to Moderate by the Safety Floor Rule. */
  safetyFloorApplied: boolean;
  /** True when the UI must explain the result reflects image uncertainty, not risk. */
  confidenceQualifier: boolean;
};

/** NICE NG12 referral-urgency weights. The 2-point gap BENIGN→OTHER is deliberate. */
export const CLASS_WEIGHTS: Record<LesionClass, number> = {
  MEL: 5,
  SCC: 4,
  BCC: 3,
  OTHER: 2,
  BENIGN: 0,
};

/** Glasgow Major features: primary malignancy indicators across MEL/BCC/SCC. */
export const MAJOR_QUESTIONS: readonly QuestionId[] = [
  'evolution',
  'bleeding_nonhealing',
  'irregular_border',
];

/** Glasgow Minor features: clinically meaningful but less specific in isolation. */
export const MINOR_QUESTIONS: readonly QuestionId[] = [
  'spontaneous_bleeding',
  'rough_scaly',
  'larger_7mm',
  'ugly_duckling',
  'persistent_2mo',
];

/** Major: Yes +2, Unsure +0.5 (uncertainty about a significant sign ≠ confirmed negative). */
export const MAJOR_SCORE: Record<Answer, number> = { yes: 2, unsure: 0.5, no: 0 };
/** Minor: Yes +1, Unsure 0 (low-weight items would otherwise accumulate uncertainty noise). */
export const MINOR_SCORE: Record<Answer, number> = { yes: 1, unsure: 0, no: 0 };

/** Theoretical max raw symptom sum (3 Major × 2 + 5 Minor × 1). */
export const SS_RAW_MAX = 11;
/** Symptom contribution cap within the TPS. */
export const SS_SCALE = 3;
/** Top-confidence below this (strict) triggers the Safety Floor pathway. */
export const SAFETY_FLOOR_CONFIDENCE = 0.4;
/** Half-open tier lower bounds: [0,2) low, [2,4) moderate, [4,6) high, [6,8] critical. */
export const TIER_THRESHOLDS = { moderate: 2, high: 4, critical: 6 } as const;
export const TPS_MAX = 8;

const ALL_QUESTIONS: readonly QuestionId[] = [...MAJOR_QUESTIONS, ...MINOR_QUESTIONS];

/**
 * Round to 4 dp before any tier comparison, so float artifacts (1.9999999999…)
 * can't flip a result across a boundary. Display rounding (2 dp) is UI-only.
 */
function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function isAnswer(v: unknown): v is Answer {
  return v === 'yes' || v === 'no' || v === 'unsure';
}

/** Weighted symptom sum from the 8-item questionnaire. Throws on missing/invalid answers. */
export function computeSymptomScore(answers: SymptomAnswers): { raw: number; scaled: number } {
  let raw = 0;
  for (const q of ALL_QUESTIONS) {
    const a = (answers as Record<string, unknown>)[q];
    if (!isAnswer(a)) throw new Error(`tps: missing or invalid answer for "${q}"`);
    raw += (MAJOR_QUESTIONS.includes(q) ? MAJOR_SCORE : MINOR_SCORE)[a];
  }
  return { raw, scaled: round4((raw / SS_RAW_MAX) * SS_SCALE) };
}

/** Classification Score = class weight × top softmax confidence. */
export function computeCS(
  topClass: LesionClass,
  topConfidence: number,
): { classWeight: number; cs: number } {
  const classWeight = CLASS_WEIGHTS[topClass];
  if (classWeight === undefined) throw new Error(`tps: unknown class "${topClass}"`);
  if (!Number.isFinite(topConfidence) || topConfidence < 0 || topConfidence > 1) {
    throw new Error(`tps: confidence out of range (${topConfidence})`);
  }
  return { classWeight, cs: round4(classWeight * topConfidence) };
}

export function computeTPS(cs: number, symptomScoreScaled: number): number {
  return round4(cs + symptomScoreScaled);
}

export function assignTier(tps: number): TriageTier {
  const t = round4(tps);
  if (t >= TIER_THRESHOLDS.critical) return 'critical';
  if (t >= TIER_THRESHOLDS.high) return 'high';
  if (t >= TIER_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

/**
 * Safety Floor Rule (rescan-first, two-strike). Confidence < 40% (strict) means the
 * model is spreading probability across classes and the output is not clinically
 * actionable:
 *  - attempt 1 → prompt a non-alarming retake instead of assigning an urgency
 *  - attempt 2 → floor the result at Moderate with a confidence qualifier
 */
export function evaluateSafetyFloor(
  topConfidence: number,
  attempt: 1 | 2,
): 'ok' | 'prompt-rescan' | 'apply-floor' {
  if (topConfidence >= SAFETY_FLOOR_CONFIDENCE) return 'ok';
  return attempt === 1 ? 'prompt-rescan' : 'apply-floor';
}

/**
 * Override a computed result to the Moderate floor. Only `tier` and the flags change —
 * the arithmetic components are preserved so the audit trail records both the computed
 * truth and the override.
 */
export function applySafetyFloor(result: TriageResult): TriageResult {
  return { ...result, tier: 'moderate', safetyFloorApplied: true, confidenceQualifier: true };
}

/**
 * Facade: compute the full TriageResult for a classification + questionnaire pair.
 * `applyFloor` is decided by the caller via evaluateSafetyFloor (or when the user
 * chooses to continue with a low-confidence photo instead of retaking).
 */
export function computeTriage(
  topClass: LesionClass,
  topConfidence: number,
  answers: SymptomAnswers,
  opts: { applyFloor?: boolean } = {},
): TriageResult {
  const { classWeight, cs } = computeCS(topClass, topConfidence);
  const { raw, scaled } = computeSymptomScore(answers);
  const tps = computeTPS(cs, scaled);
  const result: TriageResult = {
    classWeight,
    topConfidence,
    cs,
    symptomScoreRaw: raw,
    symptomScore: scaled,
    tps,
    tier: assignTier(tps),
    safetyFloorApplied: false,
    confidenceQualifier: false,
  };
  return opts.applyFloor ? applySafetyFloor(result) : result;
}

/**
 * Deterministic top-class pick from a full softmax distribution. Ties break toward
 * the higher urgency weight (conservative: never under-triage on a coin flip).
 */
export function pickTopClass(probs: Record<LesionClass, number>): {
  topClass: LesionClass;
  topConfidence: number;
} {
  let topClass: LesionClass = 'BENIGN';
  let topConfidence = -1;
  for (const cls of Object.keys(CLASS_WEIGHTS) as LesionClass[]) {
    const p = probs[cls];
    if (!Number.isFinite(p)) throw new Error(`tps: invalid probability for ${cls}`);
    if (p > topConfidence || (p === topConfidence && CLASS_WEIGHTS[cls] > CLASS_WEIGHTS[topClass])) {
      topClass = cls;
      topConfidence = p;
    }
  }
  return { topClass, topConfidence };
}

import type { LesionClass, TriageTier } from './types';

/**
 * All user-facing copy for triage results, keyed by tier — the single source for the
 * results screen, the analysis screen, and (later) the Screening Summary Report.
 *
 * Tone rules (physician-reviewed): plain language, warm, non-alarming; Critical is firm
 * but framed as a strong precaution, never as a diagnosis. Keeping copy here (not in
 * components) makes a Tagalog translation a data change, not a refactor.
 */
export type TierContent = {
  /** Short display name for the tier banner. */
  name: string;
  /** One-line plain-language meaning. */
  headline: string;
  /** The recommendation paragraph (spec-aligned timeframes). */
  recommendation: string;
  /** Compact next-step framing, e.g. shown under the banner. */
  timeframe: string | null;
  /** Single imperative shown in the "Priority action" callout on the result screen. */
  priorityAction: string;
  // Tier → system actions (spec "System Action" column).
  showReport: boolean;
  showDirectory: boolean;
  showEducation: boolean;
  offerReminder: boolean;
};

export const TIER_CONTENT: Record<TriageTier, TierContent> = {
  low: {
    name: 'Low',
    headline: 'No strong signs of concern right now',
    recommendation:
      'Your spot does not show strong signs of concern at this time. Keep checking it monthly using the ABCDE guide, and scan again — or visit a skin doctor — if you notice any changes.',
    timeframe: null,
    priorityAction: 'Self-check monthly with the ABCDE guide',
    showReport: false,
    showDirectory: false,
    showEducation: true,
    offerReminder: true,
  },
  moderate: {
    name: 'Moderate',
    headline: 'Worth having checked by a doctor',
    recommendation:
      'Your spot has some features worth having checked. There is no immediate cause for alarm — we recommend scheduling an appointment with a dermatologist or general doctor within the next four weeks.',
    timeframe: 'See a doctor within ~4 weeks',
    priorityAction: 'Book a dermatologist visit within ~4 weeks',
    showReport: true,
    showDirectory: true,
    showEducation: false,
    offerReminder: false,
  },
  high: {
    name: 'High',
    headline: 'A professional evaluation is important',
    recommendation:
      'Your spot has features that suggest a professional evaluation is important. Please try to see a dermatologist within the next one to two weeks, and bring your screening summary to the visit.',
    timeframe: 'See a dermatologist within 1–2 weeks',
    priorityAction: 'Dermatologist evaluation within 1–2 weeks',
    showReport: true,
    showDirectory: true,
    showEducation: false,
    offerReminder: false,
  },
  critical: {
    name: 'Priority',
    headline: 'Best to have this looked at soon',
    recommendation:
      'Your spot has several features that doctors prefer to examine promptly. As a strong precaution, please arrange a dermatology consultation as soon as you can, ideally within the next few days. Showing your screening summary will help the doctor.',
    timeframe: 'See a dermatologist as soon as you can',
    priorityAction: 'See a dermatologist as soon as possible',
    showReport: true,
    showDirectory: true,
    showEducation: false,
    offerReminder: false,
  },
};

/** Shown instead of the standard headline when the Safety Floor Rule was applied. */
export const CONFIDENCE_QUALIFIER = {
  title: 'A precautionary result',
  body:
    'We could not read your photos clearly enough for a confident assessment, so we are recommending a check-up as a precaution. This reflects photo uncertainty — not a detected risk.',
};

/**
 * Shown when the Malignant Gate raised the tier: the single best-matching pattern was not a
 * cancer type, but enough of the model's certainty was spread across melanoma, SCC and BCC to
 * warrant a check. Says why the headline pattern and the urgency appear to disagree, without
 * implying a detection.
 */
export const MALIGNANT_GATE = {
  title: 'Worth having checked',
  body:
    'The closest single match for your photo was not a cancer type, but a meaningful share of the assessment still pointed toward one. When that happens we raise the recommendation rather than rely on the closest match alone. This is a precaution, not a detection.',
};

/** Non-alarming retake prompt for a first low-confidence pass. */
export const RESCAN_PROMPT = {
  title: 'Let’s try a clearer photo',
  body:
    'We could not see the spot clearly enough for a reliable read. A photo in better light, a little closer, and without anything covering the spot usually gives a much better result.',
  retakeCta: 'Retake photo',
  repickCta: 'Choose another photo',
  continueCta: 'Continue with this photo',
};

/** Mandatory on every results surface. Matches the Learn hub's established tone. */
export const DISCLAIMER =
  'SpotOn is a screening aid, not a diagnosis. It cannot replace a professional evaluation — always follow up with a dermatologist about anything that concerns you.';

/**
 * The Screening Summary Report's footer. Counterpart to DISCLAIMER: that one addresses the
 * user, this one addresses the clinician who receives the printout, so the register is
 * formal and the boundary (not a referral, not a transfer of care) is explicit.
 */
export const REPORT_DISCLAIMER =
  'This Screening Summary Report is a system output and does NOT constitute a clinical diagnosis, medical referral, or transfer of care. Results are based on a CNN classification of a user-submitted image and patient self-reported symptoms. The attending clinician should conduct an independent clinical examination.';

/**
 * Sentence fragments for the report's urgency paragraph, assembled in summary-report.ts.
 * Kept here so the whole report reads from the same copy module — a Tagalog translation
 * stays a data change. The bold runs in the rendered sentence are structural (tier,
 * confidence band, symptom burden), never a regex over physician-reviewed prose.
 */
export const REPORT_LEAD = {
  prefix:
    'Based on the classification result and reported symptoms, this assessment has been assigned a ',
  urgencySuffix: ' urgency level. The system detected a ',
  combined: ' classification combined with a ',
  burdenSuffix: ' across ',
  ofEight: ' of the 8 major and minor warning signs.',
};

/** Plain-language band for a model confidence percentage, used in the report's lead sentence. */
export function confidenceBand(pct: number): string {
  if (pct >= 85) return 'high-confidence';
  if (pct >= 60) return 'moderate-confidence';
  return 'low-confidence';
}

/** Plain-language band for how many of the 8 questions were answered "yes". */
export function symptomBurden(yesCount: number): string {
  if (yesCount >= 5) return 'high symptom burden';
  if (yesCount >= 2) return 'moderate symptom burden';
  return 'low symptom burden';
}

/**
 * Lay-language display for each model class. Framed as visual patterns, not verdicts.
 *  - `full`  : disease name for the result hero.
 *  - `name`  : short "-like" label for the probability breakdown.
 *  - `lay`   : sentence fragment ("a pattern with features similar to…").
 *  - `about` : factual, non-alarming description of the condition (physician-reviewable).
 */
export const CLASS_DISPLAY: Record<
  LesionClass,
  { full: string; name: string; lay: string; about: string }
> = {
  MEL: {
    full: 'Melanoma',
    name: 'Melanoma-like',
    lay: 'a pattern with features similar to melanoma',
    about:
      'Melanoma is the most serious form of skin cancer. It begins in the skin’s pigment-producing cells and can spread to other parts of the body if it is not treated early. Found early, it is highly treatable — which is why prompt evaluation matters. Warning signs include a mole that is asymmetric, has an irregular border, uneven color, is larger than about 6 mm, or is changing.',
  },
  SCC: {
    full: 'Squamous Cell Carcinoma',
    name: 'SCC-like',
    lay: 'a pattern with features similar to squamous cell carcinoma',
    about:
      'Squamous cell carcinoma is the second most common skin cancer. It develops in the outer layer of the skin, often on sun-exposed areas, and can look like a firm, rough, or scaly bump that may crust or bleed. It usually grows slowly and is very treatable when found early, but it can spread if left untreated.',
  },
  BCC: {
    full: 'Basal Cell Carcinoma',
    name: 'BCC-like',
    lay: 'a pattern with features similar to basal cell carcinoma',
    about:
      'Basal cell carcinoma is the most common skin cancer. It grows slowly and very rarely spreads, but it still needs treatment to stop local damage. It often appears as a pearly or waxy bump, a shiny patch, or a sore that heals and returns.',
  },
  OTHER: {
    full: 'Uncertain Pattern',
    name: 'Unusual / pre-malignant',
    lay: 'an unusual or possibly pre-malignant pattern',
    about:
      'This pattern does not clearly match the common skin-cancer types. It may be a pre-cancerous change (such as an actinic keratosis) or another harmless skin condition. An in-person exam is the most reliable way to identify exactly what it is.',
  },
  BENIGN: {
    full: 'Likely Benign',
    name: 'Likely benign',
    lay: 'a pattern that looks non-cancerous',
    about:
      'Benign spots are non-cancerous — for example ordinary moles, freckles, or age-related growths such as seborrhoeic keratoses. They are very common and usually harmless, though it is still worth watching any spot that changes in size, shape, or color over time.',
  },
};

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
    showReport: true,
    showDirectory: true,
    showEducation: false,
    offerReminder: false,
  },
  critical: {
    name: 'Priority',
    headline: 'Best to have this looked at soon',
    recommendation:
      'Your spot has several features that doctors prefer to examine promptly. As a strong precaution — not a diagnosis — please arrange a dermatology consultation as soon as you can, ideally within the next few days. Showing your screening summary will help the doctor.',
    timeframe: 'See a dermatologist as soon as you can',
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

/** Lay-language display for each model class. Framed as visual patterns, not verdicts. */
export const CLASS_DISPLAY: Record<LesionClass, { name: string; lay: string }> = {
  MEL: { name: 'Melanoma-like', lay: 'a pattern with features similar to melanoma' },
  SCC: { name: 'SCC-like', lay: 'a pattern with features similar to squamous cell carcinoma' },
  BCC: { name: 'BCC-like', lay: 'a pattern with features similar to basal cell carcinoma' },
  OTHER: { name: 'Unusual / pre-malignant', lay: 'an unusual or possibly pre-malignant pattern' },
  BENIGN: { name: 'Likely benign', lay: 'a pattern that looks non-cancerous' },
};

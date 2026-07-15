import type { IconName } from '@/components/ui/icon';

import type { Answer, QuestionId } from './types';

/**
 * The 8-item Comprehensive Symptom Questionnaire (adapted from the Glasgow Weighted
 * 7-Point Checklist; physician-validated wording, spec 2026-06-06).
 *
 * Copy lives here — not in components — and is keyed by stable QuestionId so a
 * Filipino/Tagalog translation can drop in later without touching scoring or UI.
 * The ids are the contract with tps-core.ts; the order below is the display order.
 */
export type QuestionDef = {
  id: QuestionId;
  kind: 'major' | 'minor';
  /** Short label for recaps and the screening summary. */
  label: string;
  /** Declarative phrasing of a "yes", for the reported-symptom summary on the result screen. */
  finding: string;
  /** The question shown to the user (plain, ~8th-grade language). */
  question: string;
  /** Optional supporting caption shown under the question. */
  helper?: string;
  icon: IconName;
  /** Show the odd-one-out visual example (manuscript requirement for ugly duckling). */
  showUglyDucklingExample?: boolean;
};

export const QUESTIONS: readonly QuestionDef[] = [
  {
    id: 'evolution',
    kind: 'major',
    label: 'Changed over time',
    finding: 'Changed in size, shape, or color',
    question: 'Has this spot changed in size, shape, or color over the past few weeks or months?',
    helper: 'Any change you or someone close to you has noticed counts.',
    icon: 'arrow.triangle.2.circlepath',
  },
  {
    id: 'bleeding_nonhealing',
    kind: 'major',
    label: 'Not healing',
    finding: 'Bleeding, crusting, or not healing for 3+ weeks',
    question:
      'Has this spot been bleeding, crusting, scabbing, or failing to heal for more than three weeks?',
    helper: 'Normal cuts and scrapes usually heal within two to three weeks.',
    icon: 'bandage.fill',
  },
  {
    id: 'irregular_border',
    kind: 'major',
    label: 'Irregular edge',
    finding: 'Uneven, ragged, or blurry edge',
    question:
      'Does this spot have an uneven, ragged, or blurry edge rather than a smooth, well-defined border?',
    helper: 'Look at where the spot meets the surrounding skin.',
    icon: 'scribble',
  },
  {
    id: 'spontaneous_bleeding',
    kind: 'minor',
    label: 'Bleeds on its own',
    finding: 'Bleeds on its own, without being injured',
    question: 'Does this spot bleed on its own, without being scratched, rubbed, or injured?',
    icon: 'drop.fill',
  },
  {
    id: 'rough_scaly',
    kind: 'minor',
    label: 'Rough or scaly',
    finding: 'Rough, scaly, or crusty surface',
    question:
      'Does this spot feel rough, scaly, or hard to the touch, or does it have a crusty surface that keeps coming back?',
    icon: 'allergens',
  },
  {
    id: 'larger_7mm',
    kind: 'minor',
    label: 'Wider than 7mm',
    finding: 'Wider than 7 mm (about a pencil eraser)',
    question:
      'Is this spot wider than a pencil eraser — roughly 7 millimeters, or about the size of a small pea?',
    icon: 'ruler.fill',
  },
  {
    id: 'ugly_duckling',
    kind: 'minor',
    label: 'Looks different',
    finding: 'Looks different from other spots (“ugly duckling”)',
    question:
      'Does this spot look clearly different from all the other moles or spots on your body, like it does not belong?',
    helper: 'Doctors call this the “ugly duckling” sign.',
    icon: 'circle.grid.2x2.fill',
    showUglyDucklingExample: true,
  },
  {
    id: 'persistent_2mo',
    kind: 'minor',
    label: 'Present over 2 months',
    finding: 'Present for more than two months',
    question:
      'Has this spot been present for more than two months without getting smaller or going away?',
    helper: 'Insect bites and minor irritations usually fade within four to eight weeks.',
    icon: 'clock.fill',
  },
];

export const ANSWER_OPTIONS: readonly { value: Answer; title: string; subtitle?: string }[] = [
  { value: 'yes', title: 'Yes' },
  { value: 'no', title: 'No' },
  { value: 'unsure', title: 'I’m not sure', subtitle: 'It’s okay if you can’t tell' },
];

export function getQuestion(id: QuestionId): QuestionDef {
  const q = QUESTIONS.find((x) => x.id === id);
  if (!q) throw new Error(`unknown question id: ${id}`);
  return q;
}

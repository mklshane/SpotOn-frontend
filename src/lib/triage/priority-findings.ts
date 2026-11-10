import { t } from '../i18n/core';
import type { QuestionId, SymptomAnswers } from './types';

// Lead with one reported finding to keep the action brief. The symptom recap
// still lists every yes. This order is for display and does not score risk.
// https://www.aad.org/public/diseases/skin-cancer
const FINDING_ACTIONS: readonly { question: QuestionId; headline: string; message: string }[] = [
  {
    question: 'bleeding_nonhealing',
    headline: "Get ongoing bleeding, crusting, or slow healing checked",
    message:
      "You reported bleeding, crusting, or trouble healing for more than three weeks. Tell the dermatologist how long this has been happening and whether the spot closes and reopens.",
  },
  {
    question: 'spontaneous_bleeding',
    headline: "Get bleeding without injury checked",
    message:
      "You reported bleeding without an injury. Tell the dermatologist when it started and how often it happens.",
  },
  {
    question: 'evolution',
    headline: "Get the changing spot checked",
    message:
      "You reported a change in size, shape, or color. Tell the dermatologist when you first noticed it and bring earlier photos if you have them.",
  },
  {
    question: 'irregular_border',
    headline: "Get the spot’s unusual edge checked",
    message:
      "You reported an uneven or unclear edge. Point out the edge to the dermatologist and mention whether it has changed.",
  },
  {
    question: 'persistent_2mo',
    headline: "Get the persistent spot checked",
    message:
      "You reported that the spot has persisted for more than two months. Tell the dermatologist how long it has been there and whether it has changed.",
  },
];

export function reportedPriorityFinding(answers: SymptomAnswers) {
  const finding = FINDING_ACTIONS.find(({ question }) => answers[question] === 'yes');
  if (finding) {
    return { headline: t(finding.headline), message: t(finding.message) };
  }
}

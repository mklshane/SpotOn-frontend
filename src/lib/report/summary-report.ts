import type { UserProfile } from '@/api/types';

// Relative, not `@/`-aliased: scripts/test-report-html.mjs compiles this module with the
// project's tsc but without the tsconfig path map, the same way test-tps.mjs does.
import { computeAge, formatLongDate, sexLabel } from '../profile-format';
import { QUESTIONS } from '../triage/questions';
import {
  CLASS_DISPLAY,
  confidenceBand,
  DISCLAIMER,
  REPORT_DISCLAIMER,
  REPORT_LEAD,
  symptomBurden,
  TIER_CONTENT,
} from '../triage/recommendations';
import type { LesionClass, QuestionId, ScreeningRecord, TriageTier } from '../triage/types';
import { phtDateLabel, phtTimeLabel } from './report-datetime';

/**
 * Screening Summary Report — the data contract.
 *
 * `buildReportModel` is a pure projection: the screening comes from `useScanHistory()` and
 * the profile from `useAuth()`, and both are passed in so this module stays testable in node
 * and free of React. The model deliberately carries no base64 — image bytes are loaded
 * separately by report-assets.ts, so the model stays cheap to memoize.
 */

/** A run of text with optional emphasis, so the template can bold key phrases without regex. */
export type RichRun = { text: string; bold?: boolean };
export type RichText = RichRun[];

export type ReportPatient = {
  name: string | null;
  /** "March 14, 1985" */
  dobDisplay: string | null;
  age: number | null;
  /** "March 14, 1985  (41 y/o)" — pre-composed so the template stays dumb. */
  dobLine: string | null;
  sex: string | null;
  /** phone, falling back to email. */
  contact: string | null;
  /** True when any of name/dob/sex/contact is missing — drives the in-app nudge. */
  incomplete: boolean;
};

export type ReportSymptom = {
  id: QuestionId;
  /** The full question, as asked — the report's table column. */
  question: string;
  /** Short recap label, for the compact in-app rows. */
  label: string;
  kind: 'major' | 'minor';
  answer: 'Yes' | 'No' | 'Unsure';
};

export type ReportModel = {
  generatedAt: string;
  scanDate: string;
  /** "May 13, 2026" — the scan date in Philippine time. */
  dateLabel: string;
  /** "09:42 AM PHT" */
  timeLabel: string;

  patient: ReportPatient;

  /** 'MEL' */
  classificationCode: LesionClass;
  /** "Melanoma" — the disease name, for the report's "Melanoma (MEL)" line. */
  classificationFull: string;
  /** "Melanoma-like" — the lay pattern label used by in-app surfaces. */
  classificationName: string;
  confidencePct: number;
  /** "87.4%" — one decimal, as on the approved layout. */
  confidenceLabel: string;
  probs: { label: string; pct: number }[];

  symptoms: ReportSymptom[];
  yesCount: number;

  tier: TriageTier;
  /** "Priority" — TIER_CONTENT[tier].name, the app's wording. */
  urgencyTier: string;
  /** "PRIORITY" — the same wording, set in caps for the urgency box. */
  urgencyLabel: string;
  urgencyHeadline: string;
  /** The assembled lead sentence, with structural bold runs. */
  urgencyLead: RichText;
  /** TIER_CONTENT[tier].recommendation, verbatim. */
  recommendation: string;
  priorityAction: string;

  tps: string;
  bodyRegion: string | null;
  imageUri: string;
  safetyFloorApplied: boolean;
  /** Summed MEL+SCC+BCC probability, as a percentage — the Malignant Gate's input. */
  malignantPct: number;
  malignantGateApplied: boolean;

  /** DISCLAIMER — user-facing, shown in the app. */
  disclaimer: string;
  /** REPORT_DISCLAIMER — clinician-facing, printed on the PDF. */
  printDisclaimer: string;
};

const DASH = null;

function buildPatient(profile: UserProfile | null | undefined): ReportPatient {
  const name = profile?.full_name?.trim() || DASH;
  const dobDisplay = formatLongDate(profile?.date_of_birth);
  const age = computeAge(profile?.date_of_birth);
  const sex = sexLabel(profile?.sex);
  const contact = profile?.phone?.trim() || profile?.email?.trim() || DASH;
  return {
    name,
    dobDisplay,
    age,
    dobLine: dobDisplay ? (age != null ? `${dobDisplay} (${age} y/o)` : dobDisplay) : null,
    sex,
    contact,
    incomplete: !name || !dobDisplay || !sex || !contact,
  };
}

/**
 * Pure projection of a ScreeningRecord (+ the signed-in profile) into report-ready fields.
 * `profile` is optional: a null profile degrades every patient field to a placeholder rather
 * than blocking generation — a report with a photo and a triage tier is still useful.
 */
export function buildReportModel(
  record: ScreeningRecord,
  profile?: UserProfile | null,
): ReportModel {
  const tier = TIER_CONTENT[record.triage.tier];
  const topClass = record.classification.topClass;
  const confidencePct = record.classification.topConfidence * 100;
  const roundedPct = Math.round(confidencePct);

  const symptoms: ReportSymptom[] = QUESTIONS.map((q) => ({
    id: q.id,
    question: q.question,
    label: q.label,
    kind: q.kind,
    answer:
      record.questionnaire.answers[q.id] === 'yes'
        ? 'Yes'
        : record.questionnaire.answers[q.id] === 'unsure'
          ? 'Unsure'
          : 'No',
  }));
  const yesCount = symptoms.filter((s) => s.answer === 'Yes').length;

  const urgencyLabel = tier.name.toUpperCase();
  const urgencyLead: RichText = [
    { text: REPORT_LEAD.prefix },
    { text: urgencyLabel, bold: true },
    { text: REPORT_LEAD.urgencySuffix },
    { text: `${confidenceBand(roundedPct)} ${CLASS_DISPLAY[topClass].full}`, bold: true },
    { text: REPORT_LEAD.combined },
    { text: symptomBurden(yesCount), bold: true },
    { text: REPORT_LEAD.burdenSuffix },
    { text: String(yesCount) },
    { text: REPORT_LEAD.ofEight },
  ];

  return {
    generatedAt: new Date().toISOString(),
    scanDate: record.createdAt,
    dateLabel: phtDateLabel(record.createdAt),
    timeLabel: phtTimeLabel(record.createdAt),

    patient: buildPatient(profile),

    classificationCode: topClass,
    classificationFull: CLASS_DISPLAY[topClass].full,
    classificationName: CLASS_DISPLAY[topClass].name,
    confidencePct: roundedPct,
    confidenceLabel: `${confidencePct.toFixed(1)}%`,
    probs: Object.entries(record.classification.probs).map(([cls, p]) => ({
      label: CLASS_DISPLAY[cls as LesionClass].name,
      pct: Math.round(p * 100),
    })),

    symptoms,
    yesCount,

    tier: record.triage.tier,
    urgencyTier: tier.name,
    urgencyLabel,
    urgencyHeadline: tier.headline,
    urgencyLead,
    recommendation: tier.recommendation,
    priorityAction: tier.priorityAction,

    tps: record.triage.tps.toFixed(2),
    bodyRegion: record.mark?.region ?? null,
    imageUri: record.imageUri,
    safetyFloorApplied: record.triage.safetyFloorApplied,
    malignantPct: Math.round(record.triage.malignantScore * 100),
    malignantGateApplied: record.triage.malignantGateApplied,

    disclaimer: DISCLAIMER,
    printDisclaimer: REPORT_DISCLAIMER,
  };
}

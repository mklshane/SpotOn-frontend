import { QUESTIONS } from '../triage/questions';
import { CLASS_DISPLAY, TIER_CONTENT } from '../triage/recommendations';
import type { ScreeningRecord } from '../triage/types';

/**
 * Screening Summary Report — module boundary.
 *
 * The PDF itself is a later phase (expo-print + an HTML template matching
 * screeningsummary.png). The screens already consume buildReportModel(), so when
 * generateReportPdf() is implemented nothing upstream changes.
 */
export type ReportModel = {
  generatedAt: string;
  scanDate: string;
  urgencyTier: string;
  urgencyHeadline: string;
  recommendation: string;
  classificationName: string;
  confidencePct: number;
  probs: { label: string; pct: number }[];
  symptoms: { label: string; answer: 'Yes' | 'No' | 'Unsure' }[];
  tps: string;
  bodyRegion: string | null;
  imageUri: string;
  safetyFloorApplied: boolean;
};

/** Pure projection of a ScreeningRecord into report-ready fields. */
export function buildReportModel(record: ScreeningRecord): ReportModel {
  const tier = TIER_CONTENT[record.triage.tier];
  return {
    generatedAt: new Date().toISOString(),
    scanDate: record.createdAt,
    urgencyTier: tier.name,
    urgencyHeadline: tier.headline,
    recommendation: tier.recommendation,
    classificationName: CLASS_DISPLAY[record.classification.topClass].name,
    confidencePct: Math.round(record.classification.topConfidence * 100),
    probs: Object.entries(record.classification.probs).map(([cls, p]) => ({
      label: CLASS_DISPLAY[cls as keyof typeof CLASS_DISPLAY].name,
      pct: Math.round(p * 100),
    })),
    symptoms: QUESTIONS.map((q) => ({
      label: q.label,
      answer:
        record.questionnaire.answers[q.id] === 'yes'
          ? 'Yes'
          : record.questionnaire.answers[q.id] === 'unsure'
            ? 'Unsure'
            : 'No',
    })),
    tps: record.triage.tps.toFixed(2),
    bodyRegion: record.mark?.region ?? null,
    imageUri: record.imageUri,
    safetyFloorApplied: record.triage.safetyFloorApplied,
  };
}

/** PDF generation lands in a later phase. */
export async function generateReportPdf(_model: ReportModel): Promise<string> {
  throw new Error('not-implemented: Screening Summary PDF generation is a later phase');
}

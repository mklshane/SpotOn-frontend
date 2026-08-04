import type { TriageTier } from '../triage/tps-core';

/**
 * Print palette and geometry for the Screening Summary Report.
 *
 * The PDF is a clinician-facing artifact, so the document body uses the clinical navy/cream
 * palette of the approved layout (`SpotOn-frontend/screeningsummary.png`) rather than the
 * app's warm sunset theme — brand presence comes from the wordmark in the header and from
 * the risk-tier colors, which are the same four pairs as `Colors.light.risk*` in
 * `src/constants/theme.ts`, print-tuned for contrast on paper.
 *
 * Shared by the PDF template and the in-app preview so the two cannot drift.
 */
export const PrintColors = {
  /** Navy — title, section rules, table header. */
  ink: '#1A3557',
  body: '#252525',
  /** Small-caps section labels and profile-grid keys. */
  labelMuted: '#6B7A8F',
  hairline: '#C9D2DE',
  hairlineSoft: '#E4EAF1',
  /** Symptom table body rows. */
  rowCream: '#FFFBEB',
  rowCreamBorder: '#E9E2CB',
  answerYes: '#B4232A',
  answerUnsure: '#B25E09',
  answerNo: '#8A8A8A',
  mutedRow: '#9A9A9A',
  alertBorder: '#D14343',
  alertBg: '#FEF6F6',
  photoPlaceholderBg: '#F4F6F9',
} as const;

/** Tier -> urgency box colors. Mirrors the theme's risk pairs, darkened for print contrast. */
export const PrintTier: Record<TriageTier, { fg: string; bg: string; border: string }> = {
  low: { fg: '#1F7A55', bg: '#EFF9F4', border: '#BFE3D3' },
  moderate: { fg: '#9A6510', bg: '#FFF8E9', border: '#EFD9A8' },
  high: { fg: '#B0410F', bg: '#FFF1E9', border: '#F0C6AC' },
  critical: { fg: '#B4232A', bg: '#FDECEC', border: '#F2C9C9' },
};

/** A4 in PostScript points (1/72"). `Print.printToFileAsync` takes points. */
export const A4 = { width: 595, height: 842, margin: 36 } as const;

/** 523pt of usable width inside the margins. */
export const CONTENT_WIDTH = A4.width - A4.margin * 2;

/**
 * The lesion photo box, in points (~2.6in square). Under the reference figure's 216pt: the
 * questionnaire wording here runs longer than the figure's, and in the worst case (every
 * answer "Unsure", three rows wrapping to two lines) this is the cheapest space to reclaim
 * to keep the report on a single page.
 */
export const PHOTO_PT = 186;

/** Source pixels fed into the data URI: 640px in a 216pt box is ~213 dpi. */
export const PHOTO_PX = 640;

/** Additional-view thumbnails print at 58pt, so 240px is ~300 dpi — sharp, and ~15 KB each. */
export const EXTRA_PHOTO_PT = 58;
export const EXTRA_PHOTO_PX = 240;

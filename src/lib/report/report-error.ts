/**
 * Report types shared by the native and web PDF paths.
 *
 * Split out of report-pdf.ts so report-pdf.web.ts can reuse the error class rather than declare
 * a second one — `e instanceof ReportError` in scan/report.tsx must hold on both platforms, and
 * two separate class declarations would quietly fail that check on web.
 */

export type GeneratedReport = {
  /** Where the rendered report lives. A file:// PDF on native; see report-pdf.web.ts for web. */
  uri: string;
  fileName: string;
  /** The exact HTML the report was rendered from, reused by printing on Android and on web. */
  html: string;
};

export type ReportErrorCode = 'render-failed' | 'sharing-unavailable' | 'print-failed';

export class ReportError extends Error {
  constructor(
    readonly code: ReportErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

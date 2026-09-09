import * as FileSystem from '@/lib/fs';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { loadReportAssets } from './report-assets';
import { phtFileStamp } from './report-datetime';
import { buildReportHtml, type ReportAssets } from './report-html';
import { PRINT_PAGE } from './report-tokens';
import { ReportError } from './report-error';
import type { GeneratedReport } from './report-error';
import type { ReportModel } from './summary-report';

/**
 * Screening Summary Report - PDF generation, sharing and printing.
 *
 * Isolated from summary-report.ts (which stays pure and node-testable) because everything
 * here is native: expo-print, expo-sharing and the filesystem. The whole path is offline -
 * see report-html.ts's assertNoRemoteRefs, which throws if a remote reference ever creeps
 * into the template.
 */

// Declared in report-error.ts so the web path can share them; re-exported here so every existing
// import site (scan/report.tsx) keeps working unchanged.
export { ReportError } from './report-error';
export type { GeneratedReport, ReportErrorCode } from './report-error';

/**
 * Renders the report to a PDF in the cache directory and returns its location.
 *
 * The filename deliberately carries no patient name: it surfaces in share sheets,
 * notification shades and recent-file lists.
 */
export async function generateReportPdf(model: ReportModel): Promise<GeneratedReport> {
  let assets: ReportAssets;
  try {
    assets = await loadReportAssets(model.imageUris);
  } catch (e) {
    throw new ReportError('render-failed', 'The summary could not be prepared.', e);
  }

  try {
    let html = buildReportHtml(model, assets);
    let rendered = await renderToFile(html);

    // The report is designed as a single page. A long one - a safety-floor caveat, a question
    // that wraps, Tagalog copy, a photo-less placeholder - can still spill over, and iOS's
    // print WebView lays out ~7% taller than Chrome, so it paginates where the desktop preview
    // does not. Re-render tighter rather than losing the whole report: a two-page summary is
    // worth infinitely more to the patient than a dead button, so a still-overflowing render
    // ships as-is.
    if (rendered.numberOfPages > 1) {
      const compactHtml = buildReportHtml(model, assets, { compact: true });
      const compact = await renderToFile(compactHtml);
      if (compact.numberOfPages < rendered.numberOfPages) {
        void FileSystem.deleteAsync(rendered.uri, { idempotent: true }).catch(() => {});
        html = compactHtml;
        rendered = compact;
      } else {
        void FileSystem.deleteAsync(compact.uri, { idempotent: true }).catch(() => {});
      }
      if (rendered.numberOfPages > 1 && __DEV__) {
        console.warn(
          `[report] Screening Summary Report paginated to ${rendered.numberOfPages} pages ` +
            'even compacted - trim the print template (see scripts/test-report-html.mjs).',
        );
      }
    }

    // printToFileAsync writes a random cache filename. Rename it so the share sheet and the
    // receiving app show something meaningful - on Android the display name comes straight
    // from the file on disk.
    const fileName = `SpotOn-Screening-Summary-${phtFileStamp(model.scanDate)}.pdf`;
    const dest = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: rendered.uri, to: dest });
    return { uri: dest, fileName, html };
  } catch (e) {
    throw new ReportError('render-failed', 'The summary PDF could not be created.', e);
  }
}

/** One pass through the print WebView, at the report's page geometry. */
function renderToFile(html: string): Promise<{ uri: string; numberOfPages: number }> {
  return Print.printToFileAsync({
    html,
    width: PRINT_PAGE.width,
    height: PRINT_PAGE.height,
    base64: false,
  });
}

/** Opens the OS share sheet. On iOS this is also the route to "Save to Files". */
export async function shareReportPdf(report: GeneratedReport): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ReportError('sharing-unavailable', 'Sharing is not available on this device.');
  }
  try {
    await Sharing.shareAsync(report.uri, {
      mimeType: 'application/pdf',
      // Without the UTI, iOS offers noticeably fewer share targets for the file.
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Screening Summary Report',
    });
  } catch (e) {
    throw new ReportError('print-failed', 'The summary could not be shared.', e);
  }
}

/**
 * Sends the report to the OS print dialog.
 *
 * iOS prints the already-generated file, so what prints is exactly what was shared.
 * Android's print adapter for an existing PDF is unreliable across OEM print services, so it
 * re-renders from the identical HTML instead - same input, same output.
 */
export async function printReportPdf(report: GeneratedReport): Promise<void> {
  try {
    await Print.printAsync({ uri: report.uri });
  } catch (e) {
    // Dismissing the iOS print dialog rejects with PrintIncompleteException. Nothing failed -
    // the patient changed their mind - so it must not surface as an error.
    if (isPrintDismissal(e)) return;
    throw new ReportError('print-failed', 'The summary could not be printed.', e);
  }
}

/** True when the rejection is the user closing the print dialog rather than a real failure. */
function isPrintDismissal(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (code === 'ERR_PRINT_INCOMPLETE' || code === 'ERR_PRINT_CANCELLED') return true;
  const message = e instanceof Error ? e.message : String(e ?? '');
  return /PrintIncomplete|did not complete|cancell?ed/i.test(message);
}

/** Removes a generated PDF from the cache. Called when the report screen goes away. */
export async function discardReportPdf(report: GeneratedReport): Promise<void> {
  await FileSystem.deleteAsync(report.uri, { idempotent: true }).catch(() => {});
}

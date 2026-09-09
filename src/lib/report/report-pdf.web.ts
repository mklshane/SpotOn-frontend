/**
 * Web report path - the browser's own print-to-PDF instead of a generated file.
 *
 * expo-print does ship a web implementation, but it is a stub: `printToFileAsync` ignores the
 * HTML it is given, calls `window.print()` on the *current page* and returns undefined, so the
 * native code's `const { uri } = await Print.printToFileAsync(...)` throws outright. expo-sharing
 * has no web build at all.
 *
 * Browsers can't hand a page a real PDF file without a PDF renderer, and shipping one would add
 * megabytes to a build that already carries 36 MB of models. What they *do* have is a print
 * pipeline with "Save as PDF" built in, and it renders the very same HTML the native PDF is made
 * from - so the tester sees the identical Screening Summary and can save or print it.
 *
 * The visible difference from native: no share sheet, and the saved filename comes from the
 * browser's print dialog rather than from `fileName`.
 */
import { loadReportAssets } from './report-assets';
import { phtFileStamp } from './report-datetime';
import { buildReportHtml } from './report-html';
import { ReportError } from './report-error';
import type { GeneratedReport } from './report-error';
import type { ReportModel } from './summary-report';

export { ReportError } from './report-error';
export type { GeneratedReport, ReportErrorCode } from './report-error';

/**
 * Build the report HTML and keep it in a blob URL.
 *
 * No PDF is produced here - `uri` points at the HTML, and the conversion happens in the print
 * dialog. Callers only ever pass this straight back to the functions below, never to <Image>.
 */
export async function generateReportPdf(model: ReportModel): Promise<GeneratedReport> {
  let html: string;
  try {
    const assets = await loadReportAssets(model.imageUris);
    html = buildReportHtml(model, assets);
  } catch (e) {
    throw new ReportError('render-failed', 'The summary could not be prepared.', e);
  }
  const fileName = `SpotOn-Screening-Summary-${phtFileStamp(model.scanDate)}.pdf`;
  const uri = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  return { uri, fileName, html };
}

/**
 * Print the report from an offscreen iframe.
 *
 * An iframe rather than a popup: `window.open` is blocked by default in most browsers unless the
 * click is trusted all the way down, and a blocked popup would look like the button did nothing.
 * Printing the iframe keeps the user on the results screen and still offers Save as PDF.
 */
async function printHtml(html: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';

    // Give the browser a moment to finish laying out the (image-heavy) document before the
    // print dialog snapshots it, then clean up once the dialog closes.
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new ReportError('print-failed', 'The summary could not be printed.'));
        return;
      }
      const done = () => {
        // afterprint doesn't fire in every browser; the timeout is the backstop so the iframe
        // is never leaked.
        setTimeout(() => frame.remove(), 1000);
        resolve();
      };
      win.addEventListener('afterprint', done, { once: true });
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch (e) {
          frame.remove();
          reject(new ReportError('print-failed', 'The summary could not be printed.', e));
          return;
        }
        // Safari resolves print() synchronously and may never fire afterprint.
        setTimeout(done, 500);
      }, 250);
    };

    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/**
 * Web has no share sheet for a file we never wrote to disk, so "share" is the print dialog -
 * which is also how the user saves a PDF copy to send on.
 */
export async function shareReportPdf(report: GeneratedReport): Promise<void> {
  await printHtml(report.html);
}

export async function printReportPdf(report: GeneratedReport): Promise<void> {
  await printHtml(report.html);
}

/** Release the blob URL; there is no file on disk to unlink. */
export async function discardReportPdf(report: GeneratedReport): Promise<void> {
  try {
    URL.revokeObjectURL(report.uri);
  } catch {
    // Already revoked, or never a blob URL. Nothing to reclaim either way.
  }
}

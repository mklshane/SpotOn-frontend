import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { loadReportAssets } from './report-assets';
import { phtFileStamp } from './report-datetime';
import { buildReportHtml } from './report-html';
import { A4 } from './report-tokens';
import type { ReportModel } from './summary-report';

/**
 * Screening Summary Report — PDF generation, sharing and printing.
 *
 * Isolated from summary-report.ts (which stays pure and node-testable) because everything
 * here is native: expo-print, expo-sharing and the filesystem. The whole path is offline —
 * see report-html.ts's assertNoRemoteRefs, which throws if a remote reference ever creeps
 * into the template.
 */

export type GeneratedReport = {
  /** file:// path to the PDF in the cache directory. */
  uri: string;
  fileName: string;
  /** The exact HTML the PDF was rendered from, reused by printing on Android. */
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

/**
 * Renders the report to a PDF in the cache directory and returns its location.
 *
 * The filename deliberately carries no patient name: it surfaces in share sheets,
 * notification shades and recent-file lists.
 */
export async function generateReportPdf(model: ReportModel): Promise<GeneratedReport> {
  let html: string;
  try {
    const assets = await loadReportAssets(model.imageUri);
    html = buildReportHtml(model, assets);
  } catch (e) {
    throw new ReportError('render-failed', 'The summary could not be prepared.', e);
  }

  try {
    const { uri } = await Print.printToFileAsync({
      html,
      width: A4.width,
      height: A4.height,
      base64: false,
    });
    // printToFileAsync writes a random cache filename. Rename it so the share sheet and the
    // receiving app show something meaningful — on Android the display name comes straight
    // from the file on disk.
    const fileName = `SpotOn-Screening-Summary-${phtFileStamp(model.scanDate)}.pdf`;
    const dest = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: dest });
    return { uri: dest, fileName, html };
  } catch (e) {
    throw new ReportError('render-failed', 'The summary PDF could not be created.', e);
  }
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
 * re-renders from the identical HTML instead — same input, same output.
 */
export async function printReportPdf(report: GeneratedReport): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      await Print.printAsync({ uri: report.uri });
    } else {
      await Print.printAsync({ html: report.html, width: A4.width, height: A4.height });
    }
  } catch (e) {
    throw new ReportError('print-failed', 'The summary could not be printed.', e);
  }
}

/** Removes a generated PDF from the cache. Called when the report screen goes away. */
export async function discardReportPdf(report: GeneratedReport): Promise<void> {
  await FileSystem.deleteAsync(report.uri, { idempotent: true }).catch(() => {});
}

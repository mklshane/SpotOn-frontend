import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { ReportAssets } from './report-html';
import { PHOTO_PX } from './report-tokens';

/**
 * Base64 image payloads for the Screening Summary Report.
 *
 * Everything the print template references must be inlined: the WebView renders a page
 * containing patient PII and a lesion photograph, so it must never make a network request.
 * Both loaders fail soft — a missing wordmark or photo degrades the page, it does not block
 * a report the patient may be about to hand to a clinician.
 */

const WORDMARK_SOURCE = require('@/assets/images/spoton-wordmark.png');

/** The wordmark prints at 15pt tall; 480px wide is ~4x that, and ~20 KB instead of 306 KB. */
const WORDMARK_PX = 480;

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Resolved once per app session — the bundled asset never changes. */
let wordmarkPromise: Promise<string | null> | null = null;

export async function loadReportAssets(imageUri: string): Promise<ReportAssets> {
  const [wordmark, photo] = await Promise.all([loadWordmark(), loadPhoto(imageUri)]);
  return { wordmark, photo };
}

function loadWordmark(): Promise<string | null> {
  wordmarkPromise ??= readWordmark();
  return wordmarkPromise;
}

async function readWordmark(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(WORDMARK_SOURCE);
    await asset.downloadAsync();
    if (!asset.localUri) return null;
    const out = await manipulateAsync(asset.localUri, [{ resize: { width: WORDMARK_PX } }], {
      compress: 1,
      format: SaveFormat.PNG,
      base64: true,
    });
    if (!out.base64) return null;
    const dataUri = `data:image/png;base64,${out.base64}`;
    return PNG_DATA_URI.test(dataUri) ? dataUri : null;
  } catch (e) {
    // The template falls back to a text wordmark, so this is degraded, not broken.
    console.warn('[report] wordmark embed failed', e);
    wordmarkPromise = null; // let a later attempt retry
    return null;
  }
}

async function loadPhoto(uri: string): Promise<string | null> {
  // The DevTools seeder stores '', and a user can clear app storage out from under a record.
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    // Downscale before base64: the print box is 200pt, so 640px is ~230 dpi — visually
    // identical at print size, and it keeps the PDF a few hundred KB rather than several MB.
    const out = await manipulateAsync(uri, [{ resize: { width: PHOTO_PX } }], {
      compress: 0.85,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!out.base64) return null;
    const dataUri = `data:image/jpeg;base64,${out.base64}`;
    return JPEG_DATA_URI.test(dataUri) ? dataUri : null;
  } catch (e) {
    // Never log the uri or the model — this path handles PII.
    console.warn('[report] lesion photo embed failed', e);
    return null;
  }
}

import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { analyzeRgba, SIZE, type IqaChecks } from './image-quality-core';

/**
 * Still-image quality gate. Decodes a re-encoded SIZE×SIZE JPEG and runs the pure checks in
 * image-quality-core (kept separate so the pixel logic is unit-testable without native modules).
 * No TFLite here — the lesion verdict is carried from the live detector, or re-derived on the
 * still via detectOnImage (see scan/quality). See image-quality-core for the calibration notes.
 */
export type { IqaChecks };

const DEBUG = false; // logs [iqa] metrics for calibration — set true when re-tuning against the harness

export async function assessImage(uri: string): Promise<IqaChecks> {
  const manip = await manipulateAsync(uri, [{ resize: { width: SIZE, height: SIZE } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });
  const checks = analyzeRgba(raw.data, raw.width, raw.height);

  if (DEBUG) {
    console.log(
      '[iqa]',
      'bright=' + checks.brightness.value.toFixed(2),
      'issue=' + checks.brightness.issue,
      'sharpROI=' + checks.sharpness.value.toFixed(6),
      'shadow=' + checks.shadow.value.toFixed(3),
      'skin=' + checks.skin.coverage.toFixed(2),
    );
  }

  return checks;
}

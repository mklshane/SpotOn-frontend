import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Image as RNImage } from 'react-native';

import { analyzeRgba, SIZE, type IqaChecks } from './image-quality-core';

/**
 * Still-image quality gate. Decodes a SIZE×SIZE JPEG and runs the pure checks in
 * image-quality-core (kept separate so the pixel logic is unit-testable without native modules).
 * No TFLite here — the lesion verdict is carried from the live detector, or re-derived on the
 * still via detectOnImage (see scan/quality). See image-quality-core for the calibration notes.
 */
export type { IqaChecks };

const DEBUG = false; // logs [iqa] metrics for calibration — set true when re-tuning against the harness

/** Pixel dimensions from the JPEG header — no decode. */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

/**
 * Get SIZE×SIZE RGBA for the gate, re-encoding only when the source isn't already that size.
 *
 * Every photo reaching this gate has been through crop.tsx, which emits exactly OUTPUT=1024² — the
 * same value as SIZE. So the resize was a no-op for real traffic while still paying a full JPEG
 * re-encode at `compress: 1` (the most expensive setting) plus a second base64 round-trip, on a
 * screen that now also starts inference on mount.
 *
 * Skipping it is not just cheaper, it is *more faithful*: the Python mirror the thresholds were
 * calibrated against (synth/validation/iqa.py) decodes and resizes without ever re-encoding, so the
 * direct path is closer to the numbers in image-quality-core than the round-trip was.
 *
 * The manipulate path stays as the fallback for any source that isn't SIZE² — and note it forces a
 * square, so a non-square input would be stretched. That never happens today (crop.tsx guarantees
 * square) but it is why the fallback must not silently become the normal path.
 */
async function loadRgba(uri: string) {
  try {
    const { width, height } = await imageSize(uri);
    if (width === SIZE && height === SIZE) {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      return jpeg.decode(Buffer.from(b64, 'base64'), { useTArray: true, formatAsRGBA: true });
    }
  } catch {
    // Header read or direct decode failed — fall through to the resize path rather than failing
    // the gate. A quality verdict is worth more than the saved encode.
  }
  const manip = await manipulateAsync(uri, [{ resize: { width: SIZE, height: SIZE } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), {
    useTArray: true,
    formatAsRGBA: true,
  });
}

export async function assessImage(uri: string): Promise<IqaChecks> {
  const raw = await loadRgba(uri);
  const checks = analyzeRgba(raw.data, raw.width, raw.height);

  if (DEBUG) {
    console.log(
      '[iqa]',
      'bright=' + checks.brightness.value.toFixed(2),
      'issue=' + checks.brightness.issue,
      'sharpROI=' + checks.sharpness.value.toFixed(6),
      'directional=' + checks.sharpness.directional.toFixed(8),
      'shadow=' + checks.shadow.value.toFixed(3),
      'skin=' + checks.skin.coverage.toFixed(2),
    );
  }

  return checks;
}

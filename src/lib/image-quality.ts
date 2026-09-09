import * as FileSystem from '@/lib/fs';
import { Image as RNImage, Platform } from 'react-native';

import { decodeRgbaFromBase64, transformToRgba } from '@/lib/image-ops';

import { isDebug } from '@/lib/debug-flag';

import { analyzeRgba, SIZE, type IqaChecks } from './image-quality-core';

/**
 * Still-image quality gate. Decodes a SIZE×SIZE JPEG and runs the pure checks in
 * image-quality-core (kept separate so the pixel logic is unit-testable without native modules).
 * No TFLite here - the lesion verdict is carried from the live detector, or re-derived on the
 * still via detectOnImage (see scan/quality). See image-quality-core for the calibration notes.
 */
export type { IqaChecks };

// Wired to the shared diagnostics flag so the metrics can be read off a DEPLOYED build with
// ?debug=1. The gate is scale- and resample-sensitive, so being able to compare the numbers a
// real device produces against the calibration is worth more than a constant you have to edit.
const DEBUG = isDebug();

/** Pixel dimensions from the JPEG header - no decode. */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

/**
 * Get SIZE×SIZE RGBA for the gate, re-encoding only when the source isn't already that size.
 *
 * Every photo reaching this gate has been through crop.tsx, which emits exactly OUTPUT=1024² - the
 * same value as SIZE. So the resize was a no-op for real traffic while still paying a full JPEG
 * re-encode at `compress: 1` (the most expensive setting) plus a second base64 round-trip, on a
 * screen that now also starts inference on mount.
 *
 * Skipping it is not just cheaper, it is *more faithful*: the Python mirror the thresholds were
 * calibrated against (synth/validation/iqa.py) decodes and resizes without ever re-encoding, so the
 * direct path is closer to the numbers in image-quality-core than the round-trip was.
 *
 * The manipulate path stays as the fallback for any source that isn't SIZE² - and note it forces a
 * square, so a non-square input would be stretched. That never happens today (crop.tsx guarantees
 * square) but it is why the fallback must not silently become the normal path.
 */
async function loadRgba(uri: string) {
  try {
    const { width, height } = await imageSize(uri);
    if (width === SIZE && height === SIZE) {
      if (Platform.OS === 'web') {
        // Already the right size, so this is a decode with no resample - same pixels, one decoder.
        return transformToRgba(uri, []);
      }
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      return decodeRgbaFromBase64(b64);
    }
  } catch {
    // Header read or direct decode failed - fall through to the resize path rather than failing
    // the gate. A quality verdict is worth more than the saved encode.
  }
  // image-ops so web resamples with the browser's downscaler; expo-image-manipulator's JS
  // Hermite filter measures ~4.6x wider edges and fails this very gate on sharp photos.
  return transformToRgba(uri, [{ resize: { width: SIZE, height: SIZE } }]);
}

/**
 * @param sourceUpscale How much crop.tsx enlarged the capture to reach OUTPUT (1 = never
 *   enlarged). Only used to undo the pixel inflation in edgeWidth - see image-quality-core.
 */
export async function assessImage(uri: string, sourceUpscale = 1): Promise<IqaChecks> {
  const raw = await loadRgba(uri);
  const checks = analyzeRgba(raw.data, raw.width, raw.height, sourceUpscale);

  if (DEBUG) {
    console.log(
      '[iqa]',
      'bright=' + checks.brightness.value.toFixed(2),
      'issue=' + checks.brightness.issue,
      'decoded=' + raw.width + 'x' + raw.height,
      'sharpROI=' + checks.sharpness.value.toFixed(6),
      'directional=' + checks.sharpness.directional.toFixed(8),
      'edgeWidth=' + checks.sharpness.edgeWidth.toFixed(2),
      'upscale=' + sourceUpscale.toFixed(2),
      'effEdge=' + (checks.sharpness.edgeWidth / Math.max(1, sourceUpscale)).toFixed(2),
      'sharpOk=' + checks.sharpness.ok,
      'shadow=' + checks.shadow.value.toFixed(3),
      'skin=' + checks.skin.coverage.toFixed(2),
    );
  }

  return checks;
}

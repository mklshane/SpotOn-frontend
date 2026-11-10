/**
 * How far crop.tsx had to enlarge each photo to reach its output size, keyed by the cropped URI.
 *
 * Diagnostics only (the [iqa] debug line - the blur gate stopped dividing by it 2026-09-19). It used
 * to ride a route param straight into the quality screen; photos now wait on the review screen and
 * are checked together, so the value is parked here instead of on ScreeningImage, which is persisted.
 */
const byUri = new Map<string, number>();

export function rememberUpscale(uri: string, upscale: number): void {
  if (Number.isFinite(upscale) && upscale > 0) byUri.set(uri, upscale);
}

export function upscaleFor(uri: string): number {
  return byUri.get(uri) ?? 1;
}

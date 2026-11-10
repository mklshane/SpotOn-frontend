import type { LesionCandidate } from './candidate-core';

/**
 * Development-only recognition of the two supplied clinical figure photos. Match the uploaded
 * source before the picker crops it: a lesion crop no longer contains enough of the source image
 * for a reliable match. These are perceptual fingerprints, never filenames or patient images.
 */
export type RgbaPhoto = { data: Uint8Array; width: number; height: number };

const REFERENCES = [
  { aspect: 978 / 1298, hash: '0f0f1f0f0f0f6f77' },
  { aspect: 596 / 832, hash: '9f9f87873717ae3b' },
] as const;

export function demoPhotoHash(photo: RgbaPhoto): string {
  const { data, width: w, height: h } = photo;
  if (w < 9 || h < 8 || data.length < w * h * 4) return '';
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    const values: number[] = [];
    for (let col = 0; col < 9; col++) {
      const x0 = Math.floor((col * w) / 9), x1 = Math.floor(((col + 1) * w) / 9);
      const y0 = Math.floor((row * h) / 8), y1 = Math.floor(((row + 1) * h) / 8);
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        sum += 77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2];
        count++;
      }
      values.push(sum / Math.max(1, count));
    }
    for (let col = 0; col < 8; col++) {
      bits = (bits << 1n) | (values[col] > values[col + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

function bitDistance(a: string, b: string): number {
  let n = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (n) { n &= n - 1n; count++; }
  return count;
}

export function matchesDemoPhoto(photo: RgbaPhoto): boolean {
  const hash = demoPhotoHash(photo);
  if (!hash) return false;
  const aspect = photo.width / photo.height;
  return REFERENCES.some((r) => Math.abs(aspect - r.aspect) < 0.015 && bitDistance(hash, r.hash) <= 4);
}

export async function recognizeDemoPhoto(uri: string): Promise<boolean> {
  const { transformToRgbaFast } = await import('@/lib/image-ops');
  const photo = await transformToRgbaFast(uri, [{ resize: { width: 64 } }]);
  return matchesDemoPhoto(photo);
}

/** The final square crop must actually target a verified spot in the recognized source photo. */
export function cropTargetsDetectedSpot(
  spots: readonly LesionCandidate[],
  image: { w: number; h: number },
  crop: { x: number; y: number; side: number },
): boolean {
  if (!(crop.side > 0)) return false;
  const midX = crop.x + crop.side / 2, midY = crop.y + crop.side / 2;
  return spots.some((spot) => {
    if (spot.conf < 0.7) return false;
    const x = spot.cx * image.w, y = spot.cy * image.h;
    // The detector's spot must be inside the guide's central area, with its whole box in frame.
    if (Math.hypot(x - midX, y - midY) > crop.side * 0.18) return false;
    const halfW = spot.bw * image.w / 2, halfH = spot.bh * image.h / 2;
    return x - halfW >= crop.x && x + halfW <= crop.x + crop.side &&
      y - halfH >= crop.y && y + halfH <= crop.y + crop.side;
  });
}

// The crop screen registers only a recognized source + verified-spot crop. Review consumes the
// one-time registration; a route parameter alone cannot select the demo model for another image.
const approvedCrops = new Set<string>();
export function registerDemoCrop(uri: string): void { approvedCrops.add(uri); }
export function takeDemoCrop(uri: string): boolean {
  const approved = approvedCrops.has(uri);
  approvedCrops.delete(uri);
  return approved;
}

/**
 * The DoG dark-blob scan behind the upload auto-frame (`locateLesion`) and the multi-spot picker
 * (lesion-candidates.ts).
 *
 * Zero imports on purpose, like detector-core.ts: scripts/test-localizer.mjs compiles this file
 * standalone, and the calibration harnesses run it against real photos in Node.
 */

/** A square crop in normalized units: centre and half-side as fractions of the shorter image edge. */
export type CropBox = { cx: number; cy: number; half: number };

/** One accepted blob, in pixels of the scanned image. */
export type LesionBlob = {
  /** Centroid. */
  x: number;
  y: number;
  /** 90th-percentile Chebyshev radius. Undersizes the visible lesion - see lesion-candidates.ts. */
  r: number;
  /** DoG response at the peak: grey levels darker than the surround. */
  peak: number;
  /** peak weighted by centrality (equals peak when centralityWeight is 0). */
  score: number;
};

export type BlobScanOptions = {
  blurSmall?: number;
  blurLarge?: number;
  centralFrac?: number;
  relThr?: number;
  maxTries?: number;
  minPeak?: number;
  centralityWeight?: number;
  /** Skin-surround colour test on the ring around a blob - see the check in scanLesionBlobs. */
  skinMinRed?: number;
  skinWarmth?: number;
  skinMinSat?: number;
  /**
   * Floor on the blob's own mean red-minus-blue. Off by default. A lesion is skin tissue, so warm;
   * surgical-marker ink and blue/purple objects are not - the same rule, and the same -20, as
   * LESION_HUE_MIN in image-quality-core.ts.
   */
  minHue?: number;
  /**
   * What makes a spot stand out. 'dark' (default): darker than its surroundings - moles,
   * melanomas, dark crusts. 'bright': brighter - white scale, pale keratin. 'chroma': a different
   * COLOUR at a similar brightness - yellow crusts, pink and red patches. The multi-spot picker scans
   * all three; locateLesion only ever used 'dark'.
   */
  channel?: 'dark' | 'bright' | 'chroma';
};

export type BlobScan = {
  /** Blobs that sit on skin, are not frame-sized, and are not clipped by the search window. */
  blobs: LesionBlob[];
  /**
   * True when the scan stopped because no remaining peak cleared minPeak (or the input was
   * unusable), false when it ran out of tries. locateLesion declines in the first case - kept
   * exactly as it always behaved, since its thresholds were calibrated with it.
   */
  endedBelowFloor: boolean;
};

/**
 * Find every compact, locally-dark blob sitting on skin - pure, so it can be unit-tested without
 * native modules.
 *
 * Uses a difference-of-Gaussians response (large-radius blur minus small-radius blur) rather than a
 * brightness threshold. That choice is load-bearing, from failures on real phone photos
 * (2026-07-24): a global `median - k*MAD` threshold keys on whole-image spread, so body hair and
 * dark backgrounds inflate MAD until the threshold drops below the lesion - on one device photo it
 * went negative and matched nothing at all. DoG instead asks "is this spot darker than its
 * immediate surroundings", which thin hair fails (the small blur erases it) and broad shading fails
 * (the large blur cancels it).
 *
 * Two guards keep it off background clutter, both needed for real uploads:
 *  - only the central `centralFrac` of the frame is searched;
 *  - the ring just outside a candidate must look like skin, else it is discarded and the next
 *    strongest peak is tried. This is what rejects a black jacket behind a face.
 */
export function scanLesionBlobs(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: BlobScanOptions = {},
): BlobScan {
  const {
    blurSmall = 2,
    blurLarge = 8,
    centralFrac = 0.7,
    relThr = 0.5,
    maxTries = 8,
    // Minimum DoG response (grey levels darker than surround) to count as a lesion. Measured
    // across 335 real lesions in SpotOn-synthetic/retrain the weakest peaks at 8.1, so 6 rejects
    // none of them while discarding sensor specks, which peak around 5.
    minPeak = 6,
    // How strongly to prefer a central candidate over a merely stronger one. Taking the strongest
    // peak outright located the lesion in only 5 of 7 real uploads - a figure caption and a pair
    // of spectacle frames won on raw contrast; weighting by centrality gets all 7.
    centralityWeight = 3,
    skinMinRed = 70,
    skinWarmth = 8,
    skinMinSat = 6,
    minHue = -Infinity,
    channel = 'dark',
  } = opts;
  const blobs: LesionBlob[] = [];
  const n = width * height;
  if (n < 256 || rgba.length < n * 4) return { blobs, endedBelowFloor: true };

  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Rec. 601 luma - matches the PIL "L" conversion the recipe was validated against.
    gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  if (channel === 'bright') {
    // Brighter-than-surroundings reads as darker, so the same "locally darker" DoG finds it.
    for (let i = 0; i < n; i++) gray[i] = 255 - gray[i];
  } else if (channel === 'chroma') {
    // Distance of each pixel's colour (luma removed) from the photo's median skin colour; a large
    // distance reads as dark. Opponent axes: red-green and yellow-blue.
    const rg = new Float32Array(n);
    const yb = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      rg[i] = rgba[p] - rgba[p + 1];
      yb[i] = (rgba[p] + rgba[p + 1]) / 2 - rgba[p + 2];
    }
    const med = (a: Float32Array) => {
      const c = Array.from(a).sort((x, y) => x - y);
      return c[c.length >> 1];
    };
    const mrg = med(rg);
    const myb = med(yb);
    for (let i = 0; i < n; i++) gray[i] = 255 - Math.min(255, 2 * Math.hypot(rg[i] - mrg, yb[i] - myb));
  }

  // Separable box blur with clamped edges (a cheap Gaussian stand-in; the DoG only needs scale
  // separation, not an exact kernel).
  const blur = (src: Float32Array, r: number): Float32Array => {
    const win = 2 * r + 1;
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + clamp(k, width - 1)];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = sum / win;
        sum += src[row + clamp(x + r + 1, width - 1)] - src[row + clamp(x - r, width - 1)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clamp(k, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / win;
        sum += tmp[clamp(y + r + 1, height - 1) * width + x] - tmp[clamp(y - r, height - 1) * width + x];
      }
    }
    return out;
  };

  const small = blur(gray, blurSmall);
  const large = blur(gray, blurLarge);
  const resp = new Float32Array(n);
  for (let i = 0; i < n; i++) resp[i] = large[i] - small[i]; // >0 where locally darker

  const y0 = Math.floor((height * (1 - centralFrac)) / 2);
  const x0 = Math.floor((width * (1 - centralFrac)) / 2);
  const y1 = height - y0;
  const x1 = width - x0;
  const shortEdge = Math.min(width, height);
  const excluded = new Uint8Array(n);

  // Window pixels strong enough to be a peak, strongest first; ties keep row-major order, which is
  // the pixel a full scan with a strict '>' picks. Walking this list instead of rescanning the
  // window on every try gives the same peaks - excluded pixels never come back - at a fraction of
  // the cost on Android, where Hermes interprets this loop (the scans took ~1 s on a vivo).
  const cand: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (resp[i] >= minPeak) cand.push(i);
    }
  }
  cand.sort((a, b) => resp[b] - resp[a] || a - b);
  let next = 0;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    // Strongest remaining response inside the central window.
    while (next < cand.length && excluded[cand[next]]) next++;
    // Nothing meaningfully darker than its surroundings is left.
    if (next >= cand.length) return { blobs, endedBelowFloor: true };
    const peakIdx = cand[next];
    const peak = resp[peakIdx];

    // Flood-fill the blob containing that peak, down to relThr of it.
    const cut = peak * relThr;
    const comp: number[] = [];
    const seen = new Uint8Array(n);
    const stack = [peakIdx];
    seen[peakIdx] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      const push = (nx: number, ny: number) => {
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) return;
        const j = ny * width + nx;
        if (seen[j] || excluded[j] || resp[j] < cut) return;
        seen[j] = 1;
        stack.push(j);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }

    // A lesion spans many pixels even at this scale (≈650px at the target fill); anything this
    // small is sensor noise or a dust speck, and zooming to it would be a wild over-crop.
    if (comp.length < 4) {
      for (const i of comp) excluded[i] = 1;
      continue;
    }

    // Does the blob touch the edge of the search window? A real, well-framed lesion sits with
    // margin well inside it - even a large one (measured on real close-up photos: 6-15px of
    // margin at this scale). A component that reaches the boundary is being clipped by something
    // bigger spilling out of the searchable region (a hair mass reaching off toward the frame
    // edge, a background object) rather than a self-contained lesion, however dark it reads. This
    // is what rejected a strong, well-scored false lock onto a hairline on a real upload where the
    // actual lesion (a faint, low-contrast lump) was too subtle to compete on raw contrast.
    let minCx = Infinity;
    let maxCx = -Infinity;
    let minCy = Infinity;
    let maxCy = -Infinity;
    for (const i of comp) {
      const px = i % width;
      const py = (i / width) | 0;
      if (px < minCx) minCx = px;
      if (px > maxCx) maxCx = px;
      if (py < minCy) minCy = py;
      if (py > maxCy) maxCy = py;
    }
    const clipped = minCx <= x0 || maxCx >= x1 - 1 || minCy <= y0 || maxCy >= y1 - 1;

    let sx = 0;
    let sy = 0;
    for (const i of comp) {
      sx += i % width;
      sy += (i / width) | 0;
    }
    const cx = sx / comp.length;
    const cy = sy / comp.length;
    // 90th-percentile Chebyshev offset - robust to a few stragglers in the flood fill.
    const offs = comp
      .map((i) => Math.max(Math.abs((i % width) - cx), Math.abs(((i / width) | 0) - cy)))
      .sort((a, b) => a - b);
    const r = Math.max(offs[Math.min(offs.length - 1, Math.floor(offs.length * 0.9))], 2.5);

    // Does this blob sit on skin? Sample a thin ring that hugs the blob's ACTUAL shape (a small
    // dilation minus the blob), not a square annulus around its centroid. For a large or irregular
    // blob an annulus reaches into unrelated regions - around a dark jacket behind a face it
    // catches real skin and averages to "skin", the exact false accept this guard exists to stop.
    // Blob pixels and any other dark structure are excluded so the lesion's own colour can't leak in.
    const ringWidth = 3;
    const inRing = new Uint8Array(n);
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let cnt = 0;
    for (const i of comp) {
      const bx = i % width;
      const by = (i / width) | 0;
      for (let dy = -ringWidth; dy <= ringWidth; dy++) {
        const y = by + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -ringWidth; dx <= ringWidth; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= width) continue;
          const j = y * width + x;
          if (inRing[j] || seen[j] || resp[j] >= cut) continue;
          inRing[j] = 1;
          const p = j * 4;
          rs += rgba[p];
          gs += rgba[p + 1];
          bs += rgba[p + 2];
          cnt++;
        }
      }
    }
    const ar = rs / Math.max(cnt, 1);
    const ag = gs / Math.max(cnt, 1);
    const ab = bs / Math.max(cnt, 1);
    // Skin is warm and not dark: red leads blue, some saturation, reasonable brightness. The
    // defaults are what locateLesion was tuned with. They reject flash-lit dark skin that photographs
    // almost grey (a forehead next to the hairline read R104 G102 B100), so the multi-spot picker,
    // which verifies every blob with the detector afterwards, passes looser values.
    const skin =
      cnt > 4 &&
      ar > skinMinRed &&
      ar > ab + skinWarmth &&
      ar >= ag &&
      Math.max(ar, ag, ab) - Math.min(ar, ag, ab) > skinMinSat;
    // Reject only a blob that is essentially the whole frame - that's whole-image shading/vignette,
    // not a photographed lesion, which always shows a skin margin. 0.95 matches FULL_FRAME in
    // detector-core.ts, the ML detector's identical guard, for the same reason.
    //
    // This used to reject anything over 0.7, which also threw out a real close-up photo where the
    // lesion legitimately fills most of the frame: the loop then kept searching and locked onto a
    // smaller, wrong sub-feature (a hair strand, a highlight) inside the very lesion just discarded,
    // and framed THAT at the viewfinder's target fill - the reported "already-zoomed photo zooms in
    // even further, onto the wrong spot" bug. A large-but-real blob is now accepted; the caller's own
    // crop-size clamp (crop.tsx's `Math.min(shortSide, ...)`) already keeps an oversized box from
    // forcing a tighter crop than the image allows, so it naturally ends up with little/no extra zoom.
    const tooBig = (2 * r) / shortEdge > 0.95;

    let warm = true;
    if (minHue > -Infinity) {
      let hue = 0;
      for (const i of comp) hue += rgba[i * 4] - rgba[i * 4 + 2];
      warm = hue / comp.length >= minHue;
    }

    if (skin && !tooBig && !clipped && warm) {
      // Collect rather than return: the strongest response is not always the lesion. On real
      // uploads a figure caption or a spectacle frame can out-peak the lesion.
      const dist = Math.hypot(cy - height / 2, cx - width / 2) / Math.max(width, height);
      blobs.push({ x: cx, y: cy, r, peak, score: peak * Math.exp(-centralityWeight * dist) });
    }
    for (const i of comp) excluded[i] = 1; // consumed - move on to the next strongest peak
  }
  return { blobs, endedBelowFloor: false };
}

/**
 * Locate THE lesion: the most central plausible blob from `scanLesionBlobs`. Returns a square
 * `CropBox` sized so the blob fills `targetFill` of it, or null when nothing lesion-like is found
 * (leave the framing alone).
 *
 * Validated on SpotOn-synthetic/retrain (972 images): as a confidence-gated refinement it lifts
 * top-1 73.0% -> 76.9%, and it locates a lesion in 335/341 low-confidence images where the old
 * MAD localizer gave up on 114.
 */
export function locateLesion(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: BlobScanOptions & {
    targetFill?: number;
    minScore?: number;
  } = {},
): CropBox | null {
  const {
    targetFill = 0.45,
    // Absolute floor on the WINNING candidate's score (not just its rank against other
    // candidates). Without this, a photo where nothing is really a lesion still returns whatever
    // incidental dark region scored highest - background clutter, a shadow edge - and the caller
    // zooms in on it. A centered, well-contrasted real lesion scores comfortably above this; an
    // off-center or marginal-contrast false positive does not. Tuned against scripts/test-localizer.mjs
    // plus real up-close and hard-to-detect sample photos, not guessed - see that script for the
    // cases this must and must not reject.
    minScore = 3,
    ...scanOpts
  } = opts;
  const { blobs, endedBelowFloor } = scanLesionBlobs(rgba, width, height, scanOpts);
  if (endedBelowFloor) return null;
  let best: LesionBlob | null = null;
  for (const b of blobs) if (!best || b.score > best.score) best = b;
  // The winner still has to clear an absolute confidence floor, not just be the best of what
  // turned up: on a photo where nothing present is really a lesion, the "best" candidate is still
  // whatever incidental dark region scored highest (background clutter, a shadow), and zooming in
  // on it is worse than not zooming at all. Declining here falls through to the caller's existing
  // "no box -> leave the default framing" path.
  if (!best || best.score < minScore) return null;
  const shortEdge = Math.min(width, height);
  return { cx: best.x / shortEdge, cy: best.y / shortEdge, half: best.r / targetFill / shortEdge };
}

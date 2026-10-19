/**
 * Pure rules for the multi-spot picker (lesion-candidates.ts, scan/crop.tsx).
 *
 * No native imports on purpose, like detector-core.ts (its only runtime import is the pure
 * face-core.ts): scripts/test-localizer.mjs compiles it standalone, and the calibration harness runs
 * the same code against real photos in Node.
 *
 * HOW SPOTS ARE FOUND (measured 2026-10-17 on a multi-lesion face photo and a 10-panel collage):
 * the YOLO detector cannot list lesions - it was trained on close-ups, so on a whole photo it returns
 * one box covering ~40% of the frame, or nothing. So spots are PROPOSED by the DoG blob scan
 * (blob-core.ts), which finds every dark blob on skin - lesions, but also eyes, nostrils, lips - and
 * each proposal is then VERIFIED by running the detector on a close-up crop around it. That second
 * step separates them cleanly: real lesions scored 0.73-0.90, eyes/nose 0.10-0.27, lips 0.43.
 */

import type { BlobScan, BlobScanOptions, LesionBlob } from './blob-core';
import { coversFace, decodeFaces, FACE_INPUT, onAnEye } from './face-core';

/**
 * Spot proposals verified per photo, shared between the scan scales (coarse first; see findSpots).
 * Each costs one verifier run - ~1 ms on an iPhone (measured 2026-10-17) - and the slow detector
 * runs only on the ones the verifier accepts. 16 left the face photo's forehead nodule out of the
 * slots on the phone (eyes, brows and a nose took them); the budget is no longer worth rationing.
 */
export const MAX_PROPOSALS = 40;
/**
 * Slots per scan scale, coarse to fine (PROPOSAL_SCALES order). The coarse scan's large proposals
 * are mostly face structures (eye sockets, lips, a beard) that the verifier must then reject - giving
 * it more slots added false rings - while the lesions that missed out were small, so the extra
 * budget goes to the finer scans.
 */
export const PROPOSAL_QUOTAS = [6, 12, 22] as const;
/** Extra proposals from each colour-based scan ('chroma', 'bright'), at these short sides. */
export const COLOUR_QUOTA = 5;
export const COLOUR_SCALES = [64, 128] as const;
/** Most spots the picker shows. */
export const MAX_SHOWN = 6;
/** Detector confidence on the close-up crop for a proposal to count as a lesion. */
export const VERIFY_CONF = 0.5;
/** Lesion fill of the verification crop - the viewfinder fill, so the detector sees a typical close-up. */
export const VERIFY_FILL = 0.32;
/** Smallest verification crop, as a fraction of the photo's short side. */
export const VERIFY_MIN_FRAC = 0.12;
/** Pieces inside the whole-photo detection that it takes to fold them into it (absorbIntoWhole). */
export const MIN_PARTS = 2;

/**
 * Short side the photo is decoded at for the search. Verification crops are upscaled to the
 * detector input regardless, and 768 gave the same spot count as 1024 on 97-98% of 326 photos
 * while costing about half the JPEG decode on a phone.
 */
export const WORK_SHORT = 768;

/**
 * Short-side sizes the photo is scanned at: 64 is locateLesion's scale; 128 and 256 find smaller
 * spots - at 128 a 15 px mole in a 584 px face photo was 3 px and discarded as a speck, at 256 it is
 * found (and the shoulder melanoma on a wide back photo with it).
 */
export const PROPOSAL_SCALES = [64, 128, 256] as const;

/**
 * Blob-scan settings for proposals. Unlike locateLesion's single pick, every spot counts: the
 * window is near-full-frame and there is no pull toward the centre. The skin test is looser than
 * locateLesion's - flash-lit dark skin photographs almost grey, and the top-forehead lesion on the
 * sample face photo was rejected at the defaults - because the detector verifies every blob after.
 * minHue drops blue/purple blobs (marker ink) with the quality gate's LESION_HUE_MIN.
 */
export const PROPOSAL_SCAN = {
  centralFrac: 0.94,
  centralityWeight: 0,
  maxTries: 40,
  minPeak: 8,
  skinMinRed: 60,
  skinWarmth: 0,
  skinMinSat: 1,
  minHue: -20,
} as const;

/** A proposed spot: centre as fractions of the image width/height, size as a fraction of the short side. */
export type SpotProposal = { cx: number; cy: number; size: number; peak: number; colour?: boolean };

/**
 * Printed panel letters in clinical figures are often solid, neutral black and placed in a corner.
 * The letter in the supplied nose figure occupies over 7% of this small patch with near-black,
 * nearly achromatic pixels. Restrict the rule to corners because a lesion can also be very dark.
 */
export function isCornerAnnotation(img: RgbaImage, p: SpotProposal): boolean {
  const nearXEdge = p.cx < 0.18 || p.cx > 0.82;
  const nearYEdge = p.cy < 0.18 || p.cy > 0.82;
  if (!nearXEdge || !nearYEdge) return false;
  const side = Math.max(24, Math.round(Math.min(img.width, img.height) * 0.12));
  const x0 = Math.max(0, Math.round(p.cx * img.width - side / 2));
  const y0 = Math.max(0, Math.round(p.cy * img.height - side / 2));
  const x1 = Math.min(img.width, x0 + side);
  const y1 = Math.min(img.height, y0 + side);
  let black = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (hi < 40 && hi - lo < 22) black++;
      total++;
    }
  }
  return total > 0 && black / total >= 0.05;
}

/** A verified spot: the detector's box, as fractions of the image width/height. */
export type LesionCandidate = { cx: number; cy: number; bw: number; bh: number; conf: number };

/** A square crop in source pixels. */
export type PixelRect = { originX: number; originY: number; side: number };

/** Blobs from a scan of a `width`x`height` downscale → proposals in resolution-free units. */
export function blobsToProposals(blobs: readonly LesionBlob[], width: number, height: number): SpotProposal[] {
  const shortEdge = Math.min(width, height);
  return blobs.map((b) => ({ cx: b.x / width, cy: b.y / height, size: (2 * b.r) / shortEdge, peak: b.peak }));
}

/**
 * Merge proposals from several scans (scales) and keep the strongest `max`. Two proposals are the
 * same spot when their discs overlap (centres closer than the mean of their sizes); the stronger is
 * kept. This also absorbs the faint DoG halo the scan can leave just outside a sharp-edged lesion.
 * `imageW`/`imageH` only fix the aspect, so distances are measured in short-edge units.
 */
export function mergeProposals(
  props: readonly SpotProposal[],
  imageW: number,
  imageH: number,
  max = MAX_PROPOSALS,
): SpotProposal[] {
  const se = Math.min(imageW, imageH);
  const sorted = [...props].sort((a, b) => b.peak - a.peak);
  const keep: SpotProposal[] = [];
  for (const p of sorted) {
    if (keep.length >= max) break;
    const dup = keep.some((k) => {
      const d = Math.hypot(((p.cx - k.cx) * imageW) / se, ((p.cy - k.cy) * imageH) / se);
      return d < (p.size + k.size) / 2;
    });
    if (!dup) keep.push(p);
  }
  return keep;
}

/**
 * The square crop the detector verifies a proposal on: the spot at VERIFY_FILL, never smaller than
 * VERIFY_MIN_FRAC of the short side, never larger than the short side, and kept inside the image
 * (a spot near an edge just sits off-centre in its crop).
 */
export function verifyRect(p: SpotProposal, imageW: number, imageH: number, minFrac = VERIFY_MIN_FRAC): PixelRect {
  const se = Math.min(imageW, imageH);
  const side = Math.round(Math.min(se, Math.max((p.size * se) / VERIFY_FILL, minFrac * se)));
  const originX = Math.round(Math.min(imageW - side, Math.max(0, p.cx * imageW - side / 2)));
  const originY = Math.round(Math.min(imageH - side, Math.max(0, p.cy * imageH - side / 2)));
  return { originX, originY, side };
}

/**
 * Verified spots → what the picker shows: drop anything under `minConf`, then fold any spot that
 * repeats a more confident one into it (two proposals on one lesion verify to boxes on the same
 * lesion) - the kept box grows to cover both.
 * Two boxes are the same spot when either centre falls inside the other box, which also folds a
 * sub-feature of a large lesion into the lesion itself.
 */
export function mergeCandidates(
  cands: readonly LesionCandidate[],
  minConf = VERIFY_CONF,
  max = MAX_SHOWN,
): LesionCandidate[] {
  const inside = (a: LesionCandidate, b: LesionCandidate) =>
    Math.abs(a.cx - b.cx) < b.bw / 2 && Math.abs(a.cy - b.cy) < b.bh / 2;
  // Boxes that overlap by a quarter of the smaller one are one lesion too: two rings slightly offset
  // on one cheek lesion (seen on device) each had their centre outside the other's box.
  const overlapping = (a: LesionCandidate, b: LesionCandidate) => {
    const ix = Math.max(0, Math.min(a.cx + a.bw / 2, b.cx + b.bw / 2) - Math.max(a.cx - a.bw / 2, b.cx - b.bw / 2));
    const iy = Math.max(0, Math.min(a.cy + a.bh / 2, b.cy + b.bh / 2) - Math.max(a.cy - a.bh / 2, b.cy - b.bh / 2));
    return ix * iy > Math.min(a.bw * a.bh, b.bw * b.bh) / 4;
  };
  // Same lesion → ONE spot. Partly overlapping pieces become one box covering both: keeping only the
  // most confident piece cut the bottom off a large irregular melanoma that verified as three
  // overlapping parts.
  const keep: LesionCandidate[] = [];
  for (const c of [...cands].filter((c) => c.conf >= minConf).sort((a, b) => b.conf - a.conf)) {
    const i = keep.findIndex((k) => inside(c, k) || inside(k, c) || overlapping(c, k));
    if (i < 0) {
      if (keep.length < max) keep.push(c);
      continue;
    }
    const k = keep[i];
    // One box inside the other (by centre): keep the more confident one - a tight box on a mole
    // must not grow into the loose box around it. Only pieces that PARTLY overlap are combined.
    if (inside(c, k) || inside(k, c)) continue;
    const x0 = Math.min(k.cx - k.bw / 2, c.cx - c.bw / 2);
    const x1 = Math.max(k.cx + k.bw / 2, c.cx + c.bw / 2);
    const y0 = Math.min(k.cy - k.bh / 2, c.cy - c.bh / 2);
    const y1 = Math.max(k.cy + k.bh / 2, c.cy + c.bh / 2);
    keep[i] = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bw: x1 - x0, bh: y1 - y0, conf: k.conf };
  }
  return keep;
}

/** A spot smaller than this fraction of the whole-photo box (by area) is a piece of it. */
export const PART_AREA_FRAC = 0.5;

/**
 * Fold pieces of one large lesion back into the whole lesion.
 *
 * On a close-up of a big lesion the blob scan proposes several dark patches inside it, and the
 * detector, given a crop around each patch, boxes the patch - so the picker would offer pieces, and
 * picking one would zoom INTO the lesion. `whole` is the detector run once on the entire photo,
 * which is what it was trained on: when that box contains `minParts` or more smaller spots, those
 * spots are replaced by it. Spots outside it are untouched.
 *
 * Only when that box is itself mostly lesion tissue (UNION_DARK_MIN, given a `grid`). On a wide
 * photo the whole-photo box is just the detector's default guess - centred, ~40% of the frame - and
 * on a back covered in moles it swallowed every mole inside it into one huge spot.
 */
export function absorbIntoWhole(
  cands: readonly LesionCandidate[],
  whole: LesionCandidate | null,
  minParts: number,
  minConf = VERIFY_CONF,
  grid?: LumaGrid,
): LesionCandidate[] {
  if (!whole || whole.conf < minConf) return [...cands];
  if (
    grid &&
    darkBoxShare(grid, whole.cx - whole.bw / 2, whole.cy - whole.bh / 2, whole.cx + whole.bw / 2, whole.cy + whole.bh / 2) <
      UNION_DARK_MIN
  ) {
    return [...cands];
  }
  const isPart = (c: LesionCandidate) =>
    Math.abs(c.cx - whole.cx) < whole.bw / 2 &&
    Math.abs(c.cy - whole.cy) < whole.bh / 2 &&
    c.bw * c.bh < PART_AREA_FRAC * whole.bw * whole.bh;
  const parts = cands.filter(isPart);
  if (parts.length < minParts) return [...cands];
  const conf = Math.max(whole.conf, ...parts.map((p) => p.conf));
  return [{ ...whole, conf }, ...cands.filter((c) => !isPart(c))];
}

/** A spot at least this share of the frame's short side may be the detector's default guess... */
export const OUTSIZED_MIN = 0.5;
/** ...when every other spot is smaller than this share of it. */
export const OUTSIZED_RATIO = 0.2;

/**
 * Drop the detector's default guess on a wide photo of many small lesions.
 *
 * Shown a large crop it is unsure about, the detector draws a centred box covering ~40-60% of it
 * with high confidence (0.89 measured) - on a back covered in moles that became one ring over half
 * the back. Nothing about the pixels inside separates it from a real large lesion (darkness, local
 * contrast and a zoomed-in re-check were all measured and all overlap), so this uses the one thing
 * that does: a real large lesion does not sit among two or more spots that are all a fifth its size.
 * A real large lesion with sizeable neighbours, or a photo with one or two spots, is untouched.
 * Dry run over ~2,300 analysed photos: it fires on 5 - two mole-covered backs (one twice), a phone
 * screenshot of a jacket, and one real loss (a large pink SCC among hair-follicle spots).
 */
export function dropOutsized(cands: readonly LesionCandidate[], imageW: number, imageH: number): LesionCandidate[] {
  const se = Math.min(imageW, imageH);
  const size = (c: LesionCandidate) => Math.max(c.bw * imageW, c.bh * imageH) / se;
  return cands.filter((c) => {
    const others = cands.filter((o) => o !== c);
    return !(
      size(c) >= OUTSIZED_MIN &&
      others.length >= 2 &&
      others.every((o) => size(o) < OUTSIZED_RATIO * size(c))
    );
  });
}

/** Luma of a small downscale, plus a reference skin brightness, for `joinConnected`. */
export type LumaGrid = { luma: Float32Array; width: number; height: number; skinRef: number };

/** A path pixel darker than this fraction of skinRef is lesion tissue. */
export const DARK_FRAC = 0.8;
/** Two spots are one lesion when at least this share of the path between them is lesion tissue. */
export const DARK_PATH_MIN = 0.8;
/**
 * A joined box must be at least this share lesion tissue. One large lesion fills most of the box
 * around its pieces; a back densely covered in separate spots chains together by dark paths but
 * its union box is mostly skin.
 */
export const UNION_DARK_MIN = 0.35;
/** With the verifier as judge, a proposal larger than this (share of the short side) needs a detector box. */
export const UNSIZED_MAX = 0.15;
/** Verifier scores in [GROW_MIN, verifierMinLarge) get a second look framed GROW_FACTOR wider. */
export const GROW_MIN = 0.4;
export const GROW_FACTOR = 2.2;
/**
 * Detector confidence a spot accepted on the wider second look also needs. A wide crop scores
 * 0.95+ on the verifier almost whenever any lesion is in it, so the detector decides: on the wide
 * crops, real large lesions scored 0.46-0.52 (two melanomas, a seborrhoeic keratosis) and the false
 * ones 0.00-0.36 (eye socket, nose underside, patches of spotted backs). Thin margin, 2026-10-18.
 */
export const GROWN_DET_CONF = 0.45;
/** Detector confidence a spot larger than UNSIZED_MAX needs on a WIDE photo (aspect ≥ WIDE_ASPECT). */
export const LARGE_DET_MIN = 0.4;
export const WIDE_ASPECT = 1.6;
/** Spots at or above this verifier score are ranked by size, biggest first. */
export const RANK_CONF = 0.9;
/** Detector runs per search (the verifier's accepted spots, most likely first). */
export const DETECT_CAP = 8;
/** Whole-photo detector confidence for a lone spot to take the detector's (bigger) lesion box. */
export const CLOSEUP_CONF = 0.6;
/**
 * A spot the detector was shown and drew NO box on is dropped when its crop also holds a lesion the
 * detector did box at this confidence: the verifier was scoring the neighbour. Bare forehead skin
 * beside a large lesion got the top ring this way on a vivo (2026-10-19). On 470 test photos this
 * removed 2 such rings and no real lesion (35 no-box spots: ~20 real ones, all kept). A spot the
 * time budget skipped is treated the same way, so a slow phone cannot keep that ring either.
 */
export const NEIGHBOUR_DET_CONF = 0.5;
/**
 * A spot the time budget left without its detector run must clear this verifier score instead: the
 * detector is what turns away the weaker ones (a cheek beside a nose at 0.79 on a slow phone).
 */
export const UNCHECKED_MIN = 0.9;
/** ...and be small: both false rings a slow phone kept on a face were proposals ~0.10 of the frame. */
export const UNCHECKED_MAX_SIZE = 0.06;
/** Whole-photo detector confidence to frame its box when no spot was found at all. */
export const FALLBACK_CONF = 0.5;
/**
 * ...and its largest piece must be at least this share of the joined box's size. Pieces of one large
 * lesion are substantial patches (the largest was 27% of the joined box on a big melanoma); moles in
 * the shadowed small of a back chained into a box 12x the size of any of them (8%).
 */
export const JOIN_PIECE_MIN = 0.2;

/**
 * Luma of an RGBA downscale, and skinRef: the 75th-percentile luma of skin-coloured pixels (warm,
 * not dark). The upper percentile keeps the reference on skin even when a lesion covers half the
 * frame and on a face photo with a black background.
 */
export function lumaGrid(rgba: Uint8Array, width: number, height: number): LumaGrid {
  const n = width * height;
  const luma = new Float32Array(n);
  const skin: number[] = [];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    luma[i] = (r * 299 + g * 587 + b * 114) / 1000;
    if (r > 60 && r >= g && r >= b) skin.push(luma[i]);
  }
  skin.sort((a, b) => a - b);
  const skinRef = skin.length ? skin[Math.floor(skin.length * 0.75)] : 255;
  return { luma, width, height, skinRef };
}

/** Share of the straight path between two spot centres that is darker than DARK_FRAC of skin. */
export function darkPathShare(grid: LumaGrid, a: LesionCandidate, b: LesionCandidate): number {
  const { luma, width, height, skinRef } = grid;
  const steps = Math.max(2, Math.ceil(Math.hypot((a.cx - b.cx) * width, (a.cy - b.cy) * height)));
  let dark = 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = Math.min(width - 1, Math.max(0, Math.round((a.cx + (b.cx - a.cx) * t) * width - 0.5)));
    const y = Math.min(height - 1, Math.max(0, Math.round((a.cy + (b.cy - a.cy) * t) * height - 0.5)));
    if (luma[y * width + x] < DARK_FRAC * skinRef) dark++;
  }
  return dark / (steps + 1);
}

/** Share of a box (fractions of the image) darker than DARK_FRAC of skin. */
export function darkBoxShare(grid: LumaGrid, x0: number, y0: number, x1: number, y1: number): number {
  const { luma, width, height, skinRef } = grid;
  const px0 = Math.max(0, Math.floor(x0 * width));
  const px1 = Math.min(width, Math.ceil(x1 * width));
  const py0 = Math.max(0, Math.floor(y0 * height));
  const py1 = Math.min(height, Math.ceil(y1 * height));
  let dark = 0;
  let all = 0;
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      all++;
      if (luma[y * width + x] < DARK_FRAC * skinRef) dark++;
    }
  }
  return all ? dark / all : 0;
}

/**
 * Join spots that are pieces of one lesion into a single spot whose box covers them all.
 *
 * On a close-up of a large lesion the scan proposes several dark patches inside it, and the
 * detector, given a crop around each, boxes the patch - so the picker would offer pieces, and
 * picking one would zoom INTO the lesion. Separate lesions have skin between them; pieces of one
 * lesion are joined by lesion tissue. So: spots whose connecting line is mostly darker than skin are
 * the same lesion (transitively), and the joined box is the union of their boxes - provided that
 * box is itself mostly lesion (UNION_DARK_MIN) and one of the pieces is a sizeable part of it
 * (JOIN_PIECE_MIN); otherwise the spots stay separate.
 */
export function joinConnected(cands: readonly LesionCandidate[], grid: LumaGrid): LesionCandidate[] {
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      if (darkPathShare(grid, cands[i], cands[j]) >= DARK_PATH_MIN) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, LesionCandidate[]>();
  cands.forEach((c, i) => {
    const g = groups.get(find(i));
    if (g) g.push(c);
    else groups.set(find(i), [c]);
  });
  const out: LesionCandidate[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const x0 = Math.min(...g.map((c) => c.cx - c.bw / 2));
    const x1 = Math.max(...g.map((c) => c.cx + c.bw / 2));
    const y0 = Math.min(...g.map((c) => c.cy - c.bh / 2));
    const y1 = Math.max(...g.map((c) => c.cy + c.bh / 2));
    const unionSize = Math.max(x1 - x0, (y1 - y0) * (grid.height / grid.width));
    const biggest = Math.max(...g.map((c) => Math.max(c.bw, c.bh * (grid.height / grid.width))));
    if (darkBoxShare(grid, x0, y0, x1, y1) < UNION_DARK_MIN || biggest < JOIN_PIECE_MIN * unionSize) {
      out.push(...g);
      continue;
    }
    out.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bw: x1 - x0, bh: y1 - y0, conf: Math.max(...g.map((c) => c.conf)) });
  }
  return out.sort((a, b) => b.conf - a.conf);
}

/** RGBA pixels. */
export type RgbaImage = { data: Uint8Array; width: number; height: number };

/** Area-average downscale so the short side is `short` (no-op copy if already that small). */
export function downscaleRgba(img: RgbaImage, short: number): RgbaImage {
  const { data, width: W, height: H } = img;
  const k = Math.min(1, short / Math.min(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * H) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * W) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (sy * W + sx) * 4;
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0);
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Bilinear-resample a region of `img` into `tensor` (RGB 0..1, NHWC, `size` square) at
 * (dx, dy, dw, dh) in tensor pixels. Pixel centres at +0.5, edges clamped, like a canvas or PIL.
 */
function drawInto(
  tensor: Float32Array,
  size: number,
  img: RgbaImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const { data, width: W, height: H } = img;
  // Column lookups are the same for every row: computed once. Hermes (Android) interprets this
  // loop without a JIT, so per-pixel work is what a mid-range phone pays for - the search spent
  // ~3 s building crops on a vivo (2026-10-19). Same arithmetic, same order: identical output.
  const xa = new Int32Array(dw);
  const xb = new Int32Array(dw);
  const xt = new Float64Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = Math.min(W - 1, Math.max(0, sx + ((x + 0.5) * sw) / dw - 0.5));
    const x0 = Math.floor(fx);
    xa[x] = x0 * 4;
    xb[x] = Math.min(W - 1, x0 + 1) * 4;
    xt[x] = fx - x0;
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(H - 1, Math.max(0, sy + ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(H - 1, y0 + 1);
    const ty = fy - y0;
    const r0 = y0 * W * 4;
    const r1 = y1 * W * 4;
    let o = ((dy + y) * size + dx) * 3;
    for (let x = 0; x < dw; x++) {
      const tx = xt[x];
      const a = r0 + xa[x];
      const b = r0 + xb[x];
      const c = r1 + xa[x];
      const d = r1 + xb[x];
      let top = data[a] + (data[b] - data[a]) * tx;
      let bot = data[c] + (data[d] - data[c]) * tx;
      tensor[o] = (top + (bot - top) * ty) / 255;
      top = data[a + 1] + (data[b + 1] - data[a + 1]) * tx;
      bot = data[c + 1] + (data[d + 1] - data[c + 1]) * tx;
      tensor[o + 1] = (top + (bot - top) * ty) / 255;
      top = data[a + 2] + (data[b + 2] - data[a + 2]) * tx;
      bot = data[c + 2] + (data[d + 2] - data[c + 2]) * tx;
      tensor[o + 2] = (top + (bot - top) * ty) / 255;
      o += 3;
    }
  }
}

/** A square region of `img` (pixels of img) resized to the detector's `size` square input. */
export function squareToTensor(img: RgbaImage, rect: PixelRect, size: number): Float32Array {
  const t = new Float32Array(size * size * 3);
  drawInto(t, size, img, rect.originX, rect.originY, rect.side, rect.side, 0, 0, size, size);
  return t;
}

/**
 * The whole of `img` letterboxed into the `size` square on grey 114 - ultralytics' letterbox, which
 * is how the detector's training images reached it. `place` maps tensor fractions back to the image.
 */
export function letterboxToTensor(
  img: RgbaImage,
  size: number,
  fill = 114 / 255,
): { tensor: Float32Array; place: { x: number; y: number; w: number; h: number } } {
  const t = new Float32Array(size * size * 3).fill(fill);
  const k = size / Math.max(img.width, img.height);
  const w = Math.round(img.width * k);
  const h = Math.round(img.height * k);
  const x = Math.floor((size - w) / 2);
  const y = Math.floor((size - h) / 2);
  drawInto(t, size, img, 0, 0, img.width, img.height, x, y, w, h);
  return { tensor: t, place: { x: x / size, y: y / size, w: w / size, h: h / size } };
}

/** One macrotask turn, so promise chains already queued (a model call) get to start. */
function yieldToQueue(): Promise<void> {
  // Through globalThis: this file is compiled without DOM or Node types (scripts/test-localizer.mjs).
  const g = globalThis as unknown as { setImmediate?: (f: () => void) => void; setTimeout: (f: () => void, ms: number) => void };
  return new Promise((resolve) => (g.setImmediate ? g.setImmediate(resolve) : g.setTimeout(resolve, 0)));
}

/** A normalized detector box, as detector-core.ts LesionBox. */
type DetBox = { cx: number; cy: number; bw: number; bh: number; conf: number };

/** Most confident box that is not frame-sized (both sides ≥ 0.95, detector-core FULL_FRAME). */
function bestBox(boxes: readonly DetBox[]): DetBox | null {
  let best: DetBox | null = null;
  for (const b of boxes) {
    if (b.bw >= 0.95 && b.bh >= 0.95) continue;
    if (!best || b.conf > best.conf) best = b;
  }
  return best;
}

export type SpotSearch = {
  spots: LesionCandidate[];
  /** Diagnostics: proposals verified, and each one's detector confidence. */
  proposals: number;
  confs: number[];
  /**
   * When no spot was found: the detector's box on the whole photo, if confident - a close-up of a
   * lesion the verifier would not confirm. crop.tsx frames it instead of zooming blind.
   */
  fallback?: LesionCandidate;
  /** Diagnostics: true when the time budget stopped detector runs early. */
  budgetHit?: boolean;
  /** Diagnostics: where each verified proposal was, what the detector said (0 = no box) and the verifier (-1 = not run). */
  checked: { cx: number; cy: number; size: number; conf: number; pLesion: number }[];
};

/** The models findSpots needs - injected so this file stays free of native code. */
export type SpotModels = {
  /** blob-core's scanLesionBlobs. */
  scan: (rgba: Uint8Array, w: number, h: number, opts: BlobScanOptions) => BlobScan;
  /** The lesion detector on a detectorSize-square RGB 0..1 tensor: every box ≥ DET_CONF. */
  detect: (tensor: Float32Array) => Promise<readonly DetBox[]>;
  detectorSize: number;
  /** The skin gate on a skinSize-square RGB 0..1 tensor: P(not skin) and P(whole face). Optional. */
  skinGate?: (tensor: Float32Array) => Promise<{ notSkin: number; face: number }>;
  skinSize?: number;
  /**
   * The face detector (face-core.ts) on a FACE_INPUT-square RGB tensor in [-1, 1]: its raw
   * regressor and logit outputs. Optional.
   */
  faceDetect?: (tensor: Float32Array) => Promise<{ regressors: Float32Array; logits: Float32Array }>;
  /** The spot verifier on a verifierSize-square RGB 0..1 crop: P(centred on a lesion). Optional. */
  verify?: (tensor: Float32Array) => Promise<number>;
  verifierSize?: number;
  /**
   * Time budget: once `now()` passes `deadline`, no more detector runs start (the slow model -
   * ~145 ms on an iPhone, ~0.5-1 s on a mid-range Android). Spots not yet sized keep their
   * proposal ring; large ones, which need the detector, are dropped. A vivo (Dimensity 700) ran
   * past crop.tsx's timeout and lost the whole result (2026-10-19). Optional; no budget if unset.
   */
  deadline?: number;
  now?: () => number;
};

export type SpotSettings = {
  /** Short sides the photo is scanned at, and how many proposals are verified. */
  scales: readonly number[];
  maxProposals: number;
  /** Detector confidence on the close-up crop for a proposal to count as a lesion. */
  minConf: number;
  /** Smallest verification crop, as a fraction of the photo's short side. */
  verifyMinFrac: number;
  /**
   * Who decides a proposal is a lesion: the lesion detector's confidence ('detector', minConf), or
   * the spot verifier's probability ('verifier', verifierMin; needs models.verify). With the
   * verifier the detector still sizes the box when it finds one.
   */
  judge: 'detector' | 'verifier';
  verifierMin: number;
  /**
   * The verifier bar for a spot larger than UNSIZED_MAX of the frame. Large proposals on faces (an
   * eye socket, the underside of a nose, an ear, a beard) scored 0.78-0.94; large real lesions
   * 0.95-0.99 bar one at 0.948 (31 face/ear photos, 2026-10-17).
   */
  verifierMinLarge: number;
  /** Drop a spot when the skin gate says NOT skin, or a whole FACE, with at least this probability. */
  notSkinMax: number;
  faceMax: number;
};

export const SPOT_SETTINGS: SpotSettings = {
  scales: PROPOSAL_SCALES,
  maxProposals: MAX_PROPOSALS,
  minConf: VERIFY_CONF,
  verifyMinFrac: VERIFY_MIN_FRAC,
  judge: 'verifier',
  verifierMin: 0.7,
  verifierMinLarge: 0.95,
  notSkinMax: 0.5,
  faceMax: 0.5,
};

/** A square crop around a spot with its box at `fill`, inside the image (verifyRect's rules). */
function spotRect(c: LesionCandidate, W: number, H: number, fill: number): PixelRect {
  const se = Math.min(W, H);
  return verifyRect({ cx: c.cx, cy: c.cy, size: Math.max(c.bw * W, c.bh * H) / se / (fill / VERIFY_FILL), peak: 0 }, W, H);
}

/**
 * The whole multi-spot search on one decoded photo; the calibration harness runs exactly this.
 *
 * Steps: scan for dark blobs → merge → strongest proposals → detector on a
 * close-up crop of each → whole-photo detection folds pieces of a large lesion (absorbIntoWhole) →
 * drop weak and repeated spots → drop spots the skin gate calls not-skin → drop eyes on faces →
 * drop the detector's default guess (dropOutsized) → join pieces connected by lesion tissue →
 * MAX_SHOWN most confident.
 */
export async function findSpots(
  img: RgbaImage,
  models: SpotModels,
  settings: SpotSettings = SPOT_SETTINGS,
): Promise<SpotSearch> {
  const { width: W, height: H } = img;
  const { scan, detectorSize } = models;
  let budgetHit = false;
  const inBudget = () => {
    if (models.deadline === undefined || (models.now ?? Date.now)() < models.deadline) return true;
    budgetHit = true;
    return false;
  };
  const detect = models.detect;
  let grid: LumaGrid | null = null;
  // Each scale is downscaled once and shared by the dark, colour and bright scans.
  const smalls = new Map<number, RgbaImage>();
  const downscaled = (short: number) => {
    let d = smalls.get(short);
    if (!d) smalls.set(short, (d = downscaleRgba(img, short)));
    return d;
  };
  // Coarse to fine, each scale with its own share of the slots. One pooled ranking let a fine scan's
  // many strong texture peaks INSIDE a large lesion outrank - and, as overlapping duplicates, erase -
  // the coarse scan's proposal for the lesion as a whole; every piece then failed verification (a
  // piece is not a centred lesion) and the lesion was never offered. A finer proposal is kept only
  // where nothing coarser already is.
  const kept: SpotProposal[] = [];
  const share = Math.max(1, Math.floor(settings.maxProposals / settings.scales.length));
  const quotas = settings.scales.length === PROPOSAL_QUOTAS.length && settings.maxProposals === MAX_PROPOSALS ? PROPOSAL_QUOTAS : null;
  settings.scales.forEach((short, i) => {
    const small = downscaled(short);
    if (!grid) grid = lumaGrid(small.data, small.width, small.height);
    const mine = blobsToProposals(scan(small.data, small.width, small.height, PROPOSAL_SCAN).blobs, small.width, small.height);
    const quota = quotas ? quotas[i] : i === settings.scales.length - 1 ? settings.maxProposals - kept.length : share;
    const fresh = mergeProposals(mine, W, H, Infinity).filter(
      (p) => !isCornerAnnotation(img, p) && mergeProposals([...kept, p], W, H, Infinity).length > kept.length,
    );
    kept.push(...fresh.slice(0, Math.max(0, quota)));
  });
  // Spots that stand out by COLOUR or by being BRIGHTER - yellow crusts, white scale - which the
  // darkness scans above never propose (a palm photo's two biggest lesions were never even checked,
  // 2026-10-19). A small extra budget at two scales; only where nothing is proposed already.
  if (settings.maxProposals === MAX_PROPOSALS) {
    for (const channel of ['chroma', 'bright'] as const) {
      const extra: SpotProposal[] = [];
      for (const short of COLOUR_SCALES) {
        const small = downscaled(short);
        extra.push(...blobsToProposals(scan(small.data, small.width, small.height, { ...PROPOSAL_SCAN, channel }).blobs, small.width, small.height));
      }
      // Small spots only: large colour blobs were cheeks, scalps, ears and eye areas (seen on 40 of
      // 107 online photos when uncapped).
      const fresh = mergeProposals(extra.filter((p) => p.size <= UNSIZED_MAX), W, H, Infinity)
        .filter((p) => mergeProposals([...kept, p], W, H, Infinity).length > kept.length)
        .map((p) => ({ ...p, colour: true }));
      kept.push(...fresh.slice(0, COLOUR_QUOTA));
    }
  }

  const verified: LesionCandidate[] = [];
  const checked: SpotSearch['checked'] = [];
  const useVerifier = settings.judge === 'verifier' && !!models.verify && !!models.verifierSize;
  const se = Math.min(W, H);
  if (useVerifier && models.verify && models.verifierSize) {
    const verify = models.verify;
    const vSize = models.verifierSize;
    // 1. The verifier on every proposal (~1 ms each on a phone). A proposal can be one PIECE of a
    //    large lesion - the blob scan sized an irregular melanoma's dark patches at 0.13-0.16 of the
    //    frame when the lesion is 0.35 - and framed as a piece it scores in between (0.63-0.72).
    //    Those get a second look at a wider framing; if that scores higher, the lesion is bigger
    //    than its proposal and the wider crop is the one to size it from.
    const looks: { p: SpotProposal; r: PixelRect; pLesion: number; grown: boolean }[] = [];
    for (const p of kept) {
      let r = verifyRect(p, W, H, settings.verifyMinFrac);
      let pLesion = await verify(squareToTensor(img, r, vSize));
      let grown = false;
      if (!p.colour && pLesion >= GROW_MIN && pLesion < settings.verifierMinLarge && p.size * GROW_FACTOR < 1) {
        const r2 = verifyRect({ ...p, size: p.size * GROW_FACTOR }, W, H, settings.verifyMinFrac);
        const p2 = await verify(squareToTensor(img, r2, vSize));
        // Only a near-certain wider look counts: wider crops of eye sockets, mouths and patches of
        // a spotted back also scored higher than their tight crops (0.8-0.94).
        if (p2 > pLesion && p2 >= settings.verifierMinLarge) {
          r = r2;
          pLesion = p2;
          grown = true;
        }
      }
      looks.push({ p, r, pLesion, grown });
      if (pLesion < settings.verifierMin) checked.push({ cx: p.cx, cy: p.cy, size: p.size, conf: -1, pLesion });
    }
    // 2. The detector (~130 ms a run on an iPhone) only sizes the rings of accepted spots, and only
    //    the DETECT_CAP most likely ones: on a back covered in spots it ran 26 times (3.8 s).
    const accepted = looks.filter((l) => l.pLesion >= settings.verifierMin).sort((a, b) => b.pLesion - a.pLesion);
    // Only on wide photos (a strip of forearm, a whole back): there the large crops are mostly skin
    // and fooled the verifier. A near-square photo is usually a close-up whose large spot IS the
    // lesion, where the detector is often weak (0.20-0.41 on ISIC close-ups) - the same range as the
    // false rings, so the rule cannot be applied everywhere.
    const wide = Math.max(W, H) / Math.min(W, H) >= WIDE_ASPECT;
    // The detector on the whole photo, computed at most once, only if a large spot needs it.
    let wholeCache: LesionCandidate | null | undefined;
    const wholeBox = async () => {
      if (wholeCache !== undefined) return wholeCache;
      if (!inBudget()) return null;
      const { tensor, place } = letterboxToTensor(img, detectorSize);
      const wb = bestBox(await detect(tensor));
      wholeCache = wb ? { cx: (wb.cx - place.x) / place.w, cy: (wb.cy - place.y) / place.h, bw: wb.bw / place.w, bh: wb.bh / place.h, conf: wb.conf } : null;
      return wholeCache;
    };
    // Detector runs, in priority order: spots that cannot be kept without a detector box (large or
    // grown) first, so a slow phone that hits the time budget loses ring sizing on small spots
    // rather than losing a big lesion. Which spots get a run is unchanged (the DETECT_CAP most
    // likely), so a phone that finishes inside the budget gets exactly the same result.
    const boxes = new Map<number, DetBox | null>();
    // Next come spots whose crop holds another accepted spot: the neighbour check below
    // (NEIGHBOUR_DET_CONF) needs the detector's verdict on both.
    const holds = (r: PixelRect, q: SpotProposal) => {
      const x = q.cx * W;
      const y = q.cy * H;
      return x >= r.originX && x < r.originX + r.side && y >= r.originY && y < r.originY + r.side;
    };
    const order = accepted
      .map((l, i) => ({
        i,
        rank: l.grown || l.p.size > UNSIZED_MAX ? 2 : accepted.some((o, j) => j !== i && j < DETECT_CAP && holds(l.r, o.p)) ? 1 : 0,
      }))
      .filter(({ i }) => i < DETECT_CAP)
      .sort((x, y) => y.rank - x.rank || x.i - y.i);
    // Each crop is built while the previous detector run is still going: the model runs on a
    // native thread, and building a 768 crop is a large share of the search's JS time on Android.
    const cropFor = (k: number) => squareToTensor(img, accepted[order[k].i].r, detectorSize);
    let tensor = order.length && inBudget() ? cropFor(0) : null;
    for (let k = 0; tensor; k++) {
      const run = detect(tensor);
      // Let the queued call reach the native interpreter before this thread gets busy again.
      await yieldToQueue();
      const following = k + 1 < order.length ? cropFor(k + 1) : null;
      boxes.set(order[k].i, bestBox(await run));
      tensor = following && inBudget() ? following : null;
    }
    // Spots the detector ran on but boxed nothing, and the box centres it did confirm - see
    // NEIGHBOUR_DET_CONF.
    const noBox: { v: LesionCandidate; r: PixelRect }[] = [];
    const confirmed: { x: number; y: number }[] = [];
    for (let i = 0; i < accepted.length; i++) {
      const { p, r, pLesion, grown } = accepted[i];
      const ran = boxes.has(i);
      if (!ran && i < DETECT_CAP && (pLesion < UNCHECKED_MIN || p.size > UNCHECKED_MAX_SIZE)) continue; // skipped by the time budget
      const b = ran ? (boxes.get(i) ?? null) : null;
      checked.push({ cx: p.cx, cy: p.cy, size: p.size, conf: ran ? (b ? b.conf : 0) : -1, pLesion, ...(grown ? { grown: true, box: b ? (Math.max(b.bw, b.bh) * r.side) / se : 0, bx: b ? b.cx : -1, by: b ? b.cy : -1 } : {}) } as SpotSearch['checked'][number]);
      // The detector's box sizes the ring only when it is centred in the crop and no bigger than
      // the crop's lesion framing allows - otherwise it is the detector's default box (40-60% of
      // whatever it is shown), which drew rings over a whole foot or face.
      const cropLesion = (r.side * VERIFY_FILL) / se; // the lesion size this crop was framed for
      const boxSide = b ? (Math.max(b.bw, b.bh) * r.side) / se : 0;
      const near =
        b && Math.abs(b.cx - 0.5) < 0.25 && Math.abs(b.cy - 0.5) < 0.25 && boxSide >= 0.6 * p.size && boxSide <= 2.5 * Math.max(p.size, grown ? cropLesion : 0);
      // A LARGE spot with no detector box to size it is a patch of skin: its ring would be a guess.
      if (!near && p.size > UNSIZED_MAX) continue;
      const ring = Math.max(p.size, near ? boxSide : 0);
      // Large spots need a near-certain verifier: on faces, eye sockets, the underside of a nose,
      // ears and beards scored 0.78-0.94. Letting a likely score through when the detector agreed
      // was tried and REJECTED - the detector boxed eye sockets and nose undersides too. Large real
      // lesions found only as pieces reach the bar through the wider second look above instead.
      if (ring > UNSIZED_MAX && pLesion < settings.verifierMinLarge) continue;
      // Colour-scan spots need the near-certain bar too, and must stay small.
      if (p.colour && (pLesion < settings.verifierMinLarge || ring > UNSIZED_MAX)) continue;
      // ...and, on a wide photo, a detector that at least half-agrees. Huge crops of sun-damaged
      // forearms scored 0.96-0.98 on the verifier (a lesion somewhere inside) with the detector at
      // 0.28-0.34, and one swallowed a real nodule into its ring (2026-10-19, on device).
      // Exempt: a close-up where the detector, shown the whole photo, boxes a lesion here - real
      // large lesions on close-ups often score under 0.4 on their crop (requiring it everywhere cut
      // ISIC close-ups with a spot from 56% to 39%).
      if (wide && ring > UNSIZED_MAX && !(near && b && b.conf >= LARGE_DET_MIN)) {
        const w = await wholeBox();
        const backed = w && w.conf >= CLOSEUP_CONF && Math.abs(p.cx - w.cx) < w.bw / 2 && Math.abs(p.cy - w.cy) < w.bh / 2;
        if (!backed) continue;
      }
      // A spot accepted only on the wider second look must also be boxed confidently by the
      // detector: wider crops of an eye socket, a nose's underside and a patch of a spotted back
      // also reached 0.95, and without a detector box the ring is a guess the size of the crop.
      if (grown && !(near && b && b.conf >= GROWN_DET_CONF)) continue;
      const v: LesionCandidate =
        near && b
          ? { cx: (r.originX + b.cx * r.side) / W, cy: (r.originY + b.cy * r.side) / H, bw: (b.bw * r.side) / W, bh: (b.bh * r.side) / H, conf: pLesion }
          : { cx: p.cx, cy: p.cy, bw: (p.size * se * 1.3) / W, bh: (p.size * se * 1.3) / H, conf: pLesion };
      verified.push(v);
      // No detector verdict for it (it drew nothing, or the time budget skipped it): kept only if
      // its crop is not riding on a lesion the detector did confirm.
      if ((ran && !b) || (!ran && i < DETECT_CAP)) noBox.push({ v, r });
      if (near && b && b.conf >= NEIGHBOUR_DET_CONF) confirmed.push({ x: v.cx * W, y: v.cy * H });
    }
    for (const { v, r } of noBox) {
      const riding = confirmed.some((c) => c.x >= r.originX && c.x < r.originX + r.side && c.y >= r.originY && c.y < r.originY + r.side);
      if (riding) verified.splice(verified.indexOf(v), 1);
    }
  } else {
    for (const p of kept) {
      const r = verifyRect(p, W, H, settings.verifyMinFrac);
      const b = bestBox(await detect(squareToTensor(img, r, detectorSize)));
      checked.push({ cx: p.cx, cy: p.cy, size: p.size, conf: b ? b.conf : 0, pLesion: -1 });
      if (!b) continue;
      verified.push({
        cx: (r.originX + b.cx * r.side) / W,
        cy: (r.originY + b.cy * r.side) / H,
        bw: (b.bw * r.side) / W,
        bh: (b.bh * r.side) / H,
        conf: b.conf,
      });
    }
  }

  let whole: LesionCandidate | null = null;
  // The whole-photo detection only feeds absorbIntoWhole, which the verifier path does not use.
  if (!useVerifier && verified.length >= MIN_PARTS) {
    const { tensor, place } = letterboxToTensor(img, detectorSize);
    const b = bestBox(await detect(tensor));
    if (b) {
      whole = {
        cx: (b.cx - place.x) / place.w,
        cy: (b.cy - place.y) / place.h,
        bw: b.bw / place.w,
        bh: b.bh / place.h,
        conf: b.conf,
      };
    }
  }

  const minConf = useVerifier ? settings.verifierMin : settings.minConf;
  let spots = useVerifier ? verified : absorbIntoWhole(verified, whole, MIN_PARTS, minConf, grid ?? undefined);
  spots = mergeCandidates(spots, minConf, Infinity);

  // The detector, shown a close-up crop, scores a printed flower, a wound dressing or an earring
  // as confidently as a lesion (0.77-0.85 measured). The skin gate tells them apart: on 18 real
  // lesions it never called the crop "not skin" above 0.04, on those objects 0.88-0.98. It is
  // asked at two framings - the verification framing and a tighter one - because a small object
  // on skin only dominates the tighter crop.
  //
  // It also catches the detector's default guess on a portrait: one box around the whole face
  // (0.89-0.97 'face' on four ID photos; every one of 327 lesion spots scored 0.28 or less).
  const { skinGate, skinSize } = models;
  if (skinGate && skinSize) {
    const onSkin: LesionCandidate[] = [];
    for (const c of spots) {
      let keep = true;
      for (const fill of [VERIFY_FILL, 0.6]) {
        const p = await skinGate(squareToTensor(img, spotRect(c, W, H, fill), skinSize));
        if (p.notSkin >= settings.notSkinMax || p.face >= settings.faceMax) {
          keep = false;
          break;
        }
      }
      if (keep) onSkin.push(c);
    }
    spots = onSkin;
  }

  // An eye on a portrait passes every check above - see face-core.ts.
  if (models.faceDetect && spots.length) {
    const { tensor, place } = letterboxToTensor(img, FACE_INPUT, 0);
    for (let i = 0; i < tensor.length; i++) tensor[i] = tensor[i] * 2 - 1;
    const out = await models.faceDetect(tensor);
    const faces = decodeFaces(out.regressors, out.logits, place);
    if (faces.length) {
      spots = spots.filter((c) => !onAnEye(c.cx, c.cy, faces, W, H) && !coversFace(c.cx, c.cy, c.bw, c.bh, faces));
    }
  }

  // A lone spot may be one patch of a large lesion that fills the photo (a crusted SCC's dark core):
  // framed on its own, the viewfinder zooms INTO the lesion. One detector run on the whole photo -
  // the close-up it was trained on - settles it: if it confidently boxes a lesion that contains the
  // spot and is clearly bigger, the spot becomes that box, so the whole lesion is in frame.
  if (useVerifier && spots.length === 1 && inBudget()) {
    const { tensor, place } = letterboxToTensor(img, detectorSize);
    const b = bestBox(await detect(tensor));
    const c = spots[0];
    if (b && b.conf >= CLOSEUP_CONF) {
      const w = { cx: (b.cx - place.x) / place.w, cy: (b.cy - place.y) / place.h, bw: b.bw / place.w, bh: b.bh / place.h };
      const contains = Math.abs(c.cx - w.cx) < w.bw / 2 && Math.abs(c.cy - w.cy) < w.bh / 2;
      if (contains && w.bw * w.bh >= 2 * c.bw * c.bh) {
        const x0 = Math.min(c.cx - c.bw / 2, w.cx - w.bw / 2);
        const x1 = Math.max(c.cx + c.bw / 2, w.cx + w.bw / 2);
        const y0 = Math.min(c.cy - c.bh / 2, w.cy - w.bh / 2);
        const y1 = Math.max(c.cy + c.bh / 2, w.cy + w.bh / 2);
        spots = [{ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bw: x1 - x0, bh: y1 - y0, conf: c.conf }];
      }
    }
  }

  spots = dropOutsized(spots, W, H);
  // Joining pieces of one large lesion is for the detector-judged path, whose proposals could be
  // texture pieces. With the verifier, the coarse scan proposes a large lesion whole and pieces fail
  // verification, while joining merged separate moles in a shadowed back into one ring.
  if (grid && !useVerifier) spots = joinConnected(spots, grid);
  let fallback: LesionCandidate | undefined;
  if (useVerifier && spots.length === 0 && inBudget()) {
    const { tensor, place } = letterboxToTensor(img, detectorSize);
    const b = bestBox(await detect(tensor));
    if (b && b.conf >= FALLBACK_CONF) {
      fallback = { cx: (b.cx - place.x) / place.w, cy: (b.cy - place.y) / place.h, bw: b.bw / place.w, bh: b.bh / place.h, conf: b.conf };
    }
  }
  // Order: among confident spots (≥ RANK_CONF) the biggest first - an ulcer at 0.97 should lead,
  // not a pinhead papule at 0.99 - then the rest by confidence. The first spot is pre-selected.
  const rank = (c: LesionCandidate) => (c.conf >= RANK_CONF ? 1 + Math.max(c.bw * W, c.bh * H) / Math.min(W, H) : c.conf);
  spots = [...spots].sort((a, b) => rank(b) - rank(a));
  return { spots: spots.slice(0, MAX_SHOWN), proposals: kept.length, confs: verified.map((v) => v.conf), checked, fallback, budgetHit };
}

/** Pan/zoom for scan/crop.tsx's viewfinder: the same transform its gestures produce. */
export type Framing = { scale: number; tx: number; ty: number };

/**
 * Centre the crop.tsx viewfinder on (cx, cy) with a crop of about `cropSide` source pixels.
 *
 * The image is cover-fitted into a `frame`-point square (short side fills it), then zoomed by
 * `scale` and panned by (tx, ty). The crop is floored at `minFrac` of the short side and the zoom is
 * capped at `maxZoom` (the pinch limit) - both only ever WIDEN the crop. The centre is clamped so
 * the crop stays inside the image, exactly as crop.tsx's confirm() clamps the export.
 *
 * Whole-lesion guarantee: a lesion of side L ≤ the final crop side S, centred at (cx, cy) and lying
 * inside the image, stays inside the crop. Unclamped, it is centred in the crop. Clamped (say
 * cx < S/2), the crop is [0, S] and the lesion's far edge cx + L/2 < S/2 + S/2 = S.
 */
export function framingFor(opts: {
  imageW: number;
  imageH: number;
  frame: number;
  cx: number;
  cy: number;
  cropSide: number;
  minFrac: number;
  maxZoom: number;
}): Framing {
  const { imageW: IW, imageH: IH, frame, cx, cy, cropSide, minFrac, maxZoom } = opts;
  const shortSide = Math.min(IW, IH);
  const wanted = Math.min(shortSide, Math.max(shortSide * minFrac, cropSide));
  const s0 = frame / shortSide;
  const scale = Math.min(maxZoom, shortSide / wanted);
  const eff = s0 * scale;
  // What confirm() will actually crop (mirrors its cropSize math) - keep centres consistent.
  const half = Math.min(shortSide, frame / eff) / 2;
  const cxPx = Math.min(IW - half, Math.max(half, cx));
  const cyPx = Math.min(IH - half, Math.max(half, cy));
  return { scale, tx: (IW / 2 - cxPx) * eff, ty: (IH / 2 - cyPx) * eff };
}

/**
 * Crop side that keeps the WHOLE lesion visible: the detector box's longer side at `fill` of the
 * frame. `fill` is LESION_TARGET_FILL (the guide ring), so the lesion sits inside the ring with a
 * margin of skin around it rather than touching the frame edge.
 */
export function cropSideForLesion(c: LesionCandidate, imageW: number, imageH: number, fill: number): number {
  return Math.max(c.bw * imageW, c.bh * imageH) / fill;
}

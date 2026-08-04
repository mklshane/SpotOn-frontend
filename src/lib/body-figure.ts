/**
 * Fallback artwork for the body regions Health Icons does not cover — pure geometry, no React.
 *
 * Health Icons (lib/body-icons.ts) supplies head, arm, leg, foot, hand, spine and body, and those
 * are used as published. It has no neck, no torso-front, and a single generic `joints` icon, so
 * mapping everything onto it made face/head-back/neck identical and shoulder/elbow/hip/knee
 * identical. These seven drawings exist only to break those collisions.
 *
 * Each part is drawn in its own 48×48 box (the Health Icons grid) at a deliberately characterful
 * angle — limbs bend, joints sit between the two segments they join. Drawn flat and front-on they
 * read as abstract capsules; angle, not detail, is what makes a body part legible at 130pt.
 *
 * Kept free of React so scripts/preview-body-glyphs.mjs can rasterise the real geometry to a
 * contact sheet. These are hand-authored coordinates, and every version of this file that was not
 * looked at was wrong.
 */

// ---------------------------------------------------------------- path helpers

export function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

/**
 * A limb segment: the convex hull of two circles, tapering from one joint to the next with rounded
 * ends. Because it works at any angle, chaining two of them bends an arm at the elbow.
 */
export function taper(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return circle(x1, y1, Math.max(r1, r2));
  const ang = Math.atan2(dy, dx);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const at = (cx: number, cy: number, r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const a1 = ang + alpha;
  const a2 = ang - alpha;
  const cEnd = `${(x2 + 1.34 * r2 * Math.cos(ang)).toFixed(2)} ${(y2 + 1.34 * r2 * Math.sin(ang)).toFixed(2)}`;
  const cStart = `${(x1 - 1.34 * r1 * Math.cos(ang)).toFixed(2)} ${(y1 - 1.34 * r1 * Math.sin(ang)).toFixed(2)}`;
  return `M${at(x1, y1, r1, a1)}L${at(x2, y2, r2, a1)}Q${cEnd} ${at(x2, y2, r2, a2)}L${at(x1, y1, r1, a2)}Q${cStart} ${at(x1, y1, r1, a1)}Z`;
}

/** A bent limb: two chained tapers sharing the joint radius, so the bend reads as one piece. */
function bent(
  a: [number, number, number],
  j: [number, number, number],
  b: [number, number, number],
): string {
  return taper(a[0], a[1], a[2], j[0], j[1], j[2]) + taper(j[0], j[1], j[2], b[0], b[1], b[2]);
}

// ---------------------------------------------------------------- artwork

/**
 * `main` is the part itself, painted brand orange. `context` is the neighbouring anatomy it hangs
 * off, ghosted — a shoulder with no torso beside it is just an oval, which is exactly how the
 * generic `joints` icon fails. `cut` is negative space in the field colour.
 */
export type GlyphArt = { context?: string[]; main: string[]; cut?: string[] };

/** Shoulders-and-chest stub the head glyphs sit on, so a head is never floating. */
const BUST = 'M8 48C8 40 15 35 24 35C33 35 40 40 40 48Z';

/** Trunk shared by both torso glyphs; only the surface markings differ. */
const TRUNK =
  'M13 10C13 6.5 17 4 24 4C31 4 35 6.5 35 10C35 17 32 22 31 28' +
  'C30 34 33 39 33.5 43C34 46.5 30 48 24 48C18 48 14 46.5 14.5 43' +
  'C15 39 18 34 17 28C16 22 13 17 13 10Z';

export const ART: Record<string, GlyphArt> = {
  // Head turned away. No cut-outs at all: the absence of a face IS the back of the head. A
  // hairline shape here read as a bald cap and a crown line read as a helmet — twice the
  // decoration was the problem, never the silhouette.
  'head-back': {
    context: [BUST, taper(24, 30, 5, 24, 38, 6)],
    main: [ellipse(24, 20, 13.5, 15.5)],
  },
  // Neck between a cropped jaw and the shoulders — the gap between them is the subject.
  neck: {
    context: ['M6 48C6 39 14 33 24 33C34 33 42 33 42 48Z', 'M11 0C11 8 16 12 24 12C32 12 37 8 37 0Z'],
    main: [taper(24, 9, 7.5, 24, 33, 9.5)],
  },
  // Chest and abdomen, front: collarbones and a navel say which way round it is.
  'torso-front': {
    context: [taper(10, 10, 5.5, 5, 30, 4.5), taper(38, 10, 5.5, 43, 30, 4.5)],
    main: [TRUNK],
    cut: [taper(17.5, 9.5, 1.1, 23, 12, 1.1), taper(30.5, 9.5, 1.1, 25, 12, 1.1), circle(24, 31, 1.3)],
  },
  // The same trunk from behind, marked with a spine and shoulder blades. Health Icons' `spine`
  // was tried here and read as three floating vertebrae — an anatomy-diagram fragment rather than
  // a back, and it broke the pair with torso-front, which is the comparison that matters.
  'torso-back': {
    context: [taper(10, 10, 5.5, 5, 30, 4.5), taper(38, 10, 5.5, 43, 30, 4.5)],
    main: [TRUNK],
    cut: [
      taper(24, 11, 1.3, 24, 41, 1),
      taper(18, 15, 1.1, 19.5, 22, 1.1),
      taper(30, 15, 1.1, 28.5, 22, 1.1),
    ],
  },
  // Deltoid draping over the arm where it meets the trunk, as two chained tapers so it rounds off
  // the joint and runs down the arm — a single taper was a rounded rectangle.
  shoulder: {
    context: ['M2 12C2 7 6 4 12 4L20 4L20 48L2 48Z', bent([26, 14, 8], [31, 30, 6.5], [34, 44, 5.5])],
    main: [bent([15, 9, 10.5], [27, 18, 9], [32, 31, 6.5])],
  },
  // A bent arm with the joint itself picked out, upper arm and forearm ghosted around it.
  elbow: {
    context: [taper(9, 3, 6.5, 26, 22, 6.2), taper(26, 26, 6.2, 12, 45, 5)],
    main: [taper(21, 16, 7.4, 24, 31, 7)],
  },
  // Pelvis carrying on into the upper thigh. The pelvis alone was a bucket; a hip only reads as a
  // hip once the leg it drives is part of the same mass.
  hip: {
    context: ['M14 0C14 6 12 10 12 14L36 14C36 10 34 6 34 0Z', taper(30, 34, 7.5, 27, 48, 6.5)],
    main: [
      'M11 14C11 12.5 12.5 11.5 14 11.5L34 11.5C35.5 11.5 37 12.5 37 14' +
        'C37 20 35 24.5 32 27C29.5 29 26 30 22 30C16 30 11 23 11 14Z',
      taper(30, 22, 9, 31, 36, 7.5),
    ],
  },
  // Same construction as the elbow, thicker, with thigh above and calf below to place it.
  knee: {
    context: [taper(12, 2, 8, 25, 20, 6.6), taper(25, 27, 6.6, 15, 46, 5)],
    main: [taper(21, 15, 7.8, 25, 30, 7.2)],
  },
};

export const ART_VIEW_BOX = '0 0 48 48';

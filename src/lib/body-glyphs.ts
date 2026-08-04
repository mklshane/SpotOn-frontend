/**
 * Body region → illustration glyph.
 *
 * `BODY_PARTS` in body-parts.ts is the authoritative region list; every string it can produce
 * (`region` for a front hit, `regionBack` for a back one) must land on a real glyph here, which is
 * what scripts/test-body-glyphs.mjs asserts. A region with no match falls back to `body` — the
 * plain silhouette — so a spot recorded without a body mark still renders something sensible.
 *
 * Some regions deliberately share a glyph: two line-art limb segments (upper arm vs forearm,
 * thigh vs lower leg) are indistinguishable at card size, and the region name is printed beneath
 * the illustration anyway.
 */

export type GlyphKind =
  | 'face'
  | 'head-back'
  | 'neck'
  | 'torso-front'
  | 'torso-back'
  | 'shoulder'
  | 'arm'
  | 'elbow'
  | 'hand'
  | 'hip'
  | 'leg'
  | 'knee'
  | 'foot'
  | 'body';

/** Keyed on the region lower-cased with any leading "left "/"right " stripped. */
const BY_REGION: Record<string, GlyphKind> = {
  'head / face': 'face',
  'back of head': 'head-back',
  neck: 'neck',
  nape: 'neck',

  chest: 'torso-front',
  abdomen: 'torso-front',
  'lower abdomen': 'torso-front',
  'upper back': 'torso-back',
  'mid back': 'torso-back',
  'lower back': 'torso-back',

  shoulder: 'shoulder',
  'upper arm': 'arm',
  forearm: 'arm',
  elbow: 'elbow',
  hand: 'hand',

  hip: 'hip',
  thigh: 'leg',
  'lower leg': 'leg',
  knee: 'knee',
  foot: 'foot',
};

/**
 * The glyph for a region label, or `body` when there is no mark or the label is unrecognised.
 *
 * Sidedness is dropped on purpose — a left hand and a right hand get the same drawing. Mirroring
 * the art per side would imply an anatomical precision the mannequin's raycast does not have.
 */
export function regionGlyph(region: string | null | undefined): GlyphKind {
  if (!region) return 'body';
  const key = region.trim().toLowerCase().replace(/^(left|right)\s+/, '');
  return BY_REGION[key] ?? 'body';
}

/**
 * Which glyph kinds use published Health Icons artwork (body-icons.ts), and which fall back to
 * our own drawings (body-figure.ts).
 *
 * Health Icons is used wherever it has a real match — its head, arm, leg, foot, hand and spine
 * are better than anything drawn by hand here. But the set has no neck and no torso, and exactly
 * one generic `joints` icon, so mapping everything onto it made face/head-back/neck render
 * identically and shoulder/elbow/hip/knee render identically. `null` marks the seven kinds that
 * use our own art purely to break those collisions.
 *
 * `ppe-gloves` is the set's only hand-shaped icon and reads as a hand at a glance, which is the
 * job. Both torsos are ours: `spine` was tried for the back and read as three floating vertebrae,
 * and it broke the pair with torso-front — the two are only ever judged against each other. The
 * unmarked fallback keeps the `body` icon and is told apart from a located spot by colour: brand
 * orange when located, muted grey when not.
 */
const GLYPH_ICON: Record<GlyphKind, string | null> = {
  face: 'head',
  'head-back': null,
  neck: null,
  'torso-front': null,
  'torso-back': null,
  shoulder: null,
  arm: 'arm',
  elbow: null,
  hand: 'ppe-gloves',
  hip: null,
  leg: 'leg',
  knee: null,
  foot: 'foot',
  body: 'body',
};

/** The Health Icons name for a kind, or null when it uses our own artwork instead. */
export function glyphIcon(kind: GlyphKind): string | null {
  return GLYPH_ICON[kind];
}

/**
 * Which side of the body a region names, or null for the midline ones (head, torso, neck).
 *
 * Anatomical left, so it draws on the viewer's right — the same convention the 3D mannequin uses
 * (body-parts.ts: "the model's anatomical LEFT side is at +X"). The glyph needs this because the
 * illustration is one whole figure with a part picked out, so a left hand and a right hand
 * highlight opposite arms rather than sharing a drawing.
 */
export function regionSide(region: string | null | undefined): 'left' | 'right' | null {
  if (!region) return null;
  const m = /^\s*(left|right)\s+/i.exec(region);
  return m ? (m[1].toLowerCase() as 'left' | 'right') : null;
}

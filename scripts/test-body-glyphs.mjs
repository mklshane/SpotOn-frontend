/**
 * Coverage test for the body region → glyph mapping (src/lib/body-glyphs.ts).
 *
 * The failure this guards is silent: `regionGlyph()` falls back to the generic 'body' silhouette
 * for anything it doesn't recognise, so adding a part to BODY_PARTS — or renaming one — would
 * quietly render every spot on it as "location unknown" with nothing throwing. This asserts that
 * EVERY region the mannequin can produce has a real glyph, by reading the real BODY_PARTS rather
 * than a retyped list.
 *
 * Compiles both modules with the project's own tsc, same approach as test-tps.mjs.
 *
 * Run:  npm run test:glyphs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'body-glyphs-'));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/body-glyphs.ts', 'src/lib/body-parts.ts', 'src/lib/body-icons.ts', 'src/lib/body-figure.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);

const { regionGlyph, glyphIcon } = await import(pathToFileURL(join(out, 'body-glyphs.js')).href);
const { BODY_PARTS } = await import(pathToFileURL(join(out, 'body-parts.js')).href);
const { ICONS } = await import(pathToFileURL(join(out, 'body-icons.js')).href);
const { ART } = await import(pathToFileURL(join(out, 'body-figure.js')).href);

/** Artwork for a kind, from whichever of the two sources owns it. */
const artFor = (k) => {
  const icon = glyphIcon(k);
  return icon ? (ICONS[icon] ?? []) : (ART[k]?.main ?? []);
};

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ------------------------------------------------- every mannequin region has a glyph
const regions = [
  ...BODY_PARTS.map((p) => p.region),
  ...BODY_PARTS.map((p) => p.regionBack).filter(Boolean),
];
check('BODY_PARTS is non-empty', regions.length > 0, `got ${regions.length}`);

const uncovered = [];
for (const region of regions) {
  const glyph = regionGlyph(region);
  if (glyph === 'body') uncovered.push(region);
}
check(
  'every mannequin region maps to a specific glyph',
  uncovered.length === 0,
  uncovered.length ? `fell back to 'body': ${uncovered.join(', ')}` : '',
);

// ------------------------------------------------- the fallback still fires when it should
check("no region → 'body'", regionGlyph(null) === 'body');
check("undefined → 'body'", regionGlyph(undefined) === 'body');
check("empty string → 'body'", regionGlyph('') === 'body');
check("an unknown label → 'body'", regionGlyph('Left tentacle') === 'body');

// ------------------------------------------------- sidedness is dropped, not mapped twice
check('Left and Right resolve identically', regionGlyph('Left hand') === regionGlyph('Right hand'));
check('sided regions resolve to the unsided glyph', regionGlyph('Left hand') === 'hand');
check('casing and padding are tolerated', regionGlyph('  LEFT Hand ') === 'hand');

// ------------------------------------------------- a few anchors, so a bad rewrite is caught
const EXPECTED = {
  'Head / Face': 'face',
  'Back of head': 'head-back',
  Nape: 'neck',
  Chest: 'torso-front',
  'Lower back': 'torso-back',
  'Right shoulder': 'shoulder',
  'Left forearm': 'arm',
  'Right elbow': 'elbow',
  'Left hip': 'hip',
  'Right thigh': 'leg',
  'Left knee': 'knee',
  'Right foot': 'foot',
};
for (const [region, expected] of Object.entries(EXPECTED)) {
  const actual = regionGlyph(region);
  check(`${region} → ${expected}`, actual === expected, actual === expected ? '' : `got ${actual}`);
}

// ------------------------------------------------- every glyph resolves to real artwork
// Guards the other silent failure: a glyph kind whose icon name has no paths renders an empty
// card, and nothing throws.
const KINDS = ['face', 'head-back', 'neck', 'torso-front', 'torso-back', 'shoulder', 'arm',
  'elbow', 'hand', 'hip', 'leg', 'knee', 'foot', 'body'];
const artless = KINDS.filter((k) => !artFor(k).length);
check(
  'every glyph kind resolves to artwork, from either source',
  artless.length === 0,
  artless.length ? `no artwork for: ${artless.map((k) => `${k}→${glyphIcon(k) ?? 'ours'}`).join(', ')}` : '',
);
check(
  'every region reachable from BODY_PARTS has artwork',
  regions.every((r) => artFor(regionGlyph(r)).length > 0),
);

// The whole reason for the second source: these four collided on Health Icons' one `joints` icon,
// and these three collided on its `head`. If a future edit points them back at a shared icon, the
// cards silently become indistinguishable — so assert they stay distinct.
const distinct = (ks) => new Set(ks.map((k) => glyphIcon(k) ?? `ours:${k}`)).size === ks.length;
check('shoulder / elbow / hip / knee stay visually distinct', distinct(['shoulder', 'elbow', 'hip', 'knee']));
check('face / head-back / neck stay visually distinct', distinct(['face', 'head-back', 'neck']));

const fromIcons = KINDS.filter((k) => glyphIcon(k)).length;
console.log(`\nbody-glyphs: ${passed} passed, ${failures.length} failed (${regions.length} regions; ${fromIcons} kinds from Health Icons, ${KINDS.length - fromIcons} ours)`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

/**
 * Dependency-free regression test for the still-image quality gate's pure core
 * (src/lib/image-quality-core.ts). Compiles the core with the project's own tsc, then asserts
 * the gate's verdicts on hand-built RGBA buffers — no jest, no native modules, no fixtures.
 *
 * Run:  npm run test:iqa
 *
 * This guards the JS side independently of the Python parity harness in SpotOn-synthetic. The
 * threshold *values* are additionally pinned against this file's constants by that harness's
 * test_iqa_parity.py (which reads image-quality-core.ts directly).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'iqa-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/image-quality-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const core = await import(pathToFileURL(join(out, 'image-quality-core.js')).href);
const { analyzeRgba, SIZE } = core;

const S = 64;
const buf = (fn) => {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const [r, g, b] = fn(x, y);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  return d;
};
const noise = (x, y) => ((x * 7 + y * 13) % 23) - 11; // deterministic fine texture

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));

// Well-lit, textured skin -> everything ok.
let r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [190 + n, 140 + n, 120 + n]; }), S, S);
check('textured skin: brightness ok', r.brightness.ok);
check('textured skin: skin ok', r.skin.ok);
check('textured skin: sharp ok', r.sharpness.ok);
check('textured skin: pass', r.brightness.ok && r.sharpness.ok && r.skin.ok);

// Too dark.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [(190 + n) * 0.1, (140 + n) * 0.1, (120 + n) * 0.1]; }), S, S);
check('dark: issue is dark', r.brightness.issue === 'dark');
check('dark: brightness not ok', !r.brightness.ok);

// Central specular glare on skin.
r = analyzeRgba(buf((x, y) => {
  const c = Math.abs(x - S / 2) < S * 0.25 && Math.abs(y - S / 2) < S * 0.25;
  const n = noise(x, y);
  return c ? [255, 255, 255] : [190 + n, 140 + n, 120 + n];
}), S, S);
check('glare: issue is glare', r.brightness.issue === 'glare');
check('glare: brightness not ok', !r.brightness.ok);

// Flat gray wall -> not skin.
r = analyzeRgba(buf(() => [150, 150, 150]), S, S);
check('gray: skin not ok', !r.skin.ok);

// Perfectly flat skin (no texture) reads as blurry.
r = analyzeRgba(buf(() => [190, 140, 120]), S, S);
check('flat skin: sharp not ok', !r.sharpness.ok);

// A one-sided luminance ramp (shadow) must NOT block the pass — shadow is advisory.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); const f = 1 - (x / S) * 0.5; return [(190 + n) * f, (140 + n) * f, (120 + n) * f]; }), S, S);
check('shadow advisory: still passes exposure+focus+skin', r.brightness.ok && r.sharpness.ok && r.skin.ok);

/* ---------------------------------------------------------- cross-file coupling ---------- */
// image-quality.ts skips the manipulateAsync re-encode when the source is already SIZE x SIZE,
// which is true for real traffic only because crop.tsx emits exactly OUTPUT = SIZE. If either
// value moves independently the gate silently falls back to the slow path — still CORRECT, but the
// saved JPEG encode quietly disappears and nothing else would notice. Pin the relationship.
{
  const cropSrc = readFileSync(join(ROOT, 'src/app/scan/crop.tsx'), 'utf8');
  const m = /const OUTPUT = (\d+)/.exec(cropSrc);
  check('crop.tsx declares OUTPUT', m != null);
  if (m) {
    check(
      `crop OUTPUT (${m[1]}) === image-quality SIZE (${SIZE}) — keeps the no-re-encode fast path live`,
      Number(m[1]) === SIZE,
    );
  }
}


if (fails.length) {
  console.error(`\nimage-quality core: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`image-quality core: ${pass} passed, 0 failed`);

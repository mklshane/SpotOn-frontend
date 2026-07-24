/**
 * Dependency-free test for the pure lesion localizer (preprocess.ts `locateLesion`). Compiles the
 * function with the project's own tsc (stripping the native-only imports first), then asserts it
 * finds a synthetic dark blob and declines on blank skin.
 *
 * Run:  node scripts/test-localizer.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'loc-'));

// locateLesion is pure, but preprocess.ts imports native modules at the top. Extract just the
// function into a standalone TS file so tsc can compile it without resolving those.
const src = readFileSync(join(ROOT, 'src/lib/classifier/preprocess.ts'), 'utf8');
const start = src.indexOf('export function locateLesion(');
const end = src.indexOf('\n}\n', start) + 3;
if (start < 0 || end < 3) throw new Error('could not extract locateLesion from preprocess.ts');
const typeDecl = 'export type CropBox = { cx: number; cy: number; half: number };\n';
writeFileSync(join(out, 'loc.ts'), typeDecl + src.slice(start, end));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['loc.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: out, stdio: 'inherit' },
);
const { locateLesion } = await import(pathToFileURL(join(out, 'loc.js')).href);

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const near = (a, b, eps = 0.08) => Math.abs(a - b) < eps;

const W = 80;
// Build an RGBA scene: warm "skin" with a dark circular lesion at (cxN,cyN).
function scene(cxN, cyN, rPx, { skin = [205, 150, 120], lesion = [60, 40, 35], hair = false } = {}) {
  const d = new Uint8Array(W * W * 4);
  const cx = cxN * W;
  const cy = cyN * W;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const inLesion = rPx > 0 && (x - cx) ** 2 + (y - cy) ** 2 <= rPx * rPx;
      // thin dark diagonal strands, like body hair — must NOT be mistaken for a lesion
      const onHair = hair && (x + y) % 11 === 0;
      const c = inLesion ? lesion : onHair ? [70, 55, 45] : skin;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
  }
  return d;
}

// Centred lesion on clean skin.
let box = locateLesion(scene(0.5, 0.5, 9), W, W, { targetFill: 0.45 });
check('finds centred lesion', box !== null);
check('centroid x centred', near(box.cx, 0.5));
check('centroid y centred', near(box.cy, 0.5));
check('half ≈ r/targetFill', near(box.half, 9 / 0.45 / W, 0.12));

// Off-centre (but inside the central search window).
box = locateLesion(scene(0.42, 0.58, 8), W, W);
check('off-centre: cx tracks', near(box.cx, 0.42));
check('off-centre: cy tracks', near(box.cy, 0.58));

// Smaller lesion → tighter crop.
const small = locateLesion(scene(0.5, 0.5, 5), W, W);
const large = locateLesion(scene(0.5, 0.5, 14), W, W);
check('smaller lesion → smaller half', small.half < large.half);

// THE REGRESSION THAT MOTIVATED DoG: hair must not win over the lesion.
box = locateLesion(scene(0.5, 0.5, 9, { hair: true }), W, W);
check('hair present: still finds lesion', box !== null && near(box.cx, 0.5, 0.12) && near(box.cy, 0.5, 0.12));

// Plain skin, no lesion → decline rather than invent one.
check('declines on blank skin', locateLesion(scene(0.5, 0.5, 0), W, W) === null);
// A single stray dark pixel is not a lesion either.
check('declines on 1px speck', locateLesion(scene(0.5, 0.5, 0.9), W, W) === null);

// A dark blob NOT surrounded by skin (grey background) → rejected by the skin-surround guard.
const grey = scene(0.5, 0.5, 9, { skin: [100, 100, 100] });
check('declines when surround is not skin', locateLesion(grey, W, W) === null);

// Degenerate inputs → null, never throw.
check('tiny image → null', locateLesion(new Uint8Array(4 * 4), 2, 2) === null);
check('truncated buffer → null', locateLesion(new Uint8Array(10), W, W) === null);

if (fails.length) {
  console.error(`\nlocalizer: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`localizer: ${pass} passed, 0 failed`);

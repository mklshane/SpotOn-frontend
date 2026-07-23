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
const near = (a, b, eps = 0.06) => Math.abs(a - b) < eps;

const W = 100;
// Skin at brightness 200 with a dark (40) circular lesion of radius R centered at (cx,cy).
function synth(cxN, cyN, rPx) {
  const g = new Uint8Array(W * W).fill(200);
  const cx = cxN * W;
  const cy = cyN * W;
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rPx * rPx) g[y * W + x] = 40;
  return g;
}

// Centered blob → box centred, half ≈ radius / targetFill.
let box = locateLesion(synth(0.5, 0.5, 18), W, W, { targetFill: 0.45 });
check('finds centered blob', box !== null);
check('centroid x centered', near(box.cx, 0.5));
check('centroid y centered', near(box.cy, 0.5));
check('half ≈ r/targetFill', near(box.half, 0.18 / 0.45, 0.1));

// Off-center blob → centroid tracks it.
box = locateLesion(synth(0.3, 0.7, 15), W, W);
check('off-center: cx tracks', near(box.cx, 0.3));
check('off-center: cy tracks', near(box.cy, 0.7));

// A smaller blob → tighter crop (smaller half) than a larger one.
const small = locateLesion(synth(0.5, 0.5, 8), W, W);
const large = locateLesion(synth(0.5, 0.5, 28), W, W);
check('smaller blob → smaller half', small.half < large.half);

// Blank skin → no blob, decline (leave framing alone).
check('declines on blank skin', locateLesion(new Uint8Array(W * W).fill(200), W, W) === null);
// A few stray dark pixels (below the count floor) → still declines.
const sparse = new Uint8Array(W * W).fill(200);
for (let i = 0; i < 10; i++) sparse[i] = 0;
check('declines on sparse noise', locateLesion(sparse, W, W) === null);
// Degenerate tiny image → null, no throw.
check('tiny image → null', locateLesion(new Uint8Array(4), 2, 2) === null);

if (fails.length) {
  console.error(`\nlocalizer: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`localizer: ${pass} passed, 0 failed`);

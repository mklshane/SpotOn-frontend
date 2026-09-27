/**
 * Dependency-free regression test for the classifier's input path: tensor packing and ImageNet
 * normalization, the NHWC → NCHW repack, the 4-view dihedral TTA, and the detector's box selection
 * and crop geometry (src/lib/classifier/preprocess.ts + detector-core.ts). Compiles the pure code
 * with the project's own tsc, the same way test-localizer.mjs does.
 *
 * None of these fail loudly when wrong. A transposed layout or a swapped mean/std is the same byte
 * count, so the interpreter accepts it and the model quietly classifies a scrambled image; a
 * mis-ordered box sort crops the wrong mole. So each property is asserted numerically here.
 *
 * Run:  npm run test:classifier
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'classifier-core-'));

// preprocess.ts imports native modules at the top; extract only the pure functions, and take the
// normalization constants from the REAL model-config.ts rather than retyping them.
const cfg = readFileSync(join(ROOT, 'src/lib/classifier/model-config.ts'), 'utf8');
const constLine = (name) => {
  const m = cfg.match(new RegExp(`^export const ${name}\\b.*$`, 'm'));
  if (!m) throw new Error(`could not find ${name} in model-config.ts`);
  return m[0];
};
const pre = readFileSync(join(ROOT, 'src/lib/classifier/preprocess.ts'), 'utf8');
const fn = (name) => {
  const start = pre.indexOf(`export function ${name}(`);
  const end = pre.indexOf('\n}\n', start) + 3;
  if (start < 0 || end < 3) throw new Error(`could not extract ${name} from preprocess.ts`);
  return pre.slice(start, end);
};
writeFileSync(
  join(out, 'pre.ts'),
  [
    "export type Normalization = 'imagenet' | 'plusMinusOne' | 'zeroOne';",
    constLine('IMAGENET_MEAN'),
    constLine('IMAGENET_STD'),
    constLine('NORMALIZATION'),
    constLine('MODEL_INPUT_LAYOUT'),
    constLine('TTA_ENABLED'),
    fn('packRgbaToTensor'),
    fn('flipTensor'),
    fn('ttaViews'),
    fn('nhwcToNchw'),
  ].join('\n'),
);
const tsc = (args, cwd) =>
  execFileSync(
    join(ROOT, 'node_modules/.bin/tsc'),
    [...args, '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
    { cwd, stdio: 'inherit' },
  );
tsc(['pre.ts'], out);
tsc(['src/lib/classifier/detector-core.ts', 'src/lib/classifier/aggregate-core.ts'], ROOT);

const P = await import(pathToFileURL(join(out, 'pre.js')).href);
const D = await import(pathToFileURL(join(out, 'detector-core.js')).href);
const A = await import(pathToFileURL(join(out, 'aggregate-core.js')).href);

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ UT-12 packing + normalization */
const SIZE = 260; // EfficientNet-B2 input side (model-config: [1, 3, 260, 260])
const rgba = new Uint8Array(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  rgba[i * 4] = (i * 7) % 256;
  rgba[i * 4 + 1] = (i * 13) % 256;
  rgba[i * 4 + 2] = (i * 29) % 256;
  rgba[i * 4 + 3] = 255;
}
check('deployed normalization is imagenet', P.NORMALIZATION === 'imagenet');
const t = P.packRgbaToTensor(rgba, SIZE, SIZE, 'imagenet');
check('tensor holds 1×260×260×3 values', t.length === 1 * SIZE * SIZE * 3);
check('alpha channel is dropped', t.length === (rgba.length / 4) * 3);
// Pixel-exact normalization against the real constants.
let normOk = true;
for (const i of [0, 1, 777, SIZE * SIZE - 1]) {
  for (let c = 0; c < 3; c++) {
    const want = (rgba[i * 4 + c] / 255 - P.IMAGENET_MEAN[c]) / P.IMAGENET_STD[c];
    if (!near(t[i * 3 + c], want, 1e-5)) normOk = false;
  }
}
check('each channel is (v/255 - mean[c]) / std[c]', normOk);
// A pixel equal to the channel mean normalizes to 0.
const meanPx = new Uint8Array([0.485 * 255, 0.456 * 255, 0.406 * 255, 255].map(Math.round));
const z = P.packRgbaToTensor(meanPx, 1, 1, 'imagenet');
check('ImageNet mean pixel → ~0 on every channel', [...z].every((v) => Math.abs(v) < 0.01));
check('ImageNet mean/std are the standard constants',
  P.IMAGENET_MEAN.join() === '0.485,0.456,0.406' && P.IMAGENET_STD.join() === '0.229,0.224,0.225');
check('R, G, B keep their order (not BGR)', near(P.packRgbaToTensor(new Uint8Array([255, 0, 0, 255]), 1, 1, 'zeroOne')[0], 1));
check('plusMinusOne maps 255 → 1 and 0 → -1', (() => {
  const v = P.packRgbaToTensor(new Uint8Array([255, 0, 0, 255]), 1, 1, 'plusMinusOne');
  return near(v[0], 1) && near(v[1], -1);
})());

// NCHW repack: the deployed export is channel-planar.
check('deployed layout is NCHW', P.MODEL_INPUT_LAYOUT === "nchw");
const nchw = P.nhwcToNchw(t, SIZE);
check('NCHW keeps the value count', nchw.length === t.length);
const plane = SIZE * SIZE;
let layoutOk = true;
for (const i of [0, 5, 12345, plane - 1]) {
  for (let c = 0; c < 3; c++) if (nchw[c * plane + i] !== t[i * 3 + c]) layoutOk = false;
}
check('NCHW plane c, pixel i == NHWC pixel i, channel c', layoutOk);

/* ------------------------------------------------------------------ UT-14 four-view TTA */
check('TTA is enabled in the shipped config', P.TTA_ENABLED === true);
const views = P.ttaViews(t, SIZE);
check('TTA produces exactly 4 views', views.length === 4);
check('view 0 is the identity', views[0] === t);
const px = (v, x, y, c) => v[(y * SIZE + x) * 3 + c];
const x0 = 17, y0 = 91, L = SIZE - 1;
check('view 1 is the horizontal flip', px(views[1], x0, y0, 0) === px(t, L - x0, y0, 0));
check('view 2 is the vertical flip', px(views[2], x0, y0, 1) === px(t, x0, L - y0, 1));
check('view 3 is the 180° rotation', px(views[3], x0, y0, 2) === px(t, L - x0, L - y0, 2));
check('the four views are pairwise distinct', new Set(views.map((v) => v.slice(0, 600).join())).size === 4);
check('a flip applied twice is the identity',
  P.flipTensor(views[1], SIZE, { horizontal: true }).every((v, i) => v === t[i]));
check('TTA does not mutate the source tensor', t[0] === P.packRgbaToTensor(rgba, SIZE, SIZE, 'imagenet')[0]);

// Pooling: classify.ts averages the views' logits with aggregate-core meanLogits, THEN softmaxes.
const viewLogits = [[4, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
const pooled = A.meanLogits(viewLogits);
check('pooled logits are the per-class mean', near(pooled[0], 1) && near(pooled[1], 0));
const logitThenSoftmax = A.softmaxT(pooled)[0];
const softmaxThenMean = viewLogits.map((v) => A.softmaxT(v)[0]).reduce((a, b) => a + b) / 4;
check('logit-space pooling ≠ softmax-space pooling', !near(logitThenSoftmax, softmaxThenMean, 1e-3));
const classifySrc = readFileSync(join(ROOT, 'src/lib/classifier/classify.ts'), 'utf8');
check('classify.ts pools TTA views with meanLogits before its softmax',
  /viewLogitsAll\.length \? meanLogitsCore\(viewLogitsAll\)/.test(classifySrc) &&
    classifySrc.indexOf('meanLogitsCore(viewLogitsAll)') < classifySrc.indexOf('softmax(values, CONFIDENCE_TEMPERATURE)'));

/* ------------------------------------------------------------------ UT-15 detector box selection */
const box = (cx, cy, bw, bh, conf) => ({ cx, cy, bw, bh, conf });
check('pins the training cropper constants',
  D.DET_CONF === 0.2 && D.FULL_FRAME === 0.95 && D.TOP_K === 3 && D.CROP_PAD === 0.45 && D.CROP_MIN_FRAC === 0.2 && D.ZOOM_CAP === 4);
check('no candidates → null', D.selectLesionBox([]) === null);
// Most central of the top three wins, even over a more confident off-centre box.
let pick = D.selectLesionBox([box(0.9, 0.9, 0.1, 0.1, 0.9), box(0.52, 0.5, 0.1, 0.1, 0.6), box(0.2, 0.2, 0.1, 0.1, 0.8)]);
check('most central of the top-3 is chosen', pick.cx === 0.52 && pick.conf === 0.6);
// A 4th, very central but least confident box is outside TOP_K and must lose.
pick = D.selectLesionBox([
  box(0.9, 0.9, 0.1, 0.1, 0.9), box(0.1, 0.1, 0.1, 0.1, 0.85), box(0.3, 0.7, 0.1, 0.1, 0.8), box(0.5, 0.5, 0.1, 0.1, 0.3),
]);
check('only the 3 most confident compete', pick.cx === 0.3);
// Full-frame boxes are rejected when a localized box exists…
pick = D.selectLesionBox([box(0.5, 0.5, 0.98, 0.97, 0.95), box(0.6, 0.4, 0.2, 0.2, 0.4)]);
check('a >0.95×0.95 box is rejected', pick.bw === 0.2);
// …but a box full-frame on only one axis is still a localized lesion.
pick = D.selectLesionBox([box(0.5, 0.5, 0.98, 0.3, 0.9)]);
check('full-frame on one axis only is kept', pick !== null && pick.bw === 0.98);
// …and used as a last resort when it is the only thing found.
pick = D.selectLesionBox([box(0.5, 0.5, 0.99, 0.99, 0.5)]);
check('only full-frame boxes → fall back to them', pick !== null && pick.bw === 0.99);
const input = [box(0.9, 0.9, 0.1, 0.1, 0.9), box(0.5, 0.5, 0.1, 0.1, 0.6)];
const before = JSON.stringify(input);
D.selectLesionBox(input);
check('selection does not reorder the caller array', JSON.stringify(input) === before);

// Crop geometry (padding + zoom limits).
let crop = D.lesionBoxToCrop(box(0.5, 0.5, 0.2, 0.1, 0.9));
check('padding: side = max(bw,bh) × 1.45', near(crop.half * 2, 0.2 * 1.45));
crop = D.lesionBoxToCrop(box(0.5, 0.5, 0.02, 0.02, 0.9));
check('zoom cap: tiny lesion never crops tighter than 1/4 frame', near(crop.half * 2, 0.25));
crop = D.lesionBoxToCrop(box(0.5, 0.5, 0.9, 0.9, 0.9));
check('large lesion clamps to the whole frame', near(crop.half, 0.5));
crop = D.lesionBoxToCrop(box(0.02, 0.97, 0.2, 0.2, 0.9));
check('crop stays inside the image at the edges',
  crop.cx - crop.half >= -1e-9 && crop.cy + crop.half <= 1 + 1e-9);
check('centred box keeps its centre', (() => {
  const c = D.lesionBoxToCrop(box(0.45, 0.55, 0.2, 0.2, 0.9));
  return near(c.cx, 0.45) && near(c.cy, 0.55);
})());

if (fails.length) {
  console.error(`classifier core: ${fails.length} FAILED\n  - ${fails.join('\n  - ')}`);
  process.exit(1);
}
console.log(`classifier core: ${pass} passed, 0 failed`);

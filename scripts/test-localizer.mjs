/**
 * Dependency-free test for the pure lesion localizer (blob-core.ts `locateLesion` and
 * `scanLesionBlobs`). Compiles blob-core.ts with the project's own tsc, then asserts it finds a
 * synthetic dark blob, declines on blank skin, and lists every spot in a multi-lesion scene.
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

// The DoG scan lives in blob-core.ts and the multi-spot rules in candidate-core.ts; neither has a
// runtime import, so tsc compiles them standalone.
for (const f of ['blob-core.ts', 'candidate-core.ts', 'face-core.ts']) {
  writeFileSync(join(out, f), readFileSync(join(ROOT, 'src/lib/classifier', f), 'utf8'));
}
writeFileSync(join(out, 'loc.ts'), "export * from './blob-core.js';\nexport * as cand from './candidate-core.js';\nexport * as face from './face-core.js';\n");

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['loc.ts', 'blob-core.ts', 'candidate-core.ts', 'face-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: out, stdio: 'inherit' },
);
// Node ESM needs the extension on relative imports that tsc leaves bare.
for (const f of ['candidate-core.js']) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '\.\/([\w-]+)'/g, "from './$1.js'"));
}
const { locateLesion, scanLesionBlobs, cand, face } = await import(pathToFileURL(join(out, 'loc.js')).href);

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
      // thin dark diagonal strands, like body hair - must NOT be mistaken for a lesion
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

// REGRESSION GUARD (over-zoom bug): a close-up photo where the lesion already fills most of the
// frame must still be found as-is, not discarded as "too big" in favor of a smaller wrong
// sub-feature. Widen centralFrac here so the test isolates the size ceiling from the separate
// edge-clip guard below - a perfect circle scaled to >70% of an 80px frame necessarily grazes the
// default centralFrac=0.7 search window, which real photos (with natural margin) don't do; that
// case is exactly what the real-photo sanity check (not this synthetic one) validates.
box = locateLesion(scene(0.5, 0.5, 30), W, W, { targetFill: 0.45, centralFrac: 0.95 });
check('large lesion (75% of frame): still found, not discarded', box !== null);
if (box) {
  check('large lesion: centroid stays centered', near(box.cx, 0.5, 0.1) && near(box.cy, 0.5, 0.1));
}

// REGRESSION GUARD (wrong-area zoom bug): found on a real upload - a strong, high-contrast mass
// anchored to the frame edge (hair spilling toward the top) out-peaks a real but faint, small
// central lesion. It must not win just because it's darker; a real lesion sits with margin inside
// the search window, while this one is clipped by the boundary. The small central lesion must
// still be the one returned.
function sceneWithEdgeClutter() {
  const d = scene(0.5, 0.5, 8, { lesion: [150, 115, 95] }); // faint, low-contrast real lesion
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 30; x++) {
      const p = (y * W + x) * 4;
      d[p] = 25; d[p + 1] = 20; d[p + 2] = 15; d[p + 3] = 255; // near-black mass touching the top edge
    }
  }
  return d;
}
box = locateLesion(sceneWithEdgeClutter(), W, W);
check(
  'edge-clipped clutter does not beat the real central lesion',
  box !== null && near(box.cx, 0.5, 0.12) && near(box.cy, 0.5, 0.12),
);

// Degenerate inputs → null, never throw.
check('tiny image → null', locateLesion(new Uint8Array(4 * 4), 2, 2) === null);
check('truncated buffer → null', locateLesion(new Uint8Array(10), W, W) === null);

// ---- Multi-spot picker (scanLesionBlobs + candidate-core) ----

// Clinical figure panel labels should not become selectable spots. A dark lesion of ordinary
// brown pixels in the same corner must remain eligible.
{
  const data = scene(0.5, 0.5, 0);
  for (let y = 67; y < 75; y++) for (let x = 67; x < 75; x++) {
    const i = (y * W + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 12;
  }
  const p = { cx: 0.88, cy: 0.88, size: 0.1, peak: 20 };
  check('corner annotation rejected', cand.isCornerAnnotation({ data, width: W, height: W }, p));
  check('same pixels away from corner retained', !cand.isCornerAnnotation({ data, width: W, height: W }, { ...p, cx: 0.5 }));
  for (let y = 67; y < 75; y++) for (let x = 67; x < 75; x++) {
    const i = (y * W + x) * 4;
    data[i] = 55; data[i + 1] = 35; data[i + 2] = 30;
  }
  check('brown corner lesion retained', !cand.isCornerAnnotation({ data, width: W, height: W }, p));
}

// Three separate lesions on skin: the scan lists all of them, wherever they are in the frame.
function multiScene() {
  const d = scene(0.5, 0.5, 0);
  for (const [cx, cy, r] of [[0.25, 0.3, 5], [0.7, 0.35, 6], [0.45, 0.75, 5]]) {
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if ((x - cx * W) ** 2 + (y - cy * W) ** 2 <= r * r) { const p = (y * W + x) * 4; d[p] = 60; d[p + 1] = 40; d[p + 2] = 35; }
    }
  }
  return d;
}
{
  const { blobs } = scanLesionBlobs(multiScene(), W, W, { ...cand.PROPOSAL_SCAN });
  const props = cand.mergeProposals(cand.blobsToProposals(blobs, W, W), W, W);
  const hit = (x, y) => props.some((p) => near(p.cx, x, 0.06) && near(p.cy, y, 0.06));
  check('multi: finds all three lesions', hit(0.25, 0.3) && hit(0.7, 0.35) && hit(0.45, 0.75));
  check('multi: no duplicate proposals', props.length === 3);
}
// Purple ink is not a lesion when minHue is set; locateLesion's default leaves it alone.
{
  const ink = scene(0.5, 0.5, 8, { lesion: [110, 50, 160] });
  check('minHue: ink rejected', scanLesionBlobs(ink, W, W, { ...cand.PROPOSAL_SCAN }).blobs.length === 0);
  check('minHue: off by default', scanLesionBlobs(ink, W, W, { centralityWeight: 0 }).blobs.length > 0);
}
// Overlapping proposals are one spot; the stronger survives.
{
  const m = cand.mergeProposals(
    [{ cx: 0.5, cy: 0.5, size: 0.1, peak: 20 }, { cx: 0.58, cy: 0.5, size: 0.1, peak: 30 }, { cx: 0.8, cy: 0.5, size: 0.1, peak: 10 }],
    100, 100,
  );
  check('mergeProposals: dedupes', m.length === 2 && m[0].peak === 30);
  check('mergeProposals: cap', cand.mergeProposals(Array.from({ length: 80 }, (_, i) => ({ cx: (i % 10) / 10, cy: Math.floor(i / 10) / 8, size: 0.01, peak: i })), 100, 100).length === cand.MAX_PROPOSALS);
}
// verifyRect stays inside the image and never under VERIFY_MIN_FRAC.
{
  const r = cand.verifyRect({ cx: 0.02, cy: 0.98, size: 0.01, peak: 1 }, 1000, 600);
  check('verifyRect: inside image', r.originX >= 0 && r.originY >= 0 && r.originX + r.side <= 1000 && r.originY + r.side <= 600);
  check('verifyRect: min size', r.side >= Math.round(600 * cand.VERIFY_MIN_FRAC));
}
// mergeCandidates: weak spots dropped, a spot inside a stronger one dropped, separate kept.
{
  const m = cand.mergeCandidates([
    { cx: 0.5, cy: 0.5, bw: 0.2, bh: 0.2, conf: 0.9 },
    { cx: 0.55, cy: 0.5, bw: 0.05, bh: 0.05, conf: 0.7 },
    { cx: 0.1, cy: 0.1, bw: 0.05, bh: 0.05, conf: 0.6 },
    { cx: 0.9, cy: 0.9, bw: 0.05, bh: 0.05, conf: 0.3 },
  ]);
  check('mergeCandidates', m.length === 2 && m[0].conf === 0.9 && m[1].cx === 0.1);
  const twin = cand.mergeCandidates([
    { cx: 0.50, cy: 0.50, bw: 0.06, bh: 0.06, conf: 0.9 },
    { cx: 0.535, cy: 0.52, bw: 0.06, bh: 0.06, conf: 0.8 },
  ]);
  check('mergeCandidates: offset twin rings on one lesion merge', twin.length === 1);
}
// absorbIntoWhole: pieces inside the whole-photo box fold into it; spots outside stay.
{
  const whole = { cx: 0.5, cy: 0.5, bw: 0.5, bh: 0.5, conf: 0.6 };
  const pieces = [
    { cx: 0.4, cy: 0.45, bw: 0.1, bh: 0.1, conf: 0.7 },
    { cx: 0.6, cy: 0.55, bw: 0.1, bh: 0.1, conf: 0.65 },
    { cx: 0.95, cy: 0.1, bw: 0.05, bh: 0.05, conf: 0.8 },
  ];
  const a = cand.absorbIntoWhole(pieces, whole, 2);
  check('absorb: folds pieces', a.length === 2 && a[0].bw === 0.5 && a[0].conf === 0.7);
  check('absorb: one piece is not enough', cand.absorbIntoWhole(pieces.slice(1), whole, 2).length === 2);
  check('absorb: weak whole ignored', cand.absorbIntoWhole(pieces, { ...whole, conf: 0.3 }, 2).length === 3);
  // On a wide photo the whole-photo box is mostly skin: the moles inside it stay separate.
  const G = 32, skinOnly = new Uint8Array(G * G * 4);
  for (let i = 0; i < G * G; i++) skinOnly.set([200, 150, 120, 255], i * 4);
  check('absorb: not when the whole box is mostly skin', cand.absorbIntoWhole(pieces, whole, 2, 0.5, cand.lumaGrid(skinOnly, G, G)).length === 3);
}
// dropOutsized: one giant box among tiny spots goes; a big lesion with real neighbours stays.
{
  const tiny = (cx) => ({ cx, cy: 0.1, bw: 0.03, bh: 0.03, conf: 0.8 });
  const giant = { cx: 0.5, cy: 0.6, bw: 0.6, bh: 0.6, conf: 0.9 };
  check('outsized: dropped among tiny spots', cand.dropOutsized([giant, tiny(0.2), tiny(0.8)], 100, 100).length === 2);
  check('outsized: kept with one neighbour', cand.dropOutsized([giant, tiny(0.2)], 100, 100).length === 2);
  check('outsized: kept with a sizeable neighbour', cand.dropOutsized([giant, tiny(0.2), { ...tiny(0.8), bw: 0.15, bh: 0.15 }], 100, 100).length === 3);
}
// joinConnected: two pieces of one dark lesion join into a box covering both; a lesion across
// skin stays separate.
{
  const G = 64;
  const d = new Uint8Array(G * G * 4);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const p = (y * G + x) * 4;
    const lesion = x >= 8 && x < 36 && y >= 20 && y < 40; // one big lesion
    const mole = (x - 52) ** 2 + (y - 30) ** 2 < 16; // a separate mole, skin between
    const c = lesion || mole ? [70, 45, 35] : [200, 150, 120];
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }
  const grid = cand.lumaGrid(d, G, G);
  const j = cand.joinConnected([
    { cx: 14 / G, cy: 30 / G, bw: 8 / G, bh: 8 / G, conf: 0.7 },
    { cx: 30 / G, cy: 30 / G, bw: 8 / G, bh: 8 / G, conf: 0.6 },
    { cx: 52 / G, cy: 30 / G, bw: 8 / G, bh: 8 / G, conf: 0.8 },
  ], grid);
  check('join: pieces joined, mole separate', j.length === 2);
  const big = j.find((c) => c.cx < 0.5);
  check('join: union box covers both pieces', big && near(big.cx, 22 / G, 0.02) && near(big.bw, 24 / G, 0.02) && big.conf === 0.7);
  // Small moles on a uniformly dark (shadowed) area chain by dark paths, but none is a sizeable
  // piece of the joined box: they stay separate.
  const dim = new Uint8Array(G * G * 4);
  for (let i = 0; i < G * G; i++) dim.set(i % G < 32 ? [90, 65, 50, 255] : [200, 150, 120, 255], i * 4);
  const moles = [6, 14, 22].map((y) => ({ cx: 0.25, cy: y / G, bw: 2 / G, bh: 2 / G, conf: 0.7 }));
  moles.push({ cx: 0.25, cy: 58 / G, bw: 2 / G, bh: 2 / G, conf: 0.7 });
  check('join: scattered moles in shadow stay separate', cand.joinConnected(moles, cand.lumaGrid(dim, G, G)).length === 4);
}
// framingFor: the crop confirm() would export always contains the WHOLE lesion box - random
// images, lesions anywhere (edges and corners too), zoom cap and minimum crop in play.
{
  let rnd = 7;
  const R = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  let ok = 0;
  const N = 3000;
  for (let k = 0; k < N; k++) {
    const IW = 300 + Math.floor(R() * 3700);
    const IH = 300 + Math.floor(R() * 3700);
    const frame = 280 + R() * 200;
    const L = 4 + R() * Math.min(IW, IH) * 0.6; // lesion box side
    const c = { cx: (L / 2 + R() * (IW - L)) / IW, cy: (L / 2 + R() * (IH - L)) / IH, bw: L / IW, bh: L / IH, conf: 1 };
    const f = cand.framingFor({
      imageW: IW, imageH: IH, frame, cx: c.cx * IW, cy: c.cy * IH,
      cropSide: cand.cropSideForLesion(c, IW, IH, 0.32), minFrac: 0.3, maxZoom: 4,
    });
    // confirm()'s export maths (scan/crop.tsx)
    const eff = (frame / Math.min(IW, IH)) * f.scale;
    const side = Math.min(IW, IH, frame / eff);
    const ox = Math.min(Math.max(0, IW / 2 - f.tx / eff - side / 2), IW - side);
    const oy = Math.min(Math.max(0, IH / 2 - f.ty / eff - side / 2), IH - side);
    const e = 1e-6;
    if (c.cx * IW - L / 2 >= ox - e && c.cx * IW + L / 2 <= ox + side + e && c.cy * IH - L / 2 >= oy - e && c.cy * IH + L / 2 <= oy + side + e) ok++;
  }
  check(`framingFor: whole lesion in crop (${ok}/${N})`, ok === N);
}
// Pixel helpers: downscale keeps aspect, squareToTensor/letterbox fill the input correctly.
{
  const img = { data: multiScene(), width: W, height: W };
  const small = cand.downscaleRgba({ data: new Uint8Array(200 * 100 * 4).fill(200), width: 200, height: 100 }, 50);
  check('downscale: aspect', small.width === 100 && small.height === 50 && small.data[0] === 200);
  const t = cand.squareToTensor(img, { originX: 0, originY: 0, side: W }, 32);
  check('squareToTensor: size + range', t.length === 32 * 32 * 3 && Math.max(...t) <= 1 && Math.min(...t) >= 0);
  const lb = cand.letterboxToTensor({ data: new Uint8Array(40 * 20 * 4).fill(255), width: 40, height: 20 }, 40);
  check('letterbox: grey bars + placement', near(lb.tensor[0], 114 / 255, 1e-6) && lb.place.h === 0.5 && lb.place.y === 0.25 && lb.tensor[(20 * 40 + 20) * 3] === 1);
}
// findSpots end to end with a fake detector that sees a lesion when the crop's centre is dark.
{
  const img = { data: multiScene(), width: W, height: W };
  const S = 64;
  const fake = async (t) => {
    const c = ((S / 2) * S + S / 2) * 3;
    return t[c] < 0.4 ? [{ cx: 0.5, cy: 0.5, bw: 0.32, bh: 0.32, conf: 0.8 }] : [];
  };
  const r = await cand.findSpots(img, { scan: scanLesionBlobs, detect: fake, detectorSize: S });
  check('findSpots: three spots for three lesions', r.spots.length === 3);
  const none = await cand.findSpots(img, { scan: scanLesionBlobs, detect: async () => [], detectorSize: 64 });
  check('findSpots: no detector boxes → no spots', none.spots.length === 0);
  // The skin gate removes spots it calls not-skin; at 0.4 everything stays.
  const gated = (notSkin, face) => cand.findSpots(img, { scan: scanLesionBlobs, detect: fake, detectorSize: S, skinGate: async () => ({ notSkin, face }), skinSize: 16 });
  check('findSpots: skin gate drops not-skin spots', (await gated(0.9, 0)).spots.length === 0);
  check('findSpots: skin gate drops whole faces', (await gated(0, 0.9)).spots.length === 0);
  check('findSpots: skin gate keeps skin spots', (await gated(0.4, 0.1)).spots.length === 3);
}

// ---- Face detector decoding (face-core) ----
{
  const A = face.faceAnchors();
  check('faces: 896 anchors', A.length === 896 * 2);
  check('faces: first anchor is stride-8 cell (0,0)', near(A[0], 0.5 / 16, 1e-6) && near(A[1], 0.5 / 16, 1e-6));
  check('faces: last anchor is stride-16 cell (7,7)', near(A[A.length - 2], 7.5 / 8, 1e-6));
  // One confident face on anchor 300, eyes 10 px either side of its centre, in a square image.
  const reg = new Float32Array(896 * 16);
  const logits = new Float32Array(896).fill(-10);
  const i = 300;
  logits[i] = 4;
  reg.set([0, 0, 64, 64, -10, -5, 10, -5], i * 16);
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const fs = face.decodeFaces(reg, logits, full);
  check('faces: decodes one face', fs.length === 1 && near(fs[0].w, 0.5, 1e-6));
  const ex = A[i * 2] - 10 / 128;
  const ey = A[i * 2 + 1] - 5 / 128;
  check('faces: eye keypoint position', near(fs[0].eyes[0].x, ex, 1e-6) && near(fs[0].eyes[0].y, ey, 1e-6));
  check('faces: weak face ignored', face.decodeFaces(reg, logits.map((v) => (v > 0 ? 1 : v)), full).length === 0);
  check('faces: spot on the eye', face.onAnEye(ex, ey, fs, 100, 100));
  check('faces: spot on the cheek kept', !face.onAnEye(ex, ey + 0.15, fs, 100, 100));
  check('faces: a box over both eyes covers the face', face.coversFace(A[i * 2], A[i * 2 + 1], 0.4, 0.3, fs));
  check('faces: a small box by one eye does not', !face.coversFace(ex, ey + 0.1, 0.05, 0.05, fs));
  // Letterboxed (image fills the middle half vertically): fractions map back to the image.
  const lb = face.decodeFaces(reg, logits, { x: 0, y: 0.25, w: 1, h: 0.5 });
  check('faces: letterbox mapping', near(lb[0].eyes[0].y, (ey - 0.25) / 0.5, 1e-6));
}

if (fails.length) {
  console.error(`\nlocalizer: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`localizer: ${pass} passed, 0 failed`);

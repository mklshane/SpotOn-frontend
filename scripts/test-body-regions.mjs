/**
 * Region-mapping coverage test for every body mesh (src/lib/body-regions.ts).
 *
 * The failure this guards is silent and was live in both directions before it existed.
 * resolveRegionFromPoint() slices the body with normalised thresholds, and a mesh whose pose does
 * not match them still returns a perfectly plausible-looking label for every tap - just the wrong
 * one, stored forever on the lesion:
 *
 *   - the male mesh holds its arms low (fingertips at 42% of height), so its hands fell below the
 *     old `ratio > 0.45` arm gate and were reported as "Left/Right thigh" - about 80% of every
 *     vertex the model called "thigh" was actually a hand.
 *   - the female mesh holds them higher (fingertips at 52%), which pushed all of them past the
 *     "forearm" height band and made "hand" UNREACHABLE - no tap anywhere could produce it.
 *
 * So this walks the real vertices of every shipped mesh through the real mapper and asserts that
 * every region is reachable, that none has collapsed to a sliver, and that the landmarks a person
 * would obviously recognise land where they should. It reads the GLBs through the bake script's
 * own parser and repeats body-model.tsx's normalisation, so it tests what actually ships.
 *
 * Run:  npm run test:regions
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MESH_SOURCES, applyMat4, collectPrimitives, parseGlb, readAccessor } from './bake-body-geometry.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'body-regions-'));

// --skipLibCheck: body-regions.ts type-imports Box3/Vector3 from three, which drags in
// @types/webxr and its DOM globals. The import is erased at emit, so checking it buys nothing.
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/body-regions.ts', 'src/lib/body-projection.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler', '--resolveJsonModule', '--skipLibCheck'],
  { cwd: ROOT, stdio: 'inherit' },
);

// body-regions.ts imports lib/i18n/core.ts for `t`. tsc leaves specifiers as written and Node's
// ESM loader needs the '.js' plus a type attribute on JSON - same fixup as test-body-glyphs.mjs.
for (const dir of [out, join(out, 'i18n')]) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith('.js')) continue;
    const file = join(dir, f.name);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        /(\bfrom\s+')(\.\.?\/[^']+)(')/g,
        (_m, a, spec, z) =>
          spec.endsWith('.json') ? `${a}${spec}${z} with { type: 'json' }` : `${a}${spec}.js${z}`,
      ),
    );
  }
}

const { resolveRegionFromPoint } = await import(pathToFileURL(join(out, 'body-regions.js')).href);
const { projectPointBetweenBodies } = await import(pathToFileURL(join(out, 'body-projection.js')).href);

/** Every region the mapper can return, so "unreachable" is checked against the full set. */
const SIDES = ['Left', 'Right'];
const LIMBS = ['upper arm', 'elbow', 'forearm', 'hand', 'thigh', 'lower leg', 'foot'];
const ALL_REGIONS = [
  'Head / Face', 'Back of head', 'Neck', 'Nape',
  'Chest', 'Upper back', 'Abdomen', 'Mid back', 'Lower abdomen', 'Lower back',
  ...SIDES.flatMap((s) => LIMBS.map((l) => `${s} ${l}`)),
];

/** A region holding less than this share of vertices has effectively collapsed. */
const MIN_SHARE = 0.003;

/** Repeats buildGeometry()'s fit from body-model.tsx: Z-up -> Y-up, centre on origin, fixed height. */
const TARGET_HEIGHT = 3.7;
function normalise(verts) {
  const ext = (get) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of verts) { const n = get(v); if (n < lo) lo = n; if (n > hi) hi = n; }
    return [lo, hi];
  };
  let pts = verts;
  const [, ] = ext((v) => v[0]);
  const [y0, y1] = ext((v) => v[1]);
  const [z0, z1] = ext((v) => v[2]);
  if (z1 - z0 > y1 - y0) pts = pts.map(([x, y, z]) => [x, z, -y]); // rotateX(-PI/2)

  const bounds = [0, 1, 2].map((axis) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[axis] < lo) lo = p[axis]; if (p[axis] > hi) hi = p[axis]; }
    return [lo, hi];
  });
  const c = bounds.map(([lo, hi]) => (lo + hi) / 2);
  const s = TARGET_HEIGHT / (bounds[1][1] - bounds[1][0]);
  return pts.map((p) => [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s]);
}

function readMesh(glbPath) {
  const { json, bin } = parseGlb(readFileSync(glbPath));
  const [{ prim, world }] = collectPrimitives(json);
  const src = readAccessor(json, bin, prim.attributes.POSITION);
  const verts = [];
  for (let i = 0; i < src.length / 3; i++) {
    verts.push(applyMat4(world, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]));
  }
  return { verts, indices: readAccessor(json, bin, prim.indices) };
}

/** Area-weighted vertex normals, the same thing three's computeVertexNormals() gives the app. */
function vertexNormals(pts, indices) {
  const n = pts.map(() => [0, 0, 0]);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const A = pts[a], B = pts[b], C = pts[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const k of [a, b, c]) { n[k][0] += f[0]; n[k][1] += f[1]; n[k][2] += f[2]; }
  }
  return n.map((v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; });
}

const box3 = (pts) => ({
  min: { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), z: Math.min(...pts.map((p) => p[2])) },
  max: { x: Math.max(...pts.map((p) => p[0])), y: Math.max(...pts.map((p) => p[1])), z: Math.max(...pts.map((p) => p[2])) },
});

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const fitted = new Map();
for (const [rel, variant] of MESH_SOURCES) {
  console.log(`\n${variant} (${rel})`);
  const { verts, indices } = readMesh(resolve(ROOT, rel));
  const pts = normalise(verts);
  const normals = vertexNormals(pts, indices);
  const box = box3(pts);
  fitted.set(variant, { pts, box, flat: Float64Array.from(pts.flat()) });
  const counts = new Map();
  for (const [x, y, z] of pts) {
    const r = resolveRegionFromPoint({ x, y, z }, box);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  for (const region of ALL_REGIONS) {
    const share = (counts.get(region) ?? 0) / pts.length;
    check(`${variant}: ${region} reachable`, share > 0, 'no vertex maps to it');
    if (share > 0) {
      check(`${variant}: ${region} not collapsed`, share >= MIN_SHARE, `only ${(share * 100).toFixed(2)}% of vertices`);
    }
  }

  // Unambiguous landmarks: whatever the pose, the widest point of a standing body is a fingertip,
  // the lowest is a foot, and the highest is the head.
  const at = (pick) => { const p = pts.reduce(pick); return resolveRegionFromPoint({ x: p[0], y: p[1], z: p[2] }, box); };
  check(`${variant}: widest vertex is a hand`, at((a, b) => (Math.abs(b[0]) > Math.abs(a[0]) ? b : a)).endsWith(' hand'));
  check(`${variant}: lowest vertex is a foot`, at((a, b) => (b[1] < a[1] ? b : a)).endsWith(' foot'));
  check(`${variant}: highest vertex is the head`, at((a, b) => (b[1] > a[1] ? b : a)).includes('head') || at((a, b) => (b[1] > a[1] ? b : a)) === 'Head / Face');

  // Anatomical left is +X on the fitted mesh - a mirrored import would silently swap every side.
  const rightmost = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
  check(`${variant}: +X side is Left`, resolveRegionFromPoint({ x: rightmost[0], y: rightmost[1], z: rightmost[2] }, box).startsWith('Left'));

  // Front/back. The viewer decides it from the tapped surface's normal (body-viewer.tsx pick()),
  // because the old `z >= box centre` test called 93-100% of the front of the shin and the front
  // of the elbow 'back' - the toes and chest push the box centre forward of both - which turned
  // the tracked-spot thumbnail around to the calf with the marker hidden. These pin the normal
  // rule to landmarks whose facing is not in doubt, and need the mesh winding to be outward.
  const facingOf = (i) => (normals[i][2] >= 0 ? 'front' : 'back');
  const frontmostIn = (keep) => {
    let best = -1;
    pts.forEach((p, i) => { if (keep(p) && (best < 0 || p[2] > pts[best][2])) best = i; });
    return best;
  };
  const ratioOf = (p) => (p[1] - box.min.y) / (box.max.y - box.min.y);
  const label = (i) => resolveRegionFromPoint({ x: pts[i][0], y: pts[i][1], z: pts[i][2] }, box, facingOf(i));
  const backmost = pts.reduce((a, p, i) => (p[2] < pts[a][2] ? i : a), 0);
  check(`${variant}: backmost vertex faces back (outward winding)`, facingOf(backmost) === 'back');
  for (const side of [1, -1]) {
    const name = side > 0 ? 'Left' : 'Right';
    const shin = frontmostIn((p) => p[0] * side > 0 && ratioOf(p) > 0.14 && ratioOf(p) < 0.24);
    check(`${variant}: front of ${name} shin is 'front'`, facingOf(shin) === 'front');
    check(`${variant}: front of ${name} shin labels lower leg`, label(shin) === `${name} lower leg`, label(shin));
  }
  const chest = frontmostIn((p) => Math.abs(p[0]) < 0.12 && ratioOf(p) > 0.74 && ratioOf(p) < 0.82);
  check(`${variant}: front of chest labels Chest`, label(chest) === 'Chest', label(chest));
  const throat = frontmostIn((p) => Math.abs(p[0]) < 0.05 && ratioOf(p) > 0.86 && ratioOf(p) < 0.89);
  check(`${variant}: front of neck labels Neck`, label(throat) === 'Neck', label(throat));

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  ${counts.size}/${ALL_REGIONS.length} regions hit; largest: ${top.map(([r, n]) => `${r} ${((n / pts.length) * 100).toFixed(1)}%`).join(', ')}`);
}

// Re-projection (src/lib/body-projection.ts): a mark saved on one mesh and drawn on the other must
// land on the matching part of the other body. Region agreement is the measurable proxy for
// "the dot is where the user put it" - a thigh mark that reappears on a hand is the failure.
// Not 100%: vertices right on a region boundary can fall either side once proportions change.
const MIN_AGREEMENT = 0.9; // measured 93.6% (male->female) and 94.0% (female->male) at 2026-09-19
const STEP = 37; // every 37th vertex - ~1,100 samples per direction, spread over the whole body
for (const [from, to] of [['male', 'female'], ['female', 'male']]) {
  const a = fitted.get(from);
  const b = fitted.get(to);
  if (!a || !b) continue;
  const region = (p, box) => resolveRegionFromPoint({ x: p[0], y: p[1], z: p[2] }, box);
  let same = 0, n = 0;
  const misses = new Map();
  for (let i = 0; i < a.pts.length; i += STEP) {
    const src = a.pts[i];
    const dst = projectPointBetweenBodies(src, { positions: a.flat, box: a.box }, { positions: b.flat, box: b.box });
    const r0 = region(src, a.box), r1 = region(dst, b.box);
    n++;
    if (r0 === r1) same++;
    else misses.set(`${r0} -> ${r1}`, (misses.get(`${r0} -> ${r1}`) ?? 0) + 1);
  }
  const rate = same / n;
  console.log(`\n${from} -> ${to}: ${(rate * 100).toFixed(1)}% of ${n} sampled marks keep their region`);
  const worst = [...misses.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
  if (worst.length) console.log(`  most common moves: ${worst.map(([k, v]) => `${k} (${v})`).join(', ')}`);
  check(`${from} -> ${to}: region agreement >= ${MIN_AGREEMENT * 100}%`, rate >= MIN_AGREEMENT, `${(rate * 100).toFixed(1)}%`);

  const tip = a.pts.reduce((x, y) => (Math.abs(y[0]) > Math.abs(x[0]) ? y : x));
  const A = { positions: a.flat, box: a.box };
  const B = { positions: b.flat, box: b.box };
  check(`${from} -> ${to}: fingertip stays a hand`, region(projectPointBetweenBodies(tip, A, B), b.box).endsWith(' hand'));
  const same0 = projectPointBetweenBodies(tip, A, A);
  check(`${from} -> ${from}: projecting onto its own mesh is a no-op`, same0.every((v, k) => v === tip[k]));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);

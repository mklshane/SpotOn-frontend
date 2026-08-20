/**
 * Dependency-free regression test for the body viewer's orbit maths (src/lib/orbit-camera.ts),
 * compiled with the project's own tsc like test-capture.mjs.
 *
 * The load-bearing assertion is the round trip: it projects the world point under the pinch back to
 * the screen after the zoom and demands it land where the fingers are. A sign error in the basis or
 * in the (1 - r'/r) term produces a camera that zooms away from the touch — obvious on a phone,
 * invisible in review, and exactly the kind of thing that used to be checked by pointing a device
 * at it.
 *
 * Run:  npm run test:orbit
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'orbit-camera-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/orbit-camera.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const m = await import(pathToFileURL(join(out, 'orbit-camera.js')).href);
const { cameraBasis, focalZoomTarget, clampTarget, toNdc } = m;

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else {
    fail++;
    console.error('  FAIL:', name);
  }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

const FOV = (42 * Math.PI) / 180;
const ASPECT = 390 / 620;

/**
 * Test-only perspective projection, written independently of the module under test: place the
 * camera at target + dir*r looking at target, then express a world point in NDC. If this and
 * focalZoomTarget agreed by construction the round trip below would prove nothing.
 */
function project(P, target, r, az, pol, fov, aspect) {
  const { dir, right, up } = cameraBasis(az, pol);
  const eye = [target[0] + dir[0] * r, target[1] + dir[1] * r, target[2] + dir[2] * r];
  const v = [P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]];
  const depth = -dot(v, dir);           // forward is -dir
  const halfH = depth * Math.tan(fov / 2);
  return { nx: dot(v, right) / (halfH * aspect), ny: dot(v, up) / halfH, depth };
}

/* ---------------------------------------------------------------- basis */
for (const [az, pol] of [[0, Math.PI / 2], [1.1, 1.0], [-2.3, 2.4], [Math.PI, 0.4]]) {
  const { dir, right, up } = cameraBasis(az, pol);
  check(`basis is unit at (${az.toFixed(1)}, ${pol.toFixed(1)})`,
    near(len(dir), 1, 1e-12) && near(len(right), 1, 1e-12) && near(len(up), 1, 1e-12));
  check(`basis is orthogonal at (${az.toFixed(1)}, ${pol.toFixed(1)})`,
    near(dot(dir, right), 0, 1e-12) && near(dot(dir, up), 0, 1e-12) && near(dot(right, up), 0, 1e-12));
  check(`right is level at (${az.toFixed(1)}, ${pol.toFixed(1)})`, near(right[1], 0, 1e-12));
}

/* ---------------------------------------------------------------- the round trip */
// The point under the fingers must still be under the fingers after the zoom.
{
  const target = [0, -0.05, 0];
  for (const [az, pol] of [[0, Math.PI / 2], [0.8, 1.2], [-1.9, 2.0]]) {
    for (const [nx, ny] of [[0.6, 0.4], [-0.5, 0.7], [0.9, -0.9], [0, 0]]) {
      for (const [r0, r1] of [[6.4, 4.0], [6.4, 9.0], [5.0, 5.0]]) {
        // The world point the fingers are over, on the plane through the target.
        const { right, up } = cameraBasis(az, pol);
        const halfH = r0 * Math.tan(FOV / 2);
        const halfW = halfH * ASPECT;
        const P = [
          target[0] + right[0] * nx * halfW + up[0] * ny * halfH,
          target[1] + right[1] * nx * halfW + up[1] * ny * halfH,
          target[2] + right[2] * nx * halfW + up[2] * ny * halfH,
        ];
        const before = project(P, target, r0, az, pol, FOV, ASPECT);
        check(`setup: P projects to the focal point (${nx},${ny})`,
          near(before.nx, nx, 1e-9) && near(before.ny, ny, 1e-9));

        const t1 = focalZoomTarget(target, r0, r1, az, pol, nx, ny, FOV, ASPECT);
        const after = project(P, t1, r1, az, pol, FOV, ASPECT);
        check(`focal point holds through zoom ${r0}->${r1} at (${nx},${ny})`,
          near(after.nx, nx, 1e-7) && near(after.ny, ny, 1e-7));
      }
    }
  }
}

/* ---------------------------------------------------------------- direction + degenerate cases */
{
  const target = [0, 0, 0];
  const az = 0, pol = Math.PI / 2;   // looking down -z, right = +x, up = +y
  const inTarget = focalZoomTarget(target, 6.4, 4.0, az, pol, 0.8, 0, FOV, ASPECT);
  check('zooming in moves the target toward the focal side', inTarget[0] > 0);
  const outTarget = focalZoomTarget(target, 6.4, 9.0, az, pol, 0.8, 0, FOV, ASPECT);
  check('zooming out moves the target away from the focal side', outTarget[0] < 0);
  check('zoom in then back out returns to the start',
    near(focalZoomTarget(inTarget, 4.0, 6.4, az, pol, 0.8, 0, FOV, ASPECT)[0], 0, 1e-9));

  const centred = focalZoomTarget(target, 6.4, 3.0, az, pol, 0, 0, FOV, ASPECT);
  check('a centred pinch leaves the target alone (old behaviour preserved)',
    centred[0] === 0 && centred[1] === 0 && centred[2] === 0);
  const noZoom = focalZoomTarget(target, 6.4, 6.4, az, pol, 0.9, 0.9, FOV, ASPECT);
  check('no radius change means no target change', near(noZoom[0], 0) && near(noZoom[1], 0));
  check('a zero start radius is a no-op, not a division by zero',
    focalZoomTarget(target, 0, 3, az, pol, 0.5, 0.5, FOV, ASPECT)[0] === 0);
  check('upward focal moves the target up', focalZoomTarget(target, 6.4, 4, az, pol, 0, 0.8, FOV, ASPECT)[1] > 0);
}

/* ---------------------------------------------------------------- clamp + ndc */
{
  const min = [-1, -2, -1];
  const max = [1, 2, 1];
  check('inside the box is untouched', clampTarget([0.5, 1, -0.5], min, max).every((v, i) => v === [0.5, 1, -0.5][i]));
  check('past the box is pulled back', clampTarget([9, 9, 9], min, max)[0] === 1);
  check('slack widens the box', clampTarget([1.4, 0, 0], min, max, 0.5)[0] === 1.4);
  check('slack is finite', clampTarget([9, 0, 0], min, max, 0.5)[0] === 1.5);

  check('centre of the view is NDC origin', (() => { const n = toNdc(50, 100, 100, 200); return n.nx === 0 && n.ny === 0; })());
  check('NDC y is up', toNdc(50, 0, 100, 200).ny === 1);
  check('NDC x is right', toNdc(100, 100, 100, 200).nx === 1);
  check('a zero-sized view is a no-op', toNdc(10, 10, 0, 0).nx === 0);
}

if (fail > 0) {
  console.error(`orbit camera: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`orbit camera: ${pass} passed, 0 failed`);

/**
 * Dependency-free regression test for the live box's smoothing/tracking layer
 * (src/lib/detection-smoothing.ts), compiled with the project's own tsc like test-capture.mjs.
 *
 * These are the properties that make the box feel stable, and every one of them is invisible on a
 * phone until it is wrong: an underdamped spring reads as "the model is twitchy", a hard deadband
 * reads as "the box lags then jumps", a missing association gate reads as "it keeps grabbing the
 * other mole". Asserting them here is cheaper than re-recording a screen capture each time someone
 * re-tunes a constant.
 *
 * Run:  npm run test:smoothing
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'detection-smoothing-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/detection-smoothing.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const m = await import(pathToFileURL(join(out, 'detection-smoothing.js')).href);
const {
  DETECTION_SMOOTHING_CONFIG: CFG,
  criticalDamping, boxSpring, softDeadband, stepAssociation, initialAssociationState,
} = m;

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

/* ---------------------------------------------------------------- spring damping */
// The bug this replaced: damping 24 at stiffness 320 is a ratio of 0.67, so every detection
// overshot and rang back at the detector's cadence.
{
  const s = boxSpring();
  const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  check('box spring is critically damped (no overshoot)', near(ratio, 1, 1e-12));
  check('box spring is not overdamped (no added lag)', ratio <= 1 + 1e-12);
  check('the superseded config was underdamped', 24 / (2 * Math.sqrt(320)) < 0.7);
  check('criticalDamping matches the closed form', near(criticalDamping(320, 1), 2 * Math.sqrt(320)));
  check('criticalDamping scales with mass', near(criticalDamping(100, 4), 2 * Math.sqrt(400)));
}

/* ---------------------------------------------------------------- soft deadband */
{
  const eps = CFG.positionDeadband;
  check('sub-threshold move is suppressed', softDeadband(0.5 + eps / 2, 0.5, eps) === 0.5);
  check('deadband is symmetric', softDeadband(0.5 - eps / 2, 0.5, eps) === 0.5);
  check('no previous value → accept', softDeadband(0.42, null, eps) === 0.42);
  check('exactly at the threshold is suppressed', softDeadband(0.5 + eps, 0.5, eps) === 0.5);

  // The point of "soft": movement past the band arrives reduced by the band, not at full size and
  // not as an accumulated step.
  check('supra-threshold move passes through, offset by the band',
    near(softDeadband(0.5 + eps * 3, 0.5, eps), 0.5 + eps * 2));
  check('response is continuous at the threshold',
    near(softDeadband(0.5 + eps * 1.000001, 0.5, eps), 0.5, eps * 1e-5));

  // The hard deadband's failure mode, asserted as an absence: creeping the target past the band in
  // sub-threshold steps must never produce a jump larger than one step.
  let v = 0.5;
  let maxStep = 0;
  for (let i = 0; i < 500; i++) {
    const target = 0.5 + i * eps * 0.4;
    const next = softDeadband(target, v, eps);
    maxStep = Math.max(maxStep, Math.abs(next - v));
    v = next;
  }
  check('slow drift never releases an accumulated jump', maxStep <= eps * 0.4 + 1e-12);
  check('slow drift does eventually follow the target', v > 0.5);

  // Size is damped harder than position — the constant that stops the box breathing.
  check('size deadband is wider than position', CFG.sizeDeadbandScale > 1);
  check('size is smoothed harder than centre', CFG.size.minCutoff < CFG.position.minCutoff);
  check('size chases motion less eagerly than centre', CFG.size.beta < CFG.position.beta);
}

/* ---------------------------------------------------------------- association */
{
  const S0 = initialAssociationState;
  const centre = { x: 0.5, y: 0.5 };
  const near_ = { x: 0.52, y: 0.51 };
  const far = { x: 0.95, y: 0.9 };

  check('first detection is accepted with no track', stepAssociation(S0, null, near_).accept);
  check('first detection is not a handover', !stepAssociation(S0, null, near_).handover);
  check('a nearby detection is accepted', stepAssociation(S0, centre, near_).accept);
  check('a nearby detection clears the far streak',
    stepAssociation({ farStreak: 2 }, centre, near_).state.farStreak === 0);

  const one = stepAssociation(S0, centre, far);
  check('a distant detection is rejected', !one.accept);
  check('a distant detection counts toward handover', one.state.farStreak === 1);

  // ...but the gate must not trap the track on a lesion the user has actually left.
  let st = S0;
  let steps = 0;
  let handed = false;
  for (let i = 0; i < 10 && !handed; i++) {
    const r = stepAssociation(st, centre, far);
    st = r.state;
    steps++;
    handed = r.handover && r.accept;
  }
  check('a persistent new object takes over the track', handed);
  check('handover takes exactly handoverFrames frames', steps === CFG.handoverFrames);
  check('handover resets the streak', st.farStreak === 0);

  // Distance is measured to the CENTRE, in screen fractions — a box cannot cross a quarter of the
  // frame between two detections 83 ms apart, but two separate moles easily sit that far apart.
  check('the gate is looser than any plausible single-frame move', CFG.maxTrackingDistance > 0.15);
  check('the gate is tighter than the frame', CFG.maxTrackingDistance < 0.5);
  check('handover is fast enough not to feel stuck', CFG.handoverFrames <= 5);
}

/* ---------------------------------------------------------------- config sanity */
{
  check('fades are short enough not to read as lag', CFG.fadeOutMs <= 300 && CFG.fadeInMs <= 200);
  check('fade in is quicker than fade out', CFG.fadeInMs <= CFG.fadeOutMs);
  check('deadbands are sub-pixel-ish fractions of the screen', CFG.positionDeadband < 0.02);
}

if (fail > 0) {
  console.error(`detection smoothing: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`detection smoothing: ${pass} passed, 0 failed`);

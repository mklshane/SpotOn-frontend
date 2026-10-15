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
  ['src/lib/detection-smoothing.ts', 'src/lib/one-euro.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const m = await import(pathToFileURL(join(out, 'detection-smoothing.js')).href);
const { makeOneEuro } = await import(pathToFileURL(join(out, 'one-euro.js')).href);
const {
  DETECTION_SMOOTHING_CONFIG: CFG,
  criticalDamping, boxSpring, softDeadband, stepAssociation, initialAssociationState, predictLead,
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

  // Size is damped harder than position - the constant that stops the box breathing.
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

  // Distance is measured to the CENTRE, in screen fractions - a box cannot cross a quarter of the
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

/* ------------------------------------------------------------------ end-to-end follow quality */
// The whole drawn-box pipeline in one axis, with the real filter, deadband, lead and spring:
// detector at ~9 fps with +-35 ms cadence jitter (what the second recording measured) and 60 ms
// result latency, Gaussian box noise -> 1€ -> soft deadband ->
// latency lead -> critically damped spring integrated at 1 ms -> what the user sees. The 2026-10-15
// screen recording showed the box trailing a drifting mole; these numbers are that trail.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) * Math.SQRT2; };
  const simulate = (p, truth, durMs, noise) => {
    seed = 7;
    const f = makeOneEuro(p.minCutoff, p.beta, p.dCutoff);
    let interval = 111;
    let lastAt = null;
    const latency = 60;
    const k = p.stiffness;
    const c = 2 * Math.sqrt(k);
    const queue = [];
    const outp = [];
    let nextDet = 0;
    let prev = null;
    let target = null;
    let pos = null;
    let vel = 0;
    for (let t = 0; t <= durMs; t++) {
      if (t >= nextDet) {
        queue.push({ at: t, value: truth(t) + noise * gauss() });
        nextDet += 111 + 70 * (rnd() - 0.5);
      }
      while (queue.length && queue[0].at + latency <= t) {
        const d = queue.shift();
        let fx = softDeadband(f.filter(d.value, t), prev, CFG.positionDeadband);
        prev = fx;
        if (lastAt !== null) interval = interval * 0.7 + (t - lastAt) * 0.3;
        lastAt = t;
        if (p.lead) fx += predictLead(f.velocity(), t - d.at, interval);
        target = fx;
        if (pos === null) pos = target;
      }
      if (pos !== null) {
        vel += (k * (target - pos) - c * vel) * 0.001;
        pos += vel * 0.001;
        outp.push({ t, pos, err: pos - truth(t) });
      }
    }
    return outp;
  };
  const measure = (p) => {
    const still = simulate(p, () => 0.5, 5000, 0.006).filter((o) => o.t > 1000);
    const mean = still.reduce((a, o) => a + o.pos, 0) / still.length;
    const jitter = Math.sqrt(still.reduce((a, o) => a + (o.pos - mean) ** 2, 0) / still.length);
    const v = 0.3;
    const pan = simulate(p, (t) => 0.2 + (v * t) / 1000, 2500, 0.003).filter((o) => o.t > 1200 && o.t < 2400);
    const lagMs = (-pan.reduce((a, o) => a + o.err, 0) / pan.length / v) * 1000;
    // Stutter: how unevenly the box moves per 60 Hz display frame on a steady pan, relative to the
    // true per-frame motion. Dash-stop motion (a spring that arrives long before the next detection)
    // scores high even when the average trail is small - it is what "jittery" looks like on device.
    const frames = pan.filter((o) => o.t % 17 === 0);
    const ideal = (v * 17) / 1000;
    const steps = frames.slice(1).map((o, i) => o.pos - frames[i].pos);
    const stutter = Math.sqrt(steps.reduce((a, d) => a + (d - ideal) ** 2, 0) / steps.length) / ideal;
    // Pan, then a 150 ms cosine deceleration to rest - a hand stopping, not a wall.
    const T0 = 1000;
    const D = 150;
    const end = 0.2 + (v * T0) / 1000 + v * (D / 1000) * (2 / Math.PI);
    const stopTruth = (t) => (t < T0 ? 0.2 + (v * t) / 1000
      : t < T0 + D ? 0.2 + (v * T0) / 1000 + v * (D / 1000) * (2 / Math.PI) * Math.sin(((t - T0) / D) * (Math.PI / 2))
        : end);
    const overshoot = Math.max(0, ...simulate(p, stopTruth, 3000, 0).filter((o) => o.t > T0).map((o) => o.err));
    return { jitter, lagMs, overshoot, stutter };
  };
  const now = measure({ ...CFG.position, dCutoff: CFG.dCutoff, stiffness: CFG.spring.stiffness, lead: true });
  const shipped = measure({ minCutoff: 1.5, beta: 0.05, dCutoff: 1, stiffness: 320, lead: false });
  const stiff = measure({ ...CFG.position, dCutoff: CFG.dCutoff, stiffness: 1600, lead: true });
  console.log(`  follow: lag ${now.lagMs.toFixed(0)} ms (was ${shipped.lagMs.toFixed(0)}), ` +
    `jitter ${now.jitter.toFixed(4)} (was ${shipped.jitter.toFixed(4)}), ` +
    `stutter ${now.stutter.toFixed(2)} (was ${shipped.stutter.toFixed(2)}; stiff spring ${stiff.stutter.toFixed(2)}), ` +
    `overshoot ${now.overshoot.toFixed(4)}`);
  check('the shipped config trailed a pan by over 250 ms (the first recording)', shipped.lagMs > 250);
  check('the box trails a 0.3 screen/s pan by under 200 ms', now.lagMs < 200);
  check('the box cuts the shipped trail by at least 40%', now.lagMs < shipped.lagMs * 0.6);
  check('motion is as even as the shipped box (within 10%)', now.stutter <= shipped.stutter * 1.1);
  check('a stiff spring is measurably stutterier (the second recording)', stiff.stutter > 2 * now.stutter);
  check('held still, the box is no jitterier than the shipped config', now.jitter <= shipped.jitter);
  check('a hand coming to rest overshoots by under 0.02 of the screen', now.overshoot < 0.02);

  check('lead is zero below the speed dead zone', predictLead(CFG.lead.minSpeed * 0.9, 60, 83) === 0);
  check('lead follows the direction of motion', predictLead(0.5, 60, 83) > 0 && predictLead(-0.5, 60, 83) < 0);
  check('lead is capped on a wild swing', Math.abs(predictLead(50, 60, 83)) <= CFG.lead.maxLead);
  check('lead time is capped on a slow phone', predictLead(0.3, 5000, 2000) <= 0.3 * CFG.lead.maxLeadMs / 1000 + 1e-12);
  check('non-finite speed never moves the box', predictLead(Number.NaN, 60, 83) === 0);
}

if (fail > 0) {
  console.error(`detection smoothing: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`detection smoothing: ${pass} passed, 0 failed`);

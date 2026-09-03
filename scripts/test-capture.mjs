/**
 * Dependency-free regression test for the live capture logic (src/lib/capture-core.ts).
 * Compiles the pure core with the project's own tsc, the same way test-tps.mjs does.
 *
 * capture.tsx had no automated coverage at all, and the coordinate mapping is the highest-risk
 * untested code in the app: a sign error there does not throw or look broken, it silently crops
 * off-target and quietly degrades every classification. Nothing downstream can detect it — which is
 * exactly why it is asserted here as an algebraic round-trip rather than eyeballed on a phone.
 *
 * Run:  npm run test:capture
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'capture-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/capture-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const c = await import(pathToFileURL(join(out, 'capture-core.js')).href);
const {
  computeCoach, stepTrack, stepStability, isStable, applyDeadband, initialTrackState,
  modelCropToFullFrame, fullFrameToModelCrop, fullFrameToPreview, previewToFullFrame, padDrawnBox,
  CREATE_SCORE, KEEP_SCORE, DETECT_SHOW, KEEP_GRACE, STABLE_EPS, STABLE_FRAMES, DEADBAND,
  FAR_MAX, CLOSE_MIN, OFFSET_MAX,
  GATE_OK, GATE_DARK, GATE_BLURRY,
} = c;

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const boxNear = (a, b, eps = 1e-9) =>
  near(a.cx, b.cx, eps) && near(a.cy, b.cy, eps) && near(a.w, b.w, eps) && near(a.h, b.h, eps);

/* ------------------------------------------------------------------ coaching */
const M = (o = {}) => ({ cx: 0.5, cy: 0.5, w: 0.4, h: 0.4, locked: true, stable: true, ...o });

// Lighting and focus outrank position — there is no point asking someone to centre a spot they
// cannot see, and stacked messages are worse than one.
for (const [gate, expected] of [[GATE_DARK, 'dark'], [GATE_BLURRY, 'blurry']]) {
  check(`gate ${expected} outranks framing`, computeCoach(true, gate, M({ cx: 0.9, w: 0.01 })) === expected);
  check(`gate ${expected} shows even with no box`, computeCoach(true, gate, null) === expected);
}
check('guide off → no coach', computeCoach(false, GATE_OK, null) === null);
check('gates still fire with the guide off', computeCoach(false, GATE_DARK, null) === 'dark');
check('no box → search', computeCoach(true, GATE_OK, null) === 'search');

// The positional ladder, in order.
check('too small → far', computeCoach(true, GATE_OK, M({ w: FAR_MAX - 0.01, h: 0 })) === 'far');
check('too large → close', computeCoach(true, GATE_OK, M({ w: CLOSE_MIN + 0.01 })) === 'close');
check('off centre on x → offcenter', computeCoach(true, GATE_OK, M({ cx: 0.5 + OFFSET_MAX + 0.01 })) === 'offcenter');
check('off centre on y → offcenter', computeCoach(true, GATE_OK, M({ cy: 0.5 - OFFSET_MAX - 0.01 })) === 'offcenter');
check('unlocked → search', computeCoach(true, GATE_OK, M({ locked: false })) === 'search');
check('locked but moving → steady', computeCoach(true, GATE_OK, M({ stable: false })) === 'steady');
check('locked and settled → ready', computeCoach(true, GATE_OK, M()) === 'ready');

// Distance is judged on the LONGER side, so an elongated lesion isn't called "far" on its short one.
check('size uses max(w,h)', computeCoach(true, GATE_OK, M({ w: 0.01, h: 0.4 })) !== 'far');

// "ready" is what auto-capture would fire on, so it must require every condition at once.
for (const bad of [{ locked: false }, { stable: false }, { w: 0.01, h: 0.01 }, { cx: 0.95 }]) {
  check(`ready requires all conditions (${JSON.stringify(bad)})`, computeCoach(true, GATE_OK, M(bad)) !== 'ready');
}

/* ------------------------------------------------------------------ tracking hysteresis */
const run = (inputs) => {
  let s = initialTrackState;
  const seen = [];
  for (const i of inputs) {
    const r = stepTrack(s, i.score ?? null);
    s = r.state;
    // Mirror the screen's ordering: stability is only updated once a box actually survived.
    if (r.visible) s = { ...s, stableStreak: stepStability(s.stableStreak, i.moved ?? 1) };
    seen.push(r);
  }
  return { state: s, seen };
};

// A weak box can never START a track, however long it persists — that is the CREATE bar.
{
  const { seen } = run(Array.from({ length: 20 }, () => ({ score: CREATE_SCORE - 0.01 })));
  check('weak detections never start a track', seen.every((r) => !r.visible));
}

// A strong box needs DETECT_SHOW consecutive frames before it appears (no single-frame flashes).
{
  const { seen } = run(Array.from({ length: 4 }, () => ({ score: 0.9 })));
  check('strong box hidden before DETECT_SHOW', !seen[DETECT_SHOW - 2].visible);
  check('strong box appears at DETECT_SHOW', seen[DETECT_SHOW - 1].visible);
}

// Acquisition: one strong frame banks evidence, and the CONFIRMING frame only has to clear KEEP.
// Before 2026-08-20 this needed two frames at CREATE, which under the current detector meant
// waiting for two lucky frames (~7 detector frames on average) before the box appeared.
{
  const { seen } = run([{ score: CREATE_SCORE }, { score: KEEP_SCORE }]);
  check('strong frame + keep-bar confirmation shows the box', seen[1].visible);
  check('the confirming frame alone is not enough', !seen[0].visible);

  // The evidence bar for STARTING a track is unchanged: without a frame at CREATE, nothing builds.
  const weak = run(Array.from({ length: 20 }, () => ({ score: KEEP_SCORE })));
  check('keep-bar frames alone never create a track', !weak.state.active);
  check('keep-bar frames alone never draw a box', weak.seen.every((r) => !r.visible));
  check('a sub-CREATE frame with nothing banked decays to zero', weak.state.detectStreak === 0);

  // A single strong frame that is never confirmed must not leave the box on screen.
  const oneStrong = run([{ score: 0.9 }]);
  check('one strong frame is not yet a track', !oneStrong.seen[0].visible);
}

// Once active, the LOWER bar sustains it. This is the anti-flicker property: a score hovering
// between KEEP and CREATE would strobe under a single threshold.
{
  const { seen } = run([
    ...Array.from({ length: DETECT_SHOW }, () => ({ score: 0.9 })),
    ...Array.from({ length: 10 }, () => ({ score: KEEP_SCORE })),
  ]);
  check('active track survives on the KEEP bar', seen.slice(DETECT_SHOW).every((r) => r.visible));
}

// Misses are forgiven up to KEEP_GRACE, then the track drops.
{
  const warm = Array.from({ length: DETECT_SHOW + KEEP_GRACE }, () => ({ score: 0.9 }));
  const { seen } = run([...warm, ...Array.from({ length: DETECT_SHOW + KEEP_GRACE }, () => ({ score: null }))]);
  const afterWarm = seen.slice(warm.length);
  check('a brief miss does not clear the track', !afterWarm[0].cleared);
  check('sustained misses eventually clear it', afterWarm.some((r) => r.cleared));
  check('clearing deactivates the track', run([...warm, ...Array.from({ length: 99 }, () => ({ score: null }))]).state.active === false);
}
check('a miss always resets the stability streak', run([{ score: 0.9, moved: 0 }, { score: null }]).state.stableStreak === 0);

/* ------------------------------------------------------------------ stability */
{
  const still = Array.from({ length: DETECT_SHOW + STABLE_FRAMES }, () => ({ score: 0.9, moved: 0 }));
  check('holding still becomes stable', isStable(run(still).state));
  check('one jolt breaks stability', !isStable(run([...still, { score: 0.9, moved: STABLE_EPS * 2 }]).state));
  check('movement at exactly STABLE_EPS is not still', run([...still, { score: 0.9, moved: STABLE_EPS }]).state.stableStreak === 0);
}

/* ------------------------------------------------------------------ deadband */
check('sub-deadband move is suppressed', applyDeadband(0.5 + DEADBAND / 2, 0.5, DEADBAND) === 0.5);
check('real move passes through', near(applyDeadband(0.5 + DEADBAND * 2, 0.5, DEADBAND), 0.5 + DEADBAND * 2));
check('no previous value → accept', applyDeadband(0.42, null, DEADBAND) === 0.42);
check('deadband is symmetric', applyDeadband(0.5 - DEADBAND / 2, 0.5, DEADBAND) === 0.5);
// Repeated sub-threshold nudges must not accumulate — that is the creep this exists to stop.
{
  let v = 0.5;
  for (let i = 0; i < 500; i++) v = applyDeadband(v + DEADBAND * 0.4, v, DEADBAND);
  check('sub-threshold nudges never accumulate into drift', v === 0.5);
}

/* ------------------------------------------------------------------ THE coordinate mapping */
// Portrait sensor frames and a handful of real screen shapes.
const FRAMES = [[1080, 1920], [1920, 1080], [720, 1280], [1440, 1440]];
const SCREENS = [[390, 844], [430, 932], [375, 667], [768, 1024]];
const BOXES = [
  { cx: 0.5, cy: 0.5, w: 0.4, h: 0.4 },
  { cx: 0.2, cy: 0.8, w: 0.1, h: 0.15 },
  { cx: 0.75, cy: 0.25, w: 0.6, h: 0.2 },
  { cx: 0.5, cy: 0.5, w: 1.0, h: 1.0 },
];

// Round-trip: translate out and back, and you must land exactly where you started. This is what
// catches a sign error or a swapped dimension — the failure mode that otherwise shows up only as
// "the model seems worse than it should be".
let rtCrop = 0, rtPreview = 0;
for (const [fw, fh] of FRAMES) {
  for (const b of BOXES) {
    if (boxNear(fullFrameToModelCrop(modelCropToFullFrame(b, fw, fh), fw, fh), b, 1e-12)) rtCrop++;
    for (const [sw, sh] of SCREENS) {
      if (boxNear(previewToFullFrame(fullFrameToPreview(b, fw, fh, sw, sh), fw, fh, sw, sh), b, 1e-12)) rtPreview++;
    }
  }
}
check(`model-crop round-trip exact (${rtCrop}/${FRAMES.length * BOXES.length})`, rtCrop === FRAMES.length * BOXES.length);
check(
  `preview round-trip exact (${rtPreview}/${FRAMES.length * BOXES.length * SCREENS.length})`,
  rtPreview === FRAMES.length * BOXES.length * SCREENS.length,
);

// Anchors: a centred box must stay centred through both stages, on every shape. If the maths is
// inverted, this is the assertion that says so in one line.
for (const [fw, fh] of FRAMES) {
  const centred = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 };
  const full = modelCropToFullFrame(centred, fw, fh);
  check(`centre survives the crop undo (${fw}x${fh})`, near(full.cx, 0.5) && near(full.cy, 0.5));
  for (const [sw, sh] of SCREENS) {
    const p = fullFrameToPreview(full, fw, fh, sw, sh);
    check(`centre survives the preview map (${fw}x${fh} → ${sw}x${sh})`, near(p.cx, 0.5) && near(p.cy, 0.5));
  }
}

// Direction: the model's y band is the MIDDLE of a portrait frame, so undoing the crop must pull
// points toward the centre, never push them out. An inverted sign shows up here immediately.
{
  const top = modelCropToFullFrame({ cx: 0.5, cy: 0.0, w: 0.1, h: 0.1 }, 1080, 1920);
  const bot = modelCropToFullFrame({ cx: 0.5, cy: 1.0, w: 0.1, h: 0.1 }, 1080, 1920);
  check('crop undo maps the model top INTO the frame', top.cy > 0 && top.cy < 0.5);
  check('crop undo maps the model bottom INTO the frame', bot.cy < 1 && bot.cy > 0.5);
  check('crop undo compresses height on a portrait frame', top.h < 0.1);
  check('crop undo leaves width alone', near(top.w, 0.1));
}
// A square frame has no crop band to undo — the mapping must be the identity.
check('square frame is an identity crop', boxNear(modelCropToFullFrame(BOXES[1], 1440, 1440), BOXES[1]));

// Axis independence: move the lesion in ONE axis and only that axis may respond. Moving both at
// once (as a naive monotonicity check does) is passed by a cx/cy swap, so it has to be one at a
// time — a swapped axis is a real failure mode that still round-trips on square-ish shapes.
{
  let ok = 0, total = 0;
  for (const [fw, fh] of FRAMES) for (const [sw, sh] of SCREENS) {
    const base = { cx: 0.3, cy: 0.3, w: 0.1, h: 0.1 };
    const p0 = fullFrameToPreview(base, fw, fh, sw, sh);
    const px = fullFrameToPreview({ ...base, cx: 0.7 }, fw, fh, sw, sh);
    const py = fullFrameToPreview({ ...base, cy: 0.7 }, fw, fh, sw, sh);
    total++;
    // x moves x and leaves y alone; y moves y and leaves x alone.
    if (px.cx > p0.cx && near(px.cy, p0.cy) && py.cy > p0.cy && near(py.cx, p0.cx)) ok++;
  }
  check(`preview mapping moves each axis independently (${ok}/${total})`, ok === total);
}

/* ------------------------------------------------------------------ drawn-box padding */
check('padding grows the box', padDrawnBox({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }, 0.25, 0.98).w > 0.2);
check('padding never moves the centre', padDrawnBox({ cx: 0.3, cy: 0.7, w: 0.2, h: 0.2 }, 0.25, 0.98).cx === 0.3);
check('padding is capped', padDrawnBox({ cx: 0.5, cy: 0.5, w: 5, h: 5 }, 0.25, 0.98).w === 0.98);

if (fails.length) {
  console.error(`\ncapture core: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`capture core: ${pass} passed, 0 failed`);

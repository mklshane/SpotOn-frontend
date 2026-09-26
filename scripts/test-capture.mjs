/**
 * Dependency-free regression test for the live capture logic (src/lib/capture-core.ts).
 * Compiles the pure core with the project's own tsc, the same way test-tps.mjs does.
 *
 * capture.tsx had no automated coverage at all, and the coordinate mapping is the highest-risk
 * untested code in the app: a sign error there does not throw or look broken, it silently crops
 * off-target and quietly degrades every classification. Nothing downstream can detect it - which is
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
  ['src/lib/capture-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const c = await import(pathToFileURL(join(out, 'capture-core.js')).href);
const {
  computeCoach, stepTrack, stepStability, isStable, applyDeadband, initialTrackState,
  modelCropToFullFrame, fullFrameToModelCrop, fullFrameToPreview, previewToFullFrame, padDrawnBox,
  roiFractionForZoom, searchRoiForZoom, modelRoiToFullFrame, fullFrameToModelRoi,
  SEARCH_FRACTIONS, nextSearchCrop, focusedSearchRoi, sensorCropForRoi, localSkinRoi,
  stepLocalSkin, acceptsSession,
  allowsVisibleTarget,
  clusterDetectionCandidates, boxIou, stepActiveTarget, initialActiveTargetState,
  isLocalized,
  uprightRotation, stepScene, initialSceneState, SCENE_CONFIRM,
  MAX_CLUSTERED_CANDIDATES,
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

// Lighting and focus outrank position - there is no point asking someone to centre a spot they
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

// The live skin gate (2026-09-19): a whole face got a confident green box and "ready", because the
// detector fires on any skin. A face / scene verdict outranks every positional message.
check('face outranks a locked, settled box', computeCoach(true, GATE_OK, M(), 'face') === 'face');
check('not skin outranks a locked box', computeCoach(true, GATE_OK, M(), 'not_skin') === 'notskin');
check('dark still outranks face', computeCoach(true, GATE_DARK, M(), 'face') === 'dark');
check('guide off silences the face coach too', computeCoach(false, GATE_OK, M(), 'face') === null);
check('unknown scene (model not loaded) changes nothing', computeCoach(true, GATE_OK, M(), 'unknown') === 'ready');
check('skin scene changes nothing', computeCoach(true, GATE_OK, M(), 'skin') === 'ready');

// The verdict is debounced: one odd read can't flash the box off, SCENE_CONFIRM agreeing reads can.
{
  let st = initialSceneState;
  for (let i = 0; i < SCENE_CONFIRM - 1; i++) st = stepScene(st, 'face');
  check('one face read short of confirm does not switch', st.scene === 'unknown');
  st = stepScene(st, 'face');
  check('SCENE_CONFIRM face reads switch to face', st.scene === 'face');
  st = stepScene(st, 'skin');
  check('a single skin read does not leave face', st.scene === 'face');
  st = stepScene(st, 'face');
  st = stepScene(st, 'skin');
  check('an interrupted streak starts over', st.scene === 'face');
  for (let i = 0; i < SCENE_CONFIRM; i++) st = stepScene(st, 'skin');
  check('SCENE_CONFIRM skin reads return to skin', st.scene === 'skin');
}

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

// A weak box can never START a track, however long it persists - that is the CREATE bar.
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
// Repeated sub-threshold nudges must not accumulate - that is the creep this exists to stop.
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
// catches a sign error or a swapped dimension - the failure mode that otherwise shows up only as
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
// A square frame has no crop band to undo - the mapping must be the identity.
check('square frame is an identity crop', boxNear(modelCropToFullFrame(BOXES[1], 1440, 1440), BOXES[1]));

// Axis independence: move the lesion in ONE axis and only that axis may respond. Moving both at
// once (as a naive monotonicity check does) is passed by a cx/cy swap, so it has to be one at a
// time - a swapped axis is a real failure mode that still round-trips on square-ish shapes.
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

/* ------------------------------------------------------------------ front-camera mirroring */

// The front camera's PREVIEW is mirrored and its frames are not (capture.tsx pins
// isMirrored={false}), so exactly one mapping carries a flip. These pin that it is a pure
// reflection - if it ever leaks into the y axis or the box size, the box drifts off the lesion on
// one camera only, which is precisely the bug nobody reproduces on their own phone.
{
  let rtMirror = 0, total = 0;
  for (const [fw, fh] of FRAMES) for (const b of BOXES) for (const [sw, sh] of SCREENS) {
    total++;
    const there = fullFrameToPreview(b, fw, fh, sw, sh, true);
    if (boxNear(previewToFullFrame(there, fw, fh, sw, sh, true), b, 1e-12)) rtMirror++;
  }
  check(`mirrored preview round-trip exact (${rtMirror}/${total})`, rtMirror === total);
}

{
  let ok = 0, total = 0;
  for (const [fw, fh] of FRAMES) for (const b of BOXES) for (const [sw, sh] of SCREENS) {
    total++;
    const plain = fullFrameToPreview(b, fw, fh, sw, sh, false);
    const flipped = fullFrameToPreview(b, fw, fh, sw, sh, true);
    // A reflection about the preview centre, and nothing else touched.
    if (near(flipped.cx, 1 - plain.cx) && near(flipped.cy, plain.cy) &&
        near(flipped.w, plain.w) && near(flipped.h, plain.h)) ok++;
  }
  check(`mirroring is a pure x reflection (${ok}/${total})`, ok === total);
}

// Default OFF: every existing (back-camera) call site omits the argument and must be unaffected.
{
  let ok = 0, total = 0;
  for (const [fw, fh] of FRAMES) for (const b of BOXES) for (const [sw, sh] of SCREENS) {
    total++;
    if (boxNear(fullFrameToPreview(b, fw, fh, sw, sh), fullFrameToPreview(b, fw, fh, sw, sh, false), 0)) ok++;
  }
  check(`mirroring defaults to off (${ok}/${total})`, ok === total);
}

// A centred lesion is the one box a flip cannot move, so it can't prove the flip happened - but it
// CAN prove the flip introduced no offset. Off-by-one in the reflection shows up here.
for (const [sw, sh] of SCREENS) {
  const p = fullFrameToPreview({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }, 1080, 1920, sw, sh, true);
  check(`mirrored centre stays centred (${sw}x${sh})`, near(p.cx, 0.5) && near(p.cy, 0.5));
}

/* ------------------------------------------------------------------ frame orientation */

// THE invariant: this is the value the back camera has shipped with as a hard-coded literal, and
// uprightRotation has to be a generalisation of it rather than a change to it. If this line ever
// fails, every back-camera capture is being fed a rotated frame.
check("landscape-right is still 90deg (the shipped back-camera value)", uprightRotation('landscape-right') === '90deg');
check('portrait needs no rotation', uprightRotation('portrait') === '0deg');
check('landscape-left is the opposite quarter turn', uprightRotation('landscape-left') === '270deg');
check('portrait-upside-down is a half turn', uprightRotation('portrait-upside-down') === '180deg');
// Every orientation must resolve to a rotation the resize plugin actually accepts.
{
  const allowed = ['0deg', '90deg', '180deg', '270deg'];
  const all = ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']
    .every((o) => allowed.includes(uprightRotation(o)));
  check('every orientation maps to a legal rotation', all);
}
// Complementary pairs: a quarter turn one way plus a quarter turn the other is a full circle.
{
  const deg = (o) => parseInt(uprightRotation(o), 10);
  check('landscape pairs are complementary', (deg('landscape-left') + deg('landscape-right')) % 360 === 0);
  check('portrait pairs are complementary', (deg('portrait') + deg('portrait-upside-down')) % 360 === 180);
}

/* ------------------------------------------------------------------ drawn-box padding */
check('padding grows the box', padDrawnBox({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }, 0.25, 0.98).w > 0.2);
check('padding never moves the centre', padDrawnBox({ cx: 0.3, cy: 0.7, w: 0.2, h: 0.2 }, 0.25, 0.98).cx === 0.3);
check('padding is capped', padDrawnBox({ cx: 0.5, cy: 0.5, w: 5, h: 5 }, 0.25, 0.98).w === 0.98);

/* ------------------------------------------------------------------ zoom ROI */
{
  check('1x keeps the validated full square', near(roiFractionForZoom(1, 1), 1));
  check('2x uses the moderate 68% ROI', near(roiFractionForZoom(2, 1), 0.68));
  check('4x uses the strong 46% ROI', near(roiFractionForZoom(4, 1), 0.46));
  check('stronger zoom does not shrink below 46%', near(roiFractionForZoom(8, 1), 0.46));
  check('ultra-wide zoom below neutral does not narrow the ROI', near(roiFractionForZoom(0.5, 1), 1));

  let monotonic = true;
  let previous = 2;
  for (let zoom = 1; zoom <= 4; zoom += 0.05) {
    const fraction = roiFractionForZoom(zoom, 1);
    if (fraction > previous + 1e-12) monotonic = false;
    previous = fraction;
  }
  check('ROI shrinks monotonically and continuously with zoom', monotonic);

  const portrait = searchRoiForZoom(1080, 1920, 2, 1);
  const landscape = searchRoiForZoom(1920, 1080, 2, 1);
  check('ROI geometry is orientation independent', boxNear(portrait, landscape));
  check('ROI remains centered', near(portrait.cx, 0.5) && near(portrait.cy, 0.5));
  check('ROI is bounded by the upright frame', portrait.w <= 1 && portrait.h <= 1);

  const modelBox = { cx: 0.27, cy: 0.71, w: 0.19, h: 0.13 };
  const full = modelRoiToFullFrame(modelBox, portrait);
  check('ROI mapping round-trips exactly', boxNear(fullFrameToModelRoi(full, portrait), modelBox));
  check('mapped ROI box stays in the full frame', full.cx >= 0 && full.cx <= 1 && full.cy >= 0 && full.cy <= 1);
}

/* ------------------------------------------------------------------ candidate clustering */
{
  let index = -1;
  const sequence = [];
  for (let i = 0; i < 6; i++) {
    index = nextSearchCrop(index, -1);
    sequence.push(index);
  }
  check('unlocked search visits one wide, medium and tight crop per tick', sequence.join(',') === '0,1,2,0,1,2');
  check('nomination pins its crop for confirmation and tracking', nextSearchCrop(0, 1) === 1);
  check('losing a target resumes after the last crop', nextSearchCrop(1, -1) === 2);
  check('search fractions match the requested scales', SEARCH_FRACTIONS.join(',') === '1,0.68,0.46');
  const guideCenter = previewToFullFrame({ cx: 0.5, cy: 0.42, w: 0, h: 0 }, 1920, 1080, 390, 844);
  const guideFocus = focusedSearchRoi(1920, 1080, 0.46, guideCenter);
  const guidePreview = fullFrameToPreview(guideFocus, 1920, 1080, 390, 844);
  check('focused crop is centred on the visible searching guide', near(guidePreview.cy, 0.42, 0.002));
  const mirroredGuideCenter = previewToFullFrame({ cx: 0.5, cy: 0.42, w: 0, h: 0 }, 1920, 1080, 390, 844, true);
  check('front-camera searching guide maps through mirror', near(mirroredGuideCenter.cy, guideCenter.cy));

  const focus = { cx: 0.72, cy: 0.58, w: 0.08, h: 0.06 };
  for (const [orientation, w, h] of [
    ['portrait', 1080, 1920], ['portrait-upside-down', 1080, 1920],
    ['landscape-left', 1920, 1080], ['landscape-right', 1920, 1080],
  ]) {
    const requested = focusedSearchRoi(w, h, 0.46, focus);
    const sensor = sensorCropForRoi(w, h, orientation, requested);
    check(`${orientation} crop has even sensor coordinates`, sensor.x % 2 === 0 && sensor.y % 2 === 0 && sensor.side % 2 === 0);
    check(`${orientation} crop maps back to focused upright centre`,
      near(sensor.roi.cx, requested.cx, 0.002) && near(sensor.roi.cy, requested.cy, 0.002));
    const box = { cx: 0.42, cy: 0.64, w: 0.12, h: 0.09 };
    const full = modelRoiToFullFrame(box, sensor.roi);
    check(`${orientation} sensor crop mapping round-trips`, boxNear(fullFrameToModelRoi(full, sensor.roi), box));
    const preview = fullFrameToPreview(full, w, h, 390, 844, true);
    check(`${orientation} mirrored preview round-trips`, boxNear(previewToFullFrame(preview, w, h, 390, 844, true), full));
  }
  const edge = focusedSearchRoi(1080, 1920, 0.46, { cx: 0.98, cy: 0.03, w: 0, h: 0 });
  check('focused crop clamps to sensor bounds', edge.cx + edge.w / 2 <= 1 && edge.cy - edge.h / 2 >= 0);
  const local = localSkinRoi(1080, 1920, focus);
  check('local skin crop surrounds the candidate', local.w >= focus.w * 3 && local.h >= focus.h * 3);
  check('broad boxes cannot qualify for local recovery',
    !isLocalized({ box: { cx: 0.5, cy: 0.5, w: 0.8, h: 0.8 }, score: 0.9 },
      focusedSearchRoi(1080, 1920, 1, focus)));
}

{
  const target = { cx: 0.59, cy: 0.49, w: 0.09, h: 0.07 };
  const wide = sensorCropForRoi(1080, 1920, 'portrait', focusedSearchRoi(1080, 1920, 1, target)).roi;
  const tight = sensorCropForRoi(1080, 1920, 'portrait', focusedSearchRoi(1080, 1920, 0.68, target)).roi;
  const firstBox = modelRoiToFullFrame(fullFrameToModelRoi(target, wide), wide);
  const secondBox = modelRoiToFullFrame(fullFrameToModelRoi(target, tight), tight);
  const first = stepActiveTarget(initialActiveTargetState, [{ box: firstBox, score: 0.4 }], wide, 0, 1);
  const second = stepActiveTarget(first.state, [{ box: secondBox, score: 0.26 }], tight, 0.6, 1);
  check('the same target confirms across differently sized crops', second.kind === 'acquire');
  check('first observation stays hidden across crop scheduling', first.kind === 'none');
  check('local skin requires two agreeing checks', stepLocalSkin(stepLocalSkin(0, 'skin'), 'skin') === 2);
  check('non-skin breaks local recovery', stepLocalSkin(stepLocalSkin(0, 'skin'), 'not_skin') === 0);
  check('face breaks local recovery', stepLocalSkin(stepLocalSkin(0, 'skin'), 'face') === 0);
  check('one local check does not reveal a box over a not-skin scene',
    !allowsVisibleTarget('not_skin', true, true, 1));
  check('two local skin checks recover a confirmed localized candidate',
    allowsVisibleTarget('not_skin', true, true, 2));
  check('unconfirmed and broad candidates cannot recover',
    !allowsVisibleTarget('not_skin', false, true, 2) && !allowsVisibleTarget('not_skin', true, false, 2));
  check('confirmed broad face still vetoes recovered local skin',
    !allowsVisibleTarget('face', true, true, 2) && computeCoach(true, GATE_OK, M(), 'face') === 'face');
  check('previous camera callbacks are rejected', !acceptsSession(3, 2) && acceptsSession(3, 3));
}

/* ------------------------------------------------------------------ candidate clustering */
{
  const tight = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.18 };
  const raw = [
    { box: tight, score: 0.8 },
    { box: { cx: 0.502, cy: 0.498, w: 0.202, h: 0.178 }, score: 0.75 },
    { box: { cx: 0.5, cy: 0.5, w: 0.26, h: 0.23 }, score: 0.7 },
    { box: { cx: 0.82, cy: 0.8, w: 0.08, h: 0.09 }, score: 0.65 },
    { box: { cx: Number.NaN, cy: 0.5, w: 0.2, h: 0.2 }, score: 0.99 },
    { box: { cx: 0.1, cy: 0.1, w: 0, h: 0.1 }, score: 0.99 },
  ];
  const clustered = clusterDetectionCandidates(raw);
  check('overlapping anchors collapse into object candidates', clustered.length === 2);
  check('weighted median resists an oversized duplicate', clustered[0].box.w < 0.23);
  check('distant lesions remain separate candidates', boxIou(clustered[0].box, clustered[1].box) === 0);
  check('malformed candidates are removed', clustered.every((candidate) => Number.isFinite(candidate.box.cx)));

  const many = Array.from({ length: 20 }, (_, i) => ({
    box: { cx: (i % 5) * 0.2 + 0.02, cy: Math.floor(i / 5) * 0.22 + 0.02, w: 0.015, h: 0.015 },
    score: 0.9 - i * 0.01,
  }));
  check('clustered output is capped for the JS bridge', clusterDetectionCandidates(many).length === MAX_CLUSTERED_CANDIDATES);
}

/* ------------------------------------------------------------------ single-target sequences */
{
  const roi = { cx: 0.5, cy: 0.5, w: 1, h: 1, fraction: 1, zoomProgress: 0 };
  const C = (cx, cy, score = 0.8, w = 0.1, h = 0.1) => ({ box: { cx, cy, w, h }, score });
  const acquire = (candidate, activeRoi = roi) => {
    const one = stepActiveTarget(initialActiveTargetState, [candidate], activeRoi, activeRoi.zoomProgress, 1);
    return stepActiveTarget(one.state, [candidate], activeRoi, activeRoi.zoomProgress, 1);
  };

  const centered = C(0.5, 0.5);
  const acquired = acquire(centered);
  check('target is hidden for the first acquisition cycle',
    stepActiveTarget(initialActiveTargetState, [centered], roi, 0, 1).kind === 'none');
  check('matching second acquisition cycle shows one target', acquired.kind === 'acquire' && acquired.target === centered);

  const initialNominee = C(0.42, 0.5, 0.6);
  const firstNomination = stepActiveTarget(initialActiveTargetState, [initialNominee], roi, 0, 1);
  const brieflyHigher = C(0.62, 0.5, 0.95);
  const stickyAcquire = stepActiveTarget(
    firstNomination.state,
    [C(0.42, 0.5, 0.3), brieflyHigher],
    roi,
    0,
    1,
  );
  check(
    'acquisition confirms its nominee before re-running the global ranking',
    stickyAcquire.kind === 'acquire' && near(stickyAcquire.target.box.cx, 0.42),
  );

  const huge = C(0.5, 0.5, 0.99, 0.9, 0.9);
  const localized = C(0.62, 0.5, 0.3, 0.12, 0.12);
  const firstChoice = stepActiveTarget(initialActiveTargetState, [huge, localized], roi, 0, 1);
  check('localized candidate is preferred over a frame-sized region', firstChoice.state.acquisition.candidate === localized);

  const active = acquire(C(0.72, 0.5, 0.5)).state;
  const sameLow = C(0.72, 0.5, 0.25);
  const distantHigh = C(0.9, 0.85, 0.99);
  const confidenceOnly = stepActiveTarget(active, [sameLow, distantHigh], roi, 0, 1);
  check('higher confidence alone cannot steal the track', confidenceOnly.kind === 'update' && confidenceOnly.target === sameLow);

  const tightContinuation = C(0.72, 0.5, 0.3, 0.1, 0.1);
  const oversizedContinuation = C(0.72, 0.5, 0.99, 0.85, 0.85);
  const tightAssociation = stepActiveTarget(
    active,
    [oversizedContinuation, tightContinuation],
    roi,
    0,
    1,
  );
  check(
    'active association prefers a tight candidate over an oversized match',
    tightAssociation.kind === 'update' && tightAssociation.target === tightContinuation,
  );

  let missing = acquired.state;
  const missKinds = [];
  for (let i = 0; i < 4; i++) {
    const result = stepActiveTarget(missing, [], roi, 0, 1);
    missing = result.state;
    missKinds.push(result.kind);
  }
  check('three consecutive misses retain the previous box', missKinds.slice(0, 3).every((kind) => kind === 'hold'));
  check('the fourth consecutive miss clears the box', missKinds[3] === 'clear');

  const moved = C(0.53, 0.51, 0.7);
  check('small camera motion updates the same track', stepActiveTarget(acquired.state, [moved], roi, 0, 1).kind === 'update');

  const spike = C(0.5, 0.5, 0.9, 0.45, 0.45);
  const spikeOnce = stepActiveTarget(acquired.state, [spike], roi, 0, 1);
  const spikeTwice = stepActiveTarget(spikeOnce.state, [spike], roi, 0, 1);
  check('one-frame geometry spike is held, not drawn', spikeOnce.kind === 'hold');
  check('persistent geometry change is accepted on cycle two', spikeTwice.kind === 'update');

  let switching = acquire(C(0.78, 0.5, 0.8)).state;
  const incumbent = C(0.78, 0.5, 0.4);
  const challenger = C(0.5, 0.5, 0.9);
  const switchKinds = [];
  for (let i = 0; i < 3; i++) {
    const result = stepActiveTarget(switching, [incumbent, challenger], roi, 0, 1);
    switching = result.state;
    switchKinds.push(result.kind);
  }
  check('challenger cannot switch during its first two cycles', switchKinds[0] === 'update' && switchKinds[1] === 'update');
  check('persistent centered challenger switches on cycle three', switchKinds[2] === 'handover');

  const narrowRoi = { cx: 0.5, cy: 0.5, w: 0.46, h: 0.46, fraction: 0.46, zoomProgress: 1 };
  let outside = acquire(C(0.75, 0.5, 0.8), roi).state;
  const outsideIncumbent = C(0.75, 0.5, 0.5, 0.02, 0.02);
  const insideChallenger = C(0.65, 0.6, 0.8, 0.02, 0.02);
  let outsideResult;
  for (let i = 0; i < 3; i++) {
    outsideResult = stepActiveTarget(outside, [outsideIncumbent, insideChallenger], narrowRoi, 1, 4);
    outside = outsideResult.state;
  }
  check('ROI exit still requires a controlled three-cycle handoff', outsideResult.kind === 'handover');
}

if (fails.length) {
  console.error(`\ncapture core: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`capture core: ${pass} passed, 0 failed`);

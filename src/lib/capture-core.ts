/**
 * The live capture screen's decision logic, as pure functions.
 *
 * capture.tsx is the least-verified stage in the app and the one that most determines the answer:
 * it decides where the lesion is, whether to trust that, and what the user is told. All of it used
 * to be reachable only by pointing a real phone at a real mole.
 *
 * The coordinate mapping is the reason this file exists. The detector reports a box in its own
 * space — a centred square crop of the sensor frame — and that has to be translated twice before it
 * can be drawn or forwarded to the cropper. A sign error there does not throw or look broken; it
 * silently crops slightly off-target, feeds the classifier the wrong skin, and quietly degrades
 * every result. Nothing downstream can detect it.
 *
 * Zero imports on purpose: like tps-core.ts, aggregate-core.ts and scan-flow.ts, this compiles
 * standalone under scripts/test-capture.mjs (npm run test:capture), so every branch and the
 * mapping's round-trip property are pinned without a simulator.
 */

/* ------------------------------------------------------------------ tracking thresholds */

/** Confidence hysteresis: a high bar to CREATE the box, a low bar to KEEP it, so it can't flicker. */
export const CREATE_SCORE = 0.35;
export const KEEP_SCORE = 0.28;
/**
 * Above this the box is "locked" — green, and eligible for the ready coach.
 *
 * Lowered 0.5 -> 0.38 (2026-08-04). Measured on 198 held-out clinical photos through the shipping
 * detector (synth/eval/detector_ab.py), 0.5 rejected **86% of real lesions**: the box almost never
 * turned green, computeCoach almost never reached 'ready', and the user almost never saw
 * "Looks good — tap to capture". The old detector scores the same (92% rejected at 0.5, median
 * 0.364 vs 0.363), so this was never a model-swap artifact — the bar has simply always been set
 * above where this family of detectors actually scores.
 *
 * 0.38 sits just above the median, so roughly half of real detections can lock. That is not lax:
 * `ready` is conjunctive — it also demands correct size, centring and a settled box — so LOCK is
 * one term of four, and a bar that almost nothing clears makes the other three unreachable.
 *
 * Note this only governs whether an ALREADY-VISIBLE box turns green. It cannot create a false box;
 * that is CREATE_SCORE's job, and changing that needs a false-positive measurement on non-lesion
 * skin which the lesion-only held-out set cannot provide. Left alone deliberately.
 *
 * Live preview frames are noisier than the stills this was measured on, so real confidences are
 * likely LOWER — which argues this is still on the conservative side.
 */
export const LOCK_SCORE = 0.38;
/** Consecutive qualifying frames before the box first appears. */
export const DETECT_SHOW = 2;
/** Extra frames the box survives detection misses before it drops. */
export const KEEP_GRACE = 3;
/** Box movement (fraction of screen) under this counts as "held still". */
export const STABLE_EPS = 0.01;
/** Consecutive still frames before the framing counts as stable (good to shoot). */
export const STABLE_FRAMES = 5;
/** Ignore box moves smaller than this so the box doesn't creep while the user holds still. */
export const DEADBAND = 0.004;
/** Size deadband is looser than position — width/height are noisier than centre. */
export const SIZE_DEADBAND_SCALE = 1.5;

/* ------------------------------------------------------------------ coaching thresholds */

/** Lesion smaller than this fraction of the frame → "move closer". */
export const FAR_MAX = 0.14;
/** Lesion larger than this → "move back". */
export const CLOSE_MIN = 0.72;
/** Centre further than this from the frame centre → "center the spot". */
export const OFFSET_MAX = 0.25;

/** Quality-gate verdicts, in the priority order the overlays are shown in. */
export const GATE_OK = 0;
export const GATE_DARK = 1;
export const GATE_BRIGHT = 2;
export const GATE_BLURRY = 3;

/* ------------------------------------------------------------------ coaching */

export type CoachKind = 'search' | 'far' | 'close' | 'offcenter' | 'steady' | 'ready';
/** Everything the capture screen can be telling the user right now, gates included. */
export type Coach = CoachKind | 'dark' | 'bright' | 'blurry';

/** What the coach knows about the current framing. Null when no lesion is being tracked. */
export type FrameMetrics = {
  cx: number;
  cy: number;
  w: number;
  h: number;
  locked: boolean;
  stable: boolean;
};

/**
 * The whole coaching decision, as one pure function of the latest gate + framing.
 *
 * Lighting and focus outrank position so messages never stack — there is no point asking someone to
 * centre a spot they cannot see. Below that the positional ladder narrows toward a good frame the
 * way document scanners do, and only says "ready" once the box has actually settled.
 */
export function computeCoach(
  aiCamera: boolean,
  gate: number,
  m: FrameMetrics | null,
): Coach | null {
  if (gate === GATE_DARK) return 'dark';
  if (gate === GATE_BRIGHT) return 'bright';
  if (gate === GATE_BLURRY) return 'blurry';
  if (!aiCamera) return null;
  if (!m) return 'search';
  const size = Math.max(m.w, m.h);
  if (size < FAR_MAX) return 'far';
  if (size > CLOSE_MIN) return 'close';
  if (Math.abs(m.cx - 0.5) > OFFSET_MAX || Math.abs(m.cy - 0.5) > OFFSET_MAX) return 'offcenter';
  if (!m.locked) return 'search';
  return m.stable ? 'ready' : 'steady';
}

/* ------------------------------------------------------------------ tracking state machine */

export type TrackState = {
  /** True once the box has been shown; it then survives on the lower KEEP bar. */
  active: boolean;
  detectStreak: number;
  stableStreak: number;
};

export const initialTrackState: TrackState = { active: false, detectStreak: 0, stableStreak: 0 };

export type TrackStep = {
  state: TrackState;
  /** Draw the box this frame? */
  visible: boolean;
  /** Drop the track entirely (the box disappears and the filters reset). */
  cleared: boolean;
};

/**
 * Stability is updated SEPARATELY from the detection hysteresis, and after it, because the two
 * happen at different points in the frame: the hysteresis decides whether there is a box at all
 * (and can bail early), while "has it held still" can only be measured once the box has been
 * smoothed and compared against the previous frame. Folding them into one call would force the
 * caller to know `moved` before it has computed it.
 */
export function stepStability(streak: number, moved: number): number {
  return moved < STABLE_EPS ? streak + 1 : 0;
}

/**
 * Advance the tracker by one detector frame.
 *
 * `score` is null when the frame produced no box at all. The worklet only emits above KEEP_SCORE,
 * so the CREATE bar is enforced here: while inactive a weak box cannot build toward appearing, but
 * once active any emitted box sustains it, and it only drops after KEEP_GRACE consecutive misses.
 * That asymmetry is the whole point — one bar would make the box strobe as the score hovers.
 */
export function stepTrack(prev: TrackState, score: number | null): TrackStep {
  const state: TrackState = { ...prev };

  if (score == null) {
    state.detectStreak = Math.max(0, state.detectStreak - 1);
    state.stableStreak = 0;
    const cleared = state.detectStreak === 0;
    if (cleared) state.active = false;
    return { state, visible: false, cleared };
  }

  if (!state.active && score < CREATE_SCORE) {
    // Too weak to start a track. Decay rather than reset, so a single strong frame in a noisy
    // sequence doesn't have to start from zero.
    state.detectStreak = Math.max(0, state.detectStreak - 1);
    return { state, visible: false, cleared: false };
  }

  state.detectStreak = Math.min(DETECT_SHOW + KEEP_GRACE, state.detectStreak + 1);
  if (!state.active) {
    if (state.detectStreak < DETECT_SHOW) return { state, visible: false, cleared: false };
    state.active = true;
  }

  return { state, visible: true, cleared: false };
}

/** Has the framing held still long enough to be worth shooting? */
export function isStable(state: TrackState): boolean {
  return state.stableStreak >= STABLE_FRAMES;
}

/**
 * Suppress sub-threshold movement so the box doesn't creep while the user holds still.
 * Returns `prev` unchanged when the move is below the deadband, otherwise the new value.
 */
export function applyDeadband(next: number, prev: number | null, epsilon: number): number {
  if (prev == null) return next;
  return Math.abs(next - prev) < epsilon ? prev : next;
}

/* ------------------------------------------------------------------ coordinate mapping */

/** A box in normalized coordinates: centre + size, each 0..1 of its reference space. */
export type NormBox = { cx: number; cy: number; w: number; h: number };

/**
 * Undo the detector's centred square crop.
 *
 * The resize plugin feeds the model a centre 1:1 crop of the upright frame, so the model's y axis
 * spans only the middle `Rw` band of a frame that is `Rh` tall. x and width need no correction (a
 * square crop keeps the full width); y and height do.
 */
export function modelCropToFullFrame(box: NormBox, frameW: number, frameH: number): NormBox {
  const Rw = Math.min(frameW, frameH); // upright frame width
  const Rh = Math.max(frameW, frameH); // upright frame height
  return {
    cx: box.cx,
    cy: ((Rh - Rw) / 2 + box.cy * Rw) / Rh,
    w: box.w,
    h: (box.h * Rw) / Rh,
  };
}

/** Inverse of modelCropToFullFrame — exists so the mapping can be round-trip tested. */
export function fullFrameToModelCrop(box: NormBox, frameW: number, frameH: number): NormBox {
  const Rw = Math.min(frameW, frameH);
  const Rh = Math.max(frameW, frameH);
  return {
    cx: box.cx,
    cy: (box.cy * Rh - (Rh - Rw) / 2) / Rw,
    w: box.w,
    h: (box.h * Rh) / Rw,
  };
}

/**
 * Apply the preview's cover-crop: the frame is scaled to fill the screen and the overflow is
 * clipped equally on both sides, so screen-normalized coords differ from frame-normalized ones.
 */
export function fullFrameToPreview(
  box: NormBox,
  frameW: number,
  frameH: number,
  screenW: number,
  screenH: number,
): NormBox {
  const Rw = Math.min(frameW, frameH);
  const Rh = Math.max(frameW, frameH);
  const sc = Math.max(screenW / Rw, screenH / Rh); // cover
  const dispW = Rw * sc;
  const dispH = Rh * sc;
  return {
    cx: (box.cx * dispW - (dispW - screenW) / 2) / screenW,
    cy: (box.cy * dispH - (dispH - screenH) / 2) / screenH,
    w: (box.w * dispW) / screenW,
    h: (box.h * dispH) / screenH,
  };
}

/** Inverse of fullFrameToPreview — exists so the mapping can be round-trip tested. */
export function previewToFullFrame(
  box: NormBox,
  frameW: number,
  frameH: number,
  screenW: number,
  screenH: number,
): NormBox {
  const Rw = Math.min(frameW, frameH);
  const Rh = Math.max(frameW, frameH);
  const sc = Math.max(screenW / Rw, screenH / Rh);
  const dispW = Rw * sc;
  const dispH = Rh * sc;
  return {
    cx: (box.cx * screenW + (dispW - screenW) / 2) / dispW,
    cy: (box.cy * screenH + (dispH - screenH) / 2) / dispH,
    w: (box.w * screenW) / dispW,
    h: (box.h * screenH) / dispH,
  };
}

/** Grow the drawn box for breathing room, capped so a bad frame can't blow it past the screen. */
export function padDrawnBox(box: NormBox, pad: number, max: number): NormBox {
  return {
    cx: box.cx,
    cy: box.cy,
    w: Math.min(max, box.w * (1 + pad)),
    h: Math.min(max, box.h * (1 + pad)),
  };
}

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

/**
 * Confidence hysteresis: a high bar to CREATE the box, a low bar to KEEP it, so it can't flicker.
 *
 * CREATE lowered 0.35 -> 0.28 (2026-08-20), refitted for the y11n_v1 detector bundled the same day.
 * This is the recall-vs-false-positive measurement round 1 of DETECTOR_AB.md said was missing, and
 * refused to move this bar without.
 *
 * The negatives it needed are lesion-FREE SKIN, not the procedural gray/blue/checker patterns
 * synth/eval/detector_eval.py uses — a detector rejecting a blue screen says nothing about whether
 * a box appears on a plain forearm. They are 40%-size patches cut from the 200 holdout photos, kept
 * only where they clear EVERY detector's own box, so both models are scored on identical negatives.
 * Read the rate as an upper bound: a patch may clip an undetected second lesion, and a 40% crop
 * blown up to 768 is not what the model sees in the field.
 *
 *     detector      bar    lesion recall    false box on lesion-free skin
 *     itobos_v2    0.35        53.0%                  25.8%      <- what shipped before the swap
 *     y11n_v1      0.35        40.0%                   0.0%      <- the same bar, new detector
 *     y11n_v1      0.30        50.0%                  12.9%
 *     y11n_v1      0.28        58.0%                  25.8%      <- here
 *     y11n_v1      0.24        75.5%                  71.0%
 *
 * READ THE FIRST TWO ROWS TOGETHER: keeping 0.35 across the detector swap silently cut the share of
 * lesions that can start a track from 53% to 40%, because y11n_v1's confidences sit lower
 * (median 0.300 vs 0.360). That is why the box became slow to appear — the bar stopped matching the
 * distribution under it. At 0.28 the new detector reaches the SAME measured false-box rate as the
 * old one did at its shipped bar, while finding MORE lesions (58% vs 53%). This is a recalibration
 * to preserve behaviour, not a relaxation of it.
 *
 * Limits, stated because 31 patches is not many: the negative set is small, so treat 25.8% as
 * "about a quarter" rather than a precise figure, and it is measured on stills — live preview
 * frames are noisier and score lower, which pushes both columns down together.
 */
export const CREATE_SCORE = 0.28;
/**
 * The bar an ALREADY-VISIBLE track has to clear to survive another frame.
 *
 * Lowered 0.28 -> 0.24 (2026-08-20), refitted for the y11n_v1 detector bundled the same day.
 * Measured on the 200-image ISIC holdout through both detectors (`synth/eval/detector_ab.py`,
 * written up as round 2 of DETECTOR_AB.md), this is the share of REAL lesions each bar rejects:
 *
 *     bar     itobos_v2 (previous)   y11n_v1 (current)
 *     0.28          15.2%                 35.9%     <- what 0.28 became after the swap
 *     0.24           6.6%                 16.6%     <- here: back to the old model's behaviour
 *     0.22           2.0%                  9.4%
 *
 * The new detector's confidence distribution is lower in the middle (median 0.363 -> 0.316), so the
 * unchanged bar silently became more than twice as strict: better than a third of real lesions
 * failed to sustain a track, the grace period expired far more often, and the box dropped and
 * re-acquired repeatedly. The exact parity point is 0.2363; 0.24 rounds toward the stricter side.
 *
 * SAFE TO REFIT ON LESION-ONLY DATA, by the rule round 1 of DETECTOR_AB.md established for
 * LOCK_SCORE: this bar cannot summon a box out of nothing — CREATE_SCORE gates that — so it cannot
 * manufacture a false positive. It only decides how long a track that already exists survives a
 * confidence dip. CREATE_SCORE is untouched for exactly that reason: lowering it WOULD admit false
 * boxes, and that needs the recall-vs-non-skin-FPR sweep in synth/eval/detector_eval.py, which a
 * lesion-only holdout cannot provide.
 *
 * This is a VISUAL bar. It has no bearing on classification — the still path runs its own detector
 * pass at DET_CONF (classifier/lesion-detector.ts) and the triage decision is
 * MALIGNANT_THRESHOLD's. Neither changed.
 */
export const KEEP_SCORE = 0.24;
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
/**
 * Movement below which the box is held still, so it doesn't creep while the user does.
 *
 * SUPERSEDED FOR THE LIVE BOX (2026-08-20): capture.tsx now uses `softDeadband` from
 * lib/detection-smoothing.ts, which damps sub-threshold movement instead of freezing it. The hard
 * version below accumulates — the 1€ filter behind it keeps advancing while the drawn value is
 * pinned, so crossing the band released the whole stored difference as one visible step. Kept here
 * with its tests because it is the reference the soft version is checked against, and because the
 * threshold values themselves moved to DETECTION_SMOOTHING_CONFIG unchanged.
 */
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
export const GATE_BLURRY = 2;

/* ------------------------------------------------------------------ coaching */

export type CoachKind = 'search' | 'far' | 'close' | 'offcenter' | 'steady' | 'ready';
/** Everything the capture screen can be telling the user right now, gates included. */
export type Coach = CoachKind | 'dark' | 'blurry';

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
 *
 * `guide` is the capture screen's Guide toggle (labelled "AI camera" until 2026-08-20). With it off
 * the positional coaching goes silent, because there is no box to coach against — but the lighting
 * and focus gates above still fire, since those are properties of the frame rather than of the
 * detector.
 */
export function computeCoach(
  guide: boolean,
  gate: number,
  m: FrameMetrics | null,
): Coach | null {
  if (gate === GATE_DARK) return 'dark';
  if (gate === GATE_BLURRY) return 'blurry';
  if (!guide) return null;
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
 *
 * ACQUISITION, 2026-08-20: the CONFIRMING frame counts at the KEEP bar, not the CREATE bar.
 *
 * The rule used to be "DETECT_SHOW frames at or above CREATE_SCORE", with anything weaker decaying
 * the streak — so the box needed two strong frames to appear and every intervening ordinary frame
 * pushed it back. Under the current detector only ~44% of frames on a real lesion clear 0.35, which
 * turns a 2-frame requirement into a wait for two lucky frames: measured against the confidence
 * distribution, a mean of ~7 detector frames (~0.6 s at 12 fps) before the box shows up, and
 * visibly longer whenever the lesion sits near the bar. That is the "takes a moment to find it"
 * complaint.
 *
 * Now: the FIRST frame of a track still has to clear CREATE_SCORE — the evidence bar for asserting
 * a lesion exists is unchanged, and so is the peak confidence a false box must reach — but once one
 * strong frame is banked, the confirmation only has to clear KEEP_SCORE, which ~83% of frames do.
 * Expected acquisition drops to ~3.5 frames (~0.3 s). What is genuinely traded: a false box now
 * needs one strong frame plus one ordinary one rather than two strong ones. See the CREATE_SCORE
 * note above for the false-positive measurement that bounds how much that costs.
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
    // A streak above zero can only have been built by a frame at or above CREATE_SCORE, so this
    // frame is CONFIRMING a lesion that already showed itself — count it. With nothing banked it is
    // just a weak box: decay rather than reset, so one strong frame in a noisy sequence does not
    // have to start over.
    state.detectStreak =
      state.detectStreak > 0
        ? Math.min(DETECT_SHOW + KEEP_GRACE, state.detectStreak + 1)
        : Math.max(0, state.detectStreak - 1);
    if (state.detectStreak < DETECT_SHOW) return { state, visible: false, cleared: false };
    state.active = true;
    return { state, visible: true, cleared: false };
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

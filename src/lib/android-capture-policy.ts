/** Android-only timing policy. No camera/model dependencies so it can be tested with a fake clock. */
export const ANDROID_RESULT_MAX_AGE_MS = 1000;
export const ANDROID_CAPTURE_WAIT_MS = 2000;

export type AndroidDetectionSchedule = {
  sessionId: number;
  lastStartedAt: number | null;
  meanMs: number;
  intervalMs: number;
};

export function initialAndroidSchedule(sessionId: number): AndroidDetectionSchedule {
  'worklet';
  return { sessionId, lastStartedAt: null, meanMs: 1000 / 12, intervalMs: 1000 / 6 };
}

export function androidDetectionDue(
  state: AndroidDetectionSchedule, now: number, paused: boolean, busy: boolean,
): boolean {
  'worklet';
  return !paused && !busy &&
    (state.lastStartedAt === null || now - state.lastStartedAt >= state.intervalMs);
}

export function completeAndroidDetection(
  state: AndroidDetectionSchedule, sessionId: number, durationMs: number,
): AndroidDetectionSchedule {
  'worklet';
  // A pass from the old camera/session must never overwrite a reset schedule.
  if (state.sessionId !== sessionId || !Number.isFinite(durationMs) || durationMs < 0) return state;
  const meanMs = state.meanMs * 0.8 + durationMs * 0.2;
  // A sudden slow pass backs off immediately. Recovery is limited to 10% per completed pass.
  // No minimum FPS: forcing one on very slow hardware would exceed the processing budget.
  const intervalMs = Math.max(1000 / 12, 2 * meanMs, 2 * durationMs, state.intervalMs * 0.9);
  return { ...state, meanMs, intervalMs };
}

/** Passes the tracker keeps a target through: its MAX_MISSES (3) plus the pass that saw it. */
const ANDROID_RETAINED_PASSES = 4;
const ANDROID_RESULT_AGE_SLACK_MS = 250;
const ANDROID_RESULT_MAX_AGE_CAP_MS = 4000;

/**
 * How long an accepted box stays valid. A fixed 1 s outran the tracker's miss tolerance once the
 * scheduler backed off (e.g. 600 ms passes on a Galaxy A42), so the box vanished mid-track and
 * capture lost its auto-zoom target. Scaling with the live interval lets the tracker decide when a
 * target is gone; this only catches a detector that has stopped delivering altogether.
 */
export function androidResultMaxAgeMs(intervalMs: number): number {
  'worklet';
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return ANDROID_RESULT_MAX_AGE_MS;
  return Math.min(ANDROID_RESULT_MAX_AGE_CAP_MS, Math.max(ANDROID_RESULT_MAX_AGE_MS,
    ANDROID_RETAINED_PASSES * intervalMs + ANDROID_RESULT_AGE_SLACK_MS));
}

export function isFreshAndroidResult(
  startedAt: number | null, now: number, maxAgeMs: number = ANDROID_RESULT_MAX_AGE_MS,
): boolean {
  'worklet';
  return startedAt !== null && now >= startedAt && now - startedAt < maxAgeMs;
}

export function acceptsAndroidResult(
  sessionId: number, resultSessionId: number, startedAt: number, now: number, paused: boolean,
  maxAgeMs: number = ANDROID_RESULT_MAX_AGE_MS,
): boolean {
  return sessionId === resultSessionId && !paused && isFreshAndroidResult(startedAt, now, maxAgeMs);
}

/** Never invoke takePhoto while the interpreter still owns a camera frame. */
export async function waitForCaptureIdle(
  isBusy: () => boolean,
  timeoutMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const startedAt = now();
  while (isBusy()) {
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) throw new Error('Detector did not become idle before capture');
    await sleep(Math.min(8, remaining));
  }
}

/**
 * Lesion auto-focus. Android's continuous AF picks its own subject, and at macro distance that is
 * often the surrounding skin or background rather than a small spot, so the still comes out soft
 * and fails the blur gate. Once the tracked box has settled, focus on it - once, then again only if
 * it moves somewhere clearly new. A user's tap-to-focus wins for a while.
 */
export const AUTOFOCUS_MIN_STREAK = 2;
export const AUTOFOCUS_MIN_INTERVAL_MS = 1500;
export const AUTOFOCUS_REFOCUS_DISTANCE = 0.12;
export const AUTOFOCUS_USER_HOLD_MS = 3000;

export type AutoFocusState = {
  lastAt: number | null;
  lastCx: number;
  lastCy: number;
  userUntil: number;
};

export const initialAutoFocusState: AutoFocusState = { lastAt: null, lastCx: 0, lastCy: 0, userUntil: 0 };

/** `cx`/`cy` are the box centre in normalized preview coordinates. */
export function nextAutoFocus(
  state: AutoFocusState, now: number, cx: number, cy: number, stableStreak: number,
): AutoFocusState | null {
  if (now < state.userUntil || stableStreak < AUTOFOCUS_MIN_STREAK) return null;
  if (state.lastAt !== null) {
    if (now - state.lastAt < AUTOFOCUS_MIN_INTERVAL_MS) return null;
    if (Math.hypot(cx - state.lastCx, cy - state.lastCy) < AUTOFOCUS_REFOCUS_DISTANCE) return null;
  }
  return { ...state, lastAt: now, lastCx: cx, lastCy: cy };
}

/** A new target (or none) must be able to focus immediately; the user's hold survives. */
export function resetAutoFocus(state: AutoFocusState): AutoFocusState {
  return { ...initialAutoFocusState, userUntil: state.userUntil };
}

export function userFocused(state: AutoFocusState, now: number): AutoFocusState {
  return { ...state, userUntil: now + AUTOFOCUS_USER_HOLD_MS };
}

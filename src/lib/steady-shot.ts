/**
 * Steady-shot: hold the shutter until the phone stops moving.
 *
 * Tapping the shutter jolts the phone, and at macro distance (plus zoom) that jolt smears the
 * still even though the preview looked sharp a moment earlier. The capture screen feeds gyroscope
 * samples into a tracker; shoot() waits until the rotation rate has stayed low for a short window
 * that starts AT the tap, so a phone that was calm before the press still waits out the press
 * itself. A hard cap means the shutter can never get stuck on a shaky hand.
 *
 * No React Native or sensor imports, so it can be tested with a fake clock.
 */

/** Rotation rate (rad/s) under which the phone counts as still. Hand-held "still" is ~0.02-0.08. */
export const STEADY_RAD_S = 0.15;
/** How long it must stay under the threshold, measured from the tap. */
export const STEADY_HOLD_MS = 100;
/** Never hold the shutter longer than this, steady or not. */
export const STEADY_MAX_WAIT_MS = 700;
/** A sample older than this means the sensor is not delivering, so the gate is skipped. */
export const STEADY_STALE_MS = 250;

export type SteadyTracker = {
  /** Record one gyroscope sample (rad/s per axis) taken at `t` (ms, same clock as `now`). */
  push(x: number, y: number, z: number, t: number): void;
  /** How long (ms) the phone has been still, counting no earlier than `since`. */
  calmFor(now: number, since: number): number;
  /** True when a sample arrived recently enough to trust the reading. */
  live(now: number): boolean;
  reset(): void;
};

export function makeSteadyTracker(thresholdRadS: number = STEADY_RAD_S): SteadyTracker {
  let calmSince: number | null = null;
  let lastAt: number | null = null;
  return {
    push(x, y, z, t) {
      const mag = Math.sqrt(x * x + y * y + z * z);
      if (!Number.isFinite(mag) || mag > thresholdRadS) calmSince = null;
      else if (calmSince === null) calmSince = t;
      lastAt = t;
    },
    calmFor(now, since) {
      if (calmSince === null) return 0;
      return Math.max(0, now - Math.max(calmSince, since));
    },
    live(now) {
      return lastAt !== null && now - lastAt <= STEADY_STALE_MS;
    },
    reset() {
      calmSince = null;
      lastAt = null;
    },
  };
}

export type SteadyResult = {
  waitedMs: number;
  /** 'steady' = held still; 'timeout' = hit the cap; 'no-sensor' = no live gyro data. */
  reason: 'steady' | 'timeout' | 'no-sensor';
};

export type SteadyWaitOptions = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  holdMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
  /** Do not resolve before this time (e.g. until a haptic buzz has finished). */
  notBefore?: number;
};

export async function waitForSteady(
  tracker: SteadyTracker,
  {
    now, sleep, holdMs = STEADY_HOLD_MS, maxWaitMs = STEADY_MAX_WAIT_MS, pollMs = 16, notBefore = 0,
  }: SteadyWaitOptions,
): Promise<SteadyResult> {
  const start = now();
  const deadline = start + maxWaitMs;
  const floor = Math.min(deadline, Math.max(start, notBefore));
  for (;;) {
    const t = now();
    if (t >= floor) {
      if (!tracker.live(t)) return { waitedMs: t - start, reason: 'no-sensor' };
      if (tracker.calmFor(t, Math.max(start, notBefore)) >= holdMs) return { waitedMs: t - start, reason: 'steady' };
    }
    if (t >= deadline) return { waitedMs: t - start, reason: 'timeout' };
    await sleep(Math.min(pollMs, Math.max(1, deadline - t)));
  }
}

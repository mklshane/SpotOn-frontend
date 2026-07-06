/**
 * 1€ (One-Euro) filter — an adaptive low-pass filter for noisy real-time signals.
 * Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 * Interactive Systems" (CHI 2012).
 *
 * Why we use it: the live lesion box jitters when the camera shifts slightly. A fixed EMA either
 * lags (when smooth enough to kill jitter) or stays jittery (when responsive). The 1€ filter
 * adapts to speed — it smooths hard when the value is nearly still (killing jitter from tiny
 * hand shifts) and eases off as real motion speeds up (so it follows without lag). It's
 * frame-rate independent because it uses timestamps, which matters at our ~8 fps detection rate.
 *
 * Tuning: raise `minCutoff` to reduce lag (allows faster response, a bit more jitter); raise
 * `beta` to make it track fast motion more aggressively; lower both to smooth more.
 */

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export type OneEuro = {
  /** Filter one sample taken at `tMs` (ms). Returns the smoothed value. */
  filter: (value: number, tMs: number) => number;
  /** Forget history so the next sample is passed through untouched (call when the target is lost). */
  reset: () => void;
};

export function makeOneEuro(minCutoff = 1.2, beta = 0.01, dCutoff = 1.0): OneEuro {
  let xPrev: number | null = null; // last filtered value
  let dxPrev = 0; // last filtered derivative
  let tPrev = 0; // last timestamp (ms)

  return {
    filter(value: number, tMs: number): number {
      if (xPrev === null) {
        xPrev = value;
        tPrev = tMs;
        return value;
      }
      // dt in seconds; guard against zero/negative timestamps.
      const dt = Math.max(1e-3, (tMs - tPrev) / 1000);
      tPrev = tMs;

      const dx = (value - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      const dxHat = aD * dx + (1 - aD) * dxPrev;
      dxPrev = dxHat;

      const cutoff = minCutoff + beta * Math.abs(dxHat);
      const aX = alpha(cutoff, dt);
      const xHat = aX * value + (1 - aX) * xPrev;
      xPrev = xHat;
      return xHat;
    },
    reset() {
      xPrev = null;
      dxPrev = 0;
      tPrev = 0;
    },
  };
}

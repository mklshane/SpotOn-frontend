/**
 * Temporal smoothing + tracking configuration for the LIVE detection box.
 *
 * Scope, stated first because it is the important part: everything here is about how the green box
 * LOOKS AND MOVES. None of it touches a medical decision. The classifier's operating point
 * (MALIGNANT_THRESHOLD / CONFIDENCE_TEMPERATURE in classifier/model-config.ts) and the still-path
 * crop confidence (DET_CONF in classifier/lesion-detector.ts, which decides what the classifier is
 * actually fed) are deliberately NOT reachable from this file. A knob here can make the box calmer
 * or twitchier; it cannot change what the app concludes about a lesion.
 *
 * The detection BARS themselves - CREATE_SCORE / KEEP_SCORE / LOCK_SCORE / DETECT_SHOW /
 * KEEP_GRACE - stay in capture-core.ts, where each carries the measurement that set it. They are
 * decisions about evidence; the values here are decisions about motion.
 *
 * Zero imports on purpose, like capture-core.ts: this compiles standalone under
 * scripts/test-detection-smoothing.mjs (npm run test:smoothing).
 */

/* ------------------------------------------------------------------ the one config object */

export const DETECTION_SMOOTHING_CONFIG = {
  /**
   * 1€ filter constants for the box CENTRE (lib/one-euro.ts). minCutoff sets how hard a nearly
   * still signal is smoothed; beta is how fast the filter opens up as the target starts moving,
   * which is what keeps "stable when stationary" from turning into "laggy when moving".
   *
   * beta is in units of (screen fractions per second)^-1. The shipped 0.05 assumed pixel-scale
   * inputs: a brisk 0.3 screen/s pan raised the cutoff by 0.015 Hz, so the filter was a FIXED
   * 1.5 Hz low-pass and the box trailed the mole by ~100 ms from the filter alone (screen recording,
   * iPhone, 2026-10-15). beta 2 lifts the cutoff by ~0.6 Hz on that pan and well past it on a fast
   * one, while hand tremor (~0.01-0.03 screen/s) barely moves it. minCutoff 1.5 -> 0.5 makes a still
   * box markedly steadier (the second recording read as "jitters a bit"); the speed-driven cutoff
   * and the lead below repay the lag.
   */
  position: { minCutoff: 0.5, beta: 2 },
  /**
   * 1€ constants for WIDTH/HEIGHT - deliberately heavier than `position`.
   *
   * The detector's box dimensions are visibly noisier than its centre: the same lesion, held still,
   * produces a centre that wanders by a pixel or two while the extents move several. Filtering both
   * with one set of constants (which is what shipped) means either the centre lags or the size
   * breathes, and the size breathing is the one people notice. A lower minCutoff smooths size
   * harder; the lower beta keeps it from chasing a size spike that is really just a noisy edge.
   */
  size: { minCutoff: 0.4, beta: 0.5 },
  /**
   * Cutoff (Hz) of the 1€ filter's own speed estimate. The library default of 1 Hz takes several
   * frames to notice that the camera started moving, which is the window in which beta cannot help;
   * 2 Hz notices within one or two detections. The same speed estimate drives `lead` below.
   */
  dCutoff: 2,

  /**
   * Latency compensation. The detector's box describes a frame that is already `resultAge` ms old
   * by the time it is drawn, and the drawn box then has to last until the next detection - so while
   * the camera moves, an unpredicted box is always behind the mole. The lead extrapolates the
   * filtered centre along the filter's own velocity estimate to where the mole is NOW.
   *
   * `minSpeed` is a SOFT dead zone, subtracted from the speed rather than gating it: detector noise
   * alone puts the filtered speed at ~0.06 screen/s on a still hand, and a hard gate there let those
   * spikes through at full strength (jitter 0.0033 vs 0.0019 shipped). Subtracting keeps the still
   * box quieter than before and the response continuous as motion starts.
   *
   * Chosen together with `spring` on the end-to-end sim in scripts/test-detection-smoothing.mjs,
   * which reports trail, still jitter, stutter (how unevenly the box moves frame to frame on a
   * steady pan) and stop overshoot. A hard gate with gain 1 was jitterier than shipped and
   * overshot ~0.027 of the screen.
   *
   * `maxLeadMs` / `maxLead` bound the extrapolation on a slow phone or a wild swing.
   */
  lead: { gain: 1, minSpeed: 0.1, maxLeadMs: 150, maxLead: 0.06 },

  /**
   * Deadband (fraction of the screen) below which movement is damped away rather than drawn, so
   * the box does not creep while the user holds still. SOFT, not hard - see `softDeadband`.
   */
  positionDeadband: 0.004,
  /** Size deadband multiplier: width/height are noisier than centre, so their band is wider. */
  sizeDeadbandScale: 1.5,

  /**
   * Association gate. Once a lesion is being tracked, a detection whose centre lands further than
   * this (fraction of the screen) from the tracked box is treated as a DIFFERENT object rather than
   * as this one having teleported.
   *
   * 0.28 is a little over a quarter of the frame - far beyond anything a real lesion covers between
   * two frames 83 ms apart at 12 fps, and comfortably inside the distance between two separate moles
   * that the argmax might alternate between.
   */
  maxTrackingDistance: 0.28,
  /**
   * How many consecutive far detections it takes to hand the track over to the new object. Without
   * this the gate would be a trap: a user who genuinely swings the camera to another lesion would
   * be stuck watching a box on the old one. Three frames at 12 fps is a quarter-second of the
   * detector consistently insisting, which noise cannot fake.
   */
  handoverFrames: 3,

  /**
   * Fade in/out of the tracked box, in ms. This is the answer to "detection lost" - the box fades
   * where it stands instead of flying back to the centred searching guide, and the guide fades in
   * behind it. Short enough not to read as lag, long enough not to read as a snap. The border
   * colour rides the same fade, which is what removes the white->green snap.
   */
  fadeOutMs: 180,
  fadeInMs: 120,

  /**
   * Spring used to carry the filtered box from one detection to the next, i.e. what fills the
   * ~83 ms between inference results at display refresh rate.
   *
   * CRITICALLY DAMPED ON PURPOSE. The shipped value was {damping 24, stiffness 320}, which at
   * Reanimated's default mass of 1 is a damping ratio of 24 / (2*sqrt(320)) = 0.67 - underdamped.
   * Every detection kicked a fresh ~6% overshoot that rang back before the next one arrived, so the
   * box vibrated at the detector's cadence even when the filtered target was perfectly still. That
   * was the largest single contributor to the jitter, and it sat downstream of a 1€ filter that was
   * doing its job correctly.
   *
   * Damping is 2*sqrt(stiffness): the box approaches its target and stops, without overshoot or
   * ring. `criticalDamping` derives it rather than hard-coding, so re-tuning stiffness cannot
   * silently reintroduce the oscillation.
   *
   * Stiffness is 320 ON PURPOSE - it was briefly 1600 (2026-10-15) to cut the spring's 2/omega
   * trail, and that was wrong: a 1600 spring finishes each move in ~70 ms, but on device detections
   * land every 100-230 ms, so a steady pan played as dash-stop-dash-stop. Measured frame by frame
   * on the second screen recording, and on the sim as stutter 0.58 vs 0.18 at 320. At 320 each
   * move glides across most of the gap to the next detection; the trail it adds is what the lead
   * above is for.
   */
  spring: { stiffness: 320, mass: 1 },
} as const;

/** Damping that makes a spring critically damped: the fastest approach with no overshoot. */
export function criticalDamping(stiffness: number, mass = 1): number {
  return 2 * Math.sqrt(stiffness * mass);
}

/** The Reanimated spring config the box is animated with. */
export function boxSpring(): { stiffness: number; mass: number; damping: number } {
  const { stiffness, mass } = DETECTION_SMOOTHING_CONFIG.spring;
  return { stiffness, mass, damping: criticalDamping(stiffness, mass) };
}

/**
 * How far (screen fractions) to push the filtered centre ahead along its velocity, so the drawn box
 * sits where the lesion is now rather than where it was when the frame was captured.
 *
 * `speed` is the 1€ filter's derivative (screen fractions / s), `ageMs` how old the detection is on
 * arrival, `intervalMs` the detection cadence - the box will be shown for about half an interval on
 * average before the next one replaces it. `minSpeed` is subtracted (soft dead zone), so a still
 * box never moves and the lead grows continuously from zero as motion starts.
 */
export function predictLead(
  speed: number,
  ageMs: number,
  intervalMs: number,
  cfg: { gain: number; minSpeed: number; maxLeadMs: number; maxLead: number } = DETECTION_SMOOTHING_CONFIG.lead,
): number {
  const magnitude = Math.abs(speed);
  if (!Number.isFinite(speed) || magnitude <= cfg.minSpeed) return 0;
  const leadS = Math.min(cfg.maxLeadMs, Math.max(0, ageMs) + Math.max(0, intervalMs) / 2) / 1000;
  const lead = cfg.gain * Math.sign(speed) * (magnitude - cfg.minSpeed) * leadS;
  return Math.max(-cfg.maxLead, Math.min(cfg.maxLead, lead));
}

/* ------------------------------------------------------------------ smoothing primitives */

/**
 * Soft deadband: suppress sub-threshold movement WITHOUT freezing the value.
 *
 * The hard version this replaces returned `prev` unchanged until the move exceeded epsilon. That
 * kills creep, but it also accumulates: the 1€ filter behind it keeps advancing, so when the target
 * finally drifts past the band the drawn box jumps the whole accumulated distance in one frame -
 * a stair-step, and (before the spring was fixed) an overshoot on top of it.
 *
 * Subtracting the band instead makes the response continuous: zero movement at the threshold,
 * growing smoothly beyond it, and no stored error to release later. Motion larger than the band
 * still arrives at full speed, just offset by epsilon, which is imperceptible at these magnitudes.
 */
export function softDeadband(next: number, prev: number | null, epsilon: number): number {
  if (prev == null) return next;
  const delta = next - prev;
  const mag = Math.abs(delta);
  if (mag <= epsilon) return prev;
  return prev + Math.sign(delta) * (mag - epsilon);
}

/* ------------------------------------------------------------------ frame-to-frame association */

/**
 * Which object the track is following. `farStreak` counts consecutive detections that landed
 * outside `maxTrackingDistance`, i.e. how long the detector has been insisting on a different one.
 */
export type AssociationState = { farStreak: number };

export const initialAssociationState: AssociationState = { farStreak: 0 };

export type AssociationStep = {
  state: AssociationState;
  /** Feed this detection into the filters? */
  accept: boolean;
  /** Accepting a genuinely different object - reset the filters so it doesn't glide across. */
  handover: boolean;
};

/**
 * Decide whether a detection belongs to the lesion already being tracked.
 *
 * The worklet takes a global argmax over ~12k anchors every frame with no memory of the previous
 * one, so with two lesions in frame at similar confidence the winner can alternate and the box
 * teleports back and forth. Centre distance is the association metric rather than IoU because the
 * detector's SIZE is its noisiest output - an IoU gate would drop good detections of the tracked
 * lesion whenever its predicted extents wobbled, which is precisely the noise being filtered out.
 *
 * `prevCentre` null means nothing is being tracked yet: accept, with no handover (there is no
 * filter history to clear).
 */
export function stepAssociation(
  prev: AssociationState,
  prevCentre: { x: number; y: number } | null,
  next: { x: number; y: number },
  cfg: { maxTrackingDistance: number; handoverFrames: number } = DETECTION_SMOOTHING_CONFIG,
): AssociationStep {
  if (prevCentre == null) {
    return { state: { farStreak: 0 }, accept: true, handover: false };
  }
  const dist = Math.hypot(next.x - prevCentre.x, next.y - prevCentre.y);
  if (dist <= cfg.maxTrackingDistance) {
    return { state: { farStreak: 0 }, accept: true, handover: false };
  }
  const farStreak = prev.farStreak + 1;
  if (farStreak >= cfg.handoverFrames) {
    return { state: { farStreak: 0 }, accept: true, handover: true };
  }
  return { state: { farStreak }, accept: false, handover: false };
}

import { NitroModules } from 'react-native-nitro-modules';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, useWindowDimensions, Vibration, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS, useSharedValue as useWorkletValue } from 'react-native-worklets-core';

import { ThemedText } from '@/components/themed-text';
import {
  applyDeadband,
  computeCoach,
  fullFrameToPreview,
  initialTrackState,
  isStable,
  modelCropToFullFrame,
  padDrawnBox,
  stepStability,
  stepTrack,
  type Coach,
  type CoachKind,
  type TrackState,
  DEADBAND,
  GATE_BLURRY,
  GATE_BRIGHT,
  GATE_DARK,
  GATE_OK,
  KEEP_SCORE,
  LOCK_SCORE,
  SIZE_DEADBAND_SCALE,
} from '@/lib/capture-core';
import { BRIGHT, DARK } from '@/lib/image-quality-core';
import { MAX_IMAGES_PER_SCREENING } from '@/lib/classifier/model-config';
import { useScreeningSession } from '@/lib/screening-session';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { GradientBackground } from '@/components/ui/gradient-background';
import { CaptureCoach } from '@/components/scan/too-dark-overlay';
import {
  DetectionBox,
  resetDetectionBox,
  trackDetectionBox,
  useDetectionBoxValues,
} from '@/components/scan/detection-box';
import { PerfHud, PERF_ENABLED, usePerfCounters } from '@/components/scan/perf-hud';
import { useDeviceTier } from '@/lib/device-tier';
import { getLesionModel, readLayout, type LesionModel } from '@/lib/lesion-model';
import { makeOneEuro } from '@/lib/one-euro';
import { Radius, Space } from '@/constants/theme';

// Reanimated-animated camera so pinch-zoom writes to a shared value (no React re-renders, which
// would recreate the gesture mid-pinch and crash react-native-gesture-handler).
const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);
Reanimated.addWhitelistedNativeProps({ zoom: true });

// One-Euro filter params for the box (see lib/one-euro.ts). Low minCutoff = steady when still;
// beta adds responsiveness when the lesion actually moves. Tune on device.
const EURO_MIN_CUTOFF = 1.5;
const EURO_BETA = 0.05; // higher = snaps to real motion faster (less follow-lag), still smooth when still
// Worklet-only: anchors this confident (and near the best) are fused into the box. Stays here
// because it is consumed inside the frame processor, not by any decision capture-core owns.
const FUSE_SCORE = 0.25;
/**
 * Live exposure coaching, DERIVED from the still gate rather than hand-typed.
 *
 * The invariant: the viewfinder must never be more permissive than the gate one screen later. A
 * frame the coach calls fine must not then be rejected by image-quality-core — that is the worst
 * kind of feedback, because the user has already committed to the shot.
 *
 * The dark side always encoded this (0.16 + 0.04 = the 0.20 that was hard-coded here), but the
 * bright side had the sign inverted: 0.82 vs a still-gate reject at 0.80, so a frame at luma 0.81
 * read "looks good" and was then thrown out. Deriving both from DARK/BRIGHT with one margin makes
 * the relationship structural, so re-tuning the still gate can't silently invert it again.
 *
 * Both metrics are mean luminance in 0..1, so they are directly comparable — the worklet samples a
 * strided subset of the model input and the gate averages the whole resized still, but neither is
 * a different *quantity*.
 */
// Drawing-only padding for the green box; the forwarded crop box stays tight.
const BOX_PAD = 0.25;
const BOX_MAX = 0.98;

const LIVE_MARGIN = 0.04; // coach this much before the still gate would reject
const DARK_THRESHOLD = DARK + LIVE_MARGIN; // 0.20
const BRIGHT_THRESHOLD = BRIGHT - LIVE_MARGIN; // 0.76
/**
 * Live focus coaching: mean horizontal gradient energy (red channel, 8px gap, every 16th pixel).
 *
 * Raised 0.0004 -> 0.0006 (2026-08-04), measured by synth/eval/live_gate_eval.py on 120 held-out
 * clinical photos at six blur levels. The old value let a THIRD of frames the still gate rejects
 * pass the viewfinder without comment — the user then commits to the shot and is told on the next
 * screen. The metric itself is fine (AUROC 0.909 against the still gate's verdict); only its
 * threshold was too permissive.
 *
 *   value    blurry frames the coach misses    false "blurry" on crisp photos
 *   0.0004            31.7%                              10.8%     <- was shipped
 *   0.0006            19.1%                              17.5%     <- here
 *   0.00077           13.7%                              23.3%     <- best raw agreement
 *
 * Not taking the best-agreement point: a quarter of good frames drawing a blur warning is nagging,
 * and this coach is transient guidance rather than a gate. BLUR_SHOW below already requires 5
 * consecutive blurry frames, which absorbs most of the added false-warn cost while the missed-blur
 * reduction is persistent.
 *
 * Caveat: measured on still photos as a proxy for preview frames. Real frames carry sensor noise
 * that inflates gradient energy, so the true false-warn rate is likely LOWER than the table.
 */
const BLUR_THRESHOLD = 0.0006;
const BLUR_SHOW = 5; // consecutive blurry frames before coaching (avoids flicker on plain/brief frames)
// Per-frame diagnostics. MUST ship false: the log below runs inside the frame processor, so a true
// value costs a worklet->JS hop plus a console.log at the detector's full cadence (12/s on a
// high-tier device) on the hottest path in the app — and it distorts the very frame-rate numbers
// anyone flipping it would be trying to measure. Deliberately NOT __DEV__ for that reason.
const DEBUG = false; // flip to true only while actively tuning best/sharp/lume

// Detector cadence. Low-end devices can't sustain 12 passes/second alongside the preview, and
// missing the budget costs far more (dropped preview frames, a janky JS thread) than a slower box.
const TARGET_FPS_HIGH = 12;
const TARGET_FPS_LOW = 6;

// The camera is deliberately UNCONSTRAINED: no `format`, no device preference, no quality or
// stabilisation props — exactly as it shipped before 6240da8 (2026-07-24), which capped the format
// to 1280x720 and is the "camera looks blurred" regression. Every phone picks its own best format,
// which is why low-end Androids looked right too: they got *their* best, not a hard-coded 720p.
//
// That commit's stated reason ("a 720² crop still downsamples into the model's input") was true of
// the 640-input detector it was written against; the detector had moved to a 768 input three weeks
// earlier, so it had been UPSCALING into the model ever since. If the frame budget ever needs
// bounding, bound the analysis path inside the frame processor — never the preview.
//
// The still is therefore full-sensor. PHOTO_LONG_EDGE below caps it when the EXIF orientation is
// baked in, which is where the downstream decode cost is actually contained.

/**
 * Video-stream resolution. This drives BOTH the on-screen preview and the frames the detector
 * sees, which is why it was wrong in two directions at once at 1280x720:
 *
 *  1. THE PREVIEW LOOKED SOFT. A 720p stream stretched onto a ~1179x2556 display is roughly a 3x
 *     upscale, and pinch-zoom crops into that already-thin frame — so zooming looked grainy. This
 *     is the "camera looks blurred" report, and it is a display problem, not a lens or focus one.
 *  2. IT UPSCALED INTO THE DETECTOR, which is the exact failure the comment below warns against.
 *     The detector input is 768. A 720-short-edge frame yields a 720x720 centre crop, and the
 *     resize plugin then scales that UP to 768x768 — inventing pixels and costing recall.
 *
 * 1080p fixes both: the preview is far closer to native, and 1080 > 768 so the detector finally
 * gets a genuine downsample. Low-tier devices stay at 720p, because the frame processor's cost
 * scales with source pixels (1080p is 2.25x the data per frame) and they buy their headroom here.
 */
// Zoom-slider geometry. Shared so the knob can be seated on the track by arithmetic instead of a
// percentage that silently depends on the padding staying put.
const ZOOM_TRACK_H = 4;
const ZOOM_KNOB = 16;
const ZOOM_PAD_V = 20;

const PHOTO_LONG_EDGE = 2048; // cap applied when baking in the EXIF orientation


export default function CaptureScreen() {
  const session = useScreeningSession();
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const { width: SW, height: SH } = useWindowDimensions();
  const tier = useDeviceTier();

  // The Stack keeps this screen mounted underneath crop → quality → questionnaire → analysis.
  // Without this gate the preview and the detector keep running through all of them, competing
  // with the classifier for exactly the CPU it needs.
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Cap both streams instead of taking the device default, which is typically the largest format
  // it offers. `videoResolution` is what the resize plugin downsamples every frame — the biggest
  // native cost in the frame processor — and the photo is what the whole diagnosis rests on, so
  // photoResolution is ranked first: capping the analysis stream must never cost capture quality.
  //
  const [model, setModel] = useState<LesionModel | null>(null);
  useEffect(() => {
    let alive = true;
    getLesionModel()
      .then((m) => {
        if (alive) setModel(m);
      })
      .catch((e) => console.warn('[tflite] model load failed', e));
    return () => {
      alive = false;
    };
  }, []);

  const [torch, setTorch] = useState(false);
  const [aiCamera, setAiCamera] = useState(true);
  const [busy, setBusy] = useState(false);
  const [focusPt, setFocusPt] = useState<{ x: number; y: number; id: number } | null>(null);

  // The ONLY per-frame-derived React state. Everything else the detector produces (the box pose,
  // the raw metrics) is written to shared values or refs, so a new detection re-renders this
  // screen exactly when the on-screen coaching copy has to change — not 12 times a second.
  const [coach, setCoach] = useState<Coach | null>('search');
  const coachRef = useRef<Coach | null>('search');
  const gateRef = useRef<number>(GATE_OK);
  // Full-frame box metrics (normalized) used for the positional coaching (distance/centering).
  // `stable` = the box has barely moved for STABLE_FRAMES, i.e. the framing is settled.
  const metricsRef = useRef<
    { cx: number; cy: number; w: number; h: number; locked: boolean; stable: boolean } | null
  >(null);
  const aiCameraRef = useRef(aiCamera);

  const boxValues = useDetectionBoxValues();
  const perf = usePerfCounters();

  /** Recompute the single coaching message from the latest gate + framing, and render only on change. */
  const applyCoach = useCallback(() => {
    const next = computeCoach(aiCameraRef.current, gateRef.current, metricsRef.current);
    if (next === coachRef.current) return;
    coachRef.current = next;
    setCoach(next);
  }, []);

  const maxZoom = Math.min(device?.maxZoom ?? 1, 8);
  const minZoom = device?.minZoom ?? 1;

  const zoomSV = useSharedValue(1);
  const startZoom = useSharedValue(1);
  useEffect(() => {
    if (device?.neutralZoom) zoomSV.value = device.neutralZoom;
  }, [device, zoomSV]);

  // Detection hysteresis + stability, owned by capture-core so it can be tested without a camera.
  const trackRef = useRef<TrackState>(initialTrackState);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const lastSize = useRef<{ w: number; h: number } | null>(null);
  // The detected box in full-frame (= saved photo) normalized coords, carried to the crop
  // screen so it can auto-frame the lesion without re-running the model (see shoot()).
  const lastImgBox = useRef<{ cx: number; cy: number; w: number; h: number } | null>(null);
  // One-Euro filters — one per tracked scalar. Preview box (what's drawn) + img box (forwarded
  // to crop). These keep the box steady under small camera shifts but responsive to real motion.
  const euro = useRef({
    px: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    py: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    pw: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    ph: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    ix: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    iy: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    iw: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
    ih: makeOneEuro(EURO_MIN_CUTOFF, EURO_BETA),
  }).current;
  const clearTrack = () => {
    trackRef.current = initialTrackState;
    resetDetectionBox(boxValues);
    metricsRef.current = null;
    lastCenter.current = null;
    lastSize.current = null;
    lastImgBox.current = null;
    // Forget filter history so re-acquiring snaps to the new box instead of gliding from the old.
    Object.values(euro).forEach((f) => f.reset());
    applyCoach();
  };
  const onDetection = useRunOnJS(
    (
      d: {
        mcx: number;
        mcy: number;
        mw: number;
        mh: number;
        frameW: number;
        frameH: number;
        score: number;
        locked: boolean;
      } | null,
    ) => {
      // Confidence hysteresis, deadband, stability and the coordinate mapping are all capture-core's
      // (npm run test:capture). This function is now the wiring between the worklet and that logic.
      const step = stepTrack(trackRef.current, d ? d.score : null);
      trackRef.current = step.state;
      if (!d) {
        if (step.cleared) clearTrack();
        return;
      }
      if (!step.visible) return; // still acquiring, or too weak to start a track

      {
        const t = Date.now();
        // Undo the detector's centred square crop, then apply the preview's cover-crop.
        const full = modelCropToFullFrame(
          { cx: d.mcx, cy: d.mcy, w: d.mw, h: d.mh },
          d.frameW,
          d.frameH,
        );
        const prevBox = fullFrameToPreview(full, d.frameW, d.frameH, SW, SH);
        const drawn = padDrawnBox(prevBox, BOX_PAD, BOX_MAX);
        const b = { x: drawn.cx - drawn.w / 2, y: drawn.cy - drawn.h / 2, w: drawn.w, h: drawn.h };

        // Filter the preview box (center + size), then apply a deadband so tiny residual
        // movement doesn't make the box creep when the user is holding still.
        let fx = euro.px.filter(b.x + b.w / 2, t);
        let fy = euro.py.filter(b.y + b.h / 2, t);
        let fw = euro.pw.filter(b.w, t);
        let fh = euro.ph.filter(b.h, t);
        const prev = lastCenter.current;
        // How far the box moved this frame → "stable" once it holds still for a while.
        const moved = prev ? Math.max(Math.abs(fx - prev.x), Math.abs(fy - prev.y)) : 1;
        fx = applyDeadband(fx, prev ? prev.x : null, DEADBAND);
        fy = applyDeadband(fy, prev ? prev.y : null, DEADBAND);
        const prevS = lastSize.current;
        fw = applyDeadband(fw, prevS ? prevS.w : null, DEADBAND * SIZE_DEADBAND_SCALE);
        fh = applyDeadband(fh, prevS ? prevS.h : null, DEADBAND * SIZE_DEADBAND_SCALE);
        trackRef.current = {
          ...trackRef.current,
          stableStreak: stepStability(trackRef.current.stableStreak, moved),
        };
        lastCenter.current = { x: fx, y: fy };
        lastSize.current = { w: fw, h: fh };
        // Straight to the UI thread: the spring still interpolates these 12 Hz updates up to
        // display rate, but React is not involved.
        trackDetectionBox(boxValues, { x: fx - fw / 2, y: fy - fh / 2, w: fw, h: fh });

        // Filter the forward-to-crop box in full-frame coords (also feeds positional coaching).
        const icx = euro.ix.filter(full.cx, t);
        const icy = euro.iy.filter(full.cy, t);
        const iw = euro.iw.filter(full.w, t);
        const ih = euro.ih.filter(full.h, t);
        lastImgBox.current = { cx: icx, cy: icy, w: iw, h: ih };
        metricsRef.current = {
          cx: icx,
          cy: icy,
          w: iw,
          h: ih,
          locked: d.locked,
          stable: isStable(trackRef.current),
        };
        applyCoach();
      }
    },
    // SW/SH feed the preview mapping, so a rotation must rebuild this closure rather than keep
    // mapping against the old screen size.
    [SW, SH],
  );
  // Quality gates arrive as a single code, already debounced in the worklet, and only when the
  // verdict actually changes — instead of three unconditional JS hops per frame.
  const onGate = useRunOnJS((code: number) => {
    gateRef.current = code;
    applyCoach();
  }, []);
  const onDebug = useRunOnJS((msg: string) => console.log('[fp]', msg), []);

  // Worklet-side gate state, so the blur streak survives between frames and the emit can be
  // change-gated without a JS round trip. `-1` forces the next frame to re-emit.
  const blurStreakSV = useWorkletValue(0);
  const lastGateSV = useWorkletValue(-1);

  // VisionCamera v4's worklet can't touch a Nitro HybridObject's native state, so box the
  // model (unbox inside the worklet) and read the output/input shapes here on the JS thread.
  const boxedModel = useMemo(() => (model != null ? NitroModules.box(model) : undefined), [model]);
  const layout = useMemo(() => (model == null ? null : readLayout(model)), [model]);

  const targetFps = tier === 'low' ? TARGET_FPS_LOW : TARGET_FPS_HIGH;
  // Weighted Boxes Fusion costs a second walk over the confident anchors to steady the box. The
  // One-Euro filter already does most of that job, so low-end devices spend the budget on cadence.
  const fuseBoxes = tier !== 'low';

  // Re-arm the gate whenever the detector stops or starts, so a stale "too dark" overlay can't
  // outlive the frames that produced it.
  /* eslint-disable react-hooks/immutability -- worklet shared values are native-backed handles,
     not React state; the compiler flags every write to one (same false positive the Reanimated
     shared-value writes elsewhere in this file trip). */
  useEffect(() => {
    aiCameraRef.current = aiCamera;
    lastGateSV.value = -1;
    blurStreakSV.value = 0;
    gateRef.current = GATE_OK;
    if (!aiCamera || !isFocused) {
      metricsRef.current = null;
      resetDetectionBox(boxValues);
    }
    applyCoach();
  }, [aiCamera, isFocused, applyCoach, boxValues, blurStreakSV, lastGateSV]);
  /* eslint-enable react-hooks/immutability */

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (boxedModel == null || layout == null) return;
      runAtTargetFps(targetFps, () => {
        'worklet';
        const t0 = Date.now();
        const tflite = boxedModel.unbox();
        const input = resize(frame, {
          scale: { width: layout.inputSize, height: layout.inputSize },
          pixelFormat: 'rgb',
          dataType: 'float32',
          rotation: '90deg',
        });

        // Quality gates over the model input (rgb float 0..1): mean luminance for "too dark",
        // mean horizontal gradient energy for "too blurry / hold steady".
        const Wn = layout.inputSize;
        let sum = 0;
        let n = 0;
        let grad = 0;
        let gc = 0;
        for (let y = 0; y < Wn; y += 16) {
          const row = y * Wn;
          for (let x = 0; x < Wn - 8; x += 16) {
            const r = input[(row + x) * 3];
            sum += r;
            n++;
            const d = input[(row + x + 8) * 3] - r;
            grad += d * d;
            gc++;
          }
        }
        const lume = n > 0 ? sum / n : 1;
        const sharp = gc > 0 ? grad / gc : 1;

        // Fold the three gates into one code, in the same priority order the overlays use, and
        // debounce the blur streak here so the JS thread only hears about real changes.
        let gate = GATE_OK;
        if (lume < DARK_THRESHOLD) gate = GATE_DARK;
        else if (lume > BRIGHT_THRESHOLD) gate = GATE_BRIGHT;
        else if (sharp < BLUR_THRESHOLD) gate = GATE_BLURRY;
        if (gate === GATE_BLURRY) {
          blurStreakSV.value = Math.min(BLUR_SHOW + 2, blurStreakSV.value + 1);
          if (blurStreakSV.value < BLUR_SHOW) gate = GATE_OK; // not yet enough consecutive blurry frames
        } else {
          blurStreakSV.value = 0;
        }
        if (gate !== lastGateSV.value) {
          lastGateSV.value = gate;
          onGate(gate);
        }

        // `resize` hands back a Float32Array over its own freshly allocated buffer, so the whole
        // buffer IS the tensor — copying it would burn ~5 MB per frame for nothing. The guard
        // keeps the copy as a fallback in case the plugin ever returns a view into a pool.
        // (fast-tflite takes a raw ArrayBuffer, never a TypedArray.)
        const inputBuffer =
          input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
            ? input.buffer
            : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
        const outputs = tflite.runSync([inputBuffer as ArrayBuffer]);
        const out = new Float32Array(outputs[0]);
        const chMajor = layout.chMajor;
        const channels = layout.channels;
        const anchors = layout.anchors;
        const numClasses = layout.numClasses;

        // Single pass — argmax + candidate collection. Find the highest-scoring anchor and its box
        // (center in channels 0,1; w/h in channels 2,3, all normalized to the model input), and at
        // the same time remember every anchor confident enough to be fused below. The fusion used
        // to re-walk all ~8400 anchors and recompute the same per-anchor class max; collecting the
        // handful of survivors here makes that second walk proportional to the candidates instead.
        let best = 0;
        let bcx = 0;
        let bcy = 0;
        let bbw = 0;
        let bbh = 0;
        const candIdx: number[] = [];
        const candScore: number[] = [];
        for (let i = 0; i < anchors; i++) {
          let score = 0;
          if (chMajor) {
            for (let k = 0; k < numClasses; k++) {
              const v = out[(4 + k) * anchors + i];
              if (v > score) score = v;
            }
          } else {
            const base = i * channels;
            for (let k = 0; k < numClasses; k++) {
              const v = out[base + 4 + k];
              if (v > score) score = v;
            }
          }
          if (score > best) {
            best = score;
            bcx = out[chMajor ? i : i * channels];
            bcy = out[chMajor ? anchors + i : i * channels + 1];
            bbw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            bbh = out[chMajor ? 3 * anchors + i : i * channels + 3];
          }
          if (score >= FUSE_SCORE) {
            candIdx.push(i);
            candScore.push(score);
          }
        }

        // Weighted Boxes Fusion: a single argmax anchor flickers frame-to-frame (a different
        // anchor wins each frame), which makes the box jitter. Fuse all confident anchors near
        // the best one (confidence-weighted average of cx,cy,w,h) into one steady box. The
        // proximity gate keeps a second, distant lesion from being merged in.
        let cx = bcx;
        let cy = bcy;
        let bw = bbw;
        let bh = bbh;
        if (fuseBoxes && best >= KEEP_SCORE) {
          const near = Math.max(bbw, bbh) * 0.5;
          let ws = 0;
          let sx = 0;
          let sy = 0;
          let sw = 0;
          let sh = 0;
          for (let c = 0; c < candIdx.length; c++) {
            const i = candIdx[c];
            const ax = out[chMajor ? i : i * channels];
            const ay = out[chMajor ? anchors + i : i * channels + 1];
            if (Math.abs(ax - bcx) > near || Math.abs(ay - bcy) > near) continue;
            const aw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            const ah = out[chMajor ? 3 * anchors + i : i * channels + 3];
            const score = candScore[c];
            ws += score;
            sx += score * ax;
            sy += score * ay;
            sw += score * aw;
            sh += score * ah;
          }
          if (ws > 0) {
            cx = sx / ws;
            cy = sy / ws;
            bw = sw / ws;
            bh = sh / ws;
          }
        }

        if (DEBUG) onDebug('best=' + best.toFixed(2) + ' sharp=' + sharp.toFixed(4) + ' lume=' + lume.toFixed(2));

        if (best >= KEEP_SCORE) {
          // The model→screen mapping lives in capture-core (pinned by npm run test:capture) and
          // runs on the JS side. A worklet can only call functions marked 'worklet', and keeping
          // this arithmetic somewhere it can be imported and unit-tested normally is worth
          // forwarding four extra numbers across the bridge — it is the piece whose failure mode
          // is a silently off-target crop rather than a visible error.
          onDetection({
            mcx: cx,
            mcy: cy,
            mw: bw,
            mh: bh,
            frameW: frame.width,
            frameH: frame.height,
            score: best,
            locked: best >= LOCK_SCORE,
          });
        } else {
          onDetection(null);
        }

        if (PERF_ENABLED) {
          const dt = Date.now() - t0;
          perf.frames.value = perf.frames.value + 1;
          perf.sumMs.value = perf.sumMs.value + dt;
          if (dt > perf.maxMs.value) perf.maxMs.value = dt;
        }
      });
    },
    [boxedModel, layout, resize, targetFps, fuseBoxes, onDetection, onGate, onDebug, blurStreakSV, lastGateSV, perf],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          'worklet';
          startZoom.value = zoomSV.value;
        })
        .onUpdate((e) => {
          'worklet';
          zoomSV.value = Math.min(maxZoom, Math.max(minZoom, startZoom.value * e.scale));
        }),
    [maxZoom, minZoom, zoomSV, startZoom],
  );

  // Tap-to-focus like the native camera: focus the device at the tapped point + show a reticle.
  const focusAt = useCallback(
    (x: number, y: number) => {
      const cam = camera.current;
      if (!cam) return;
      setFocusPt({ x, y, id: Date.now() });
      cam.focus({ x, y }).catch((e) => console.log('[focus] err', String(e)));
    },
    [],
  );
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .runOnJS(true)
        .onEnd((e) => focusAt(e.x, e.y)),
    [focusAt],
  );
  const gesture = useMemo(() => Gesture.Simultaneous(pinch, tap), [pinch, tap]);

  useEffect(() => {
    if (!focusPt) return;
    const t = setTimeout(() => setFocusPt(null), 900);
    return () => clearTimeout(t);
  }, [focusPt]);

  const animatedProps = useAnimatedProps(() => ({ zoom: zoomSV.value }), [zoomSV]);
  const zoomBarStyle = useAnimatedStyle(() => ({
    width: `${Math.round(((zoomSV.value - minZoom) / Math.max(0.001, maxZoom - minZoom)) * 100)}%`,
  }));
  const zoomKnobStyle = useAnimatedStyle(() => ({
    left: `${Math.round(((zoomSV.value - minZoom) / Math.max(0.001, maxZoom - minZoom)) * 100)}%`,
  }));

  /**
   * One-finger zoom: drag (or tap) anywhere along the zoom bar.
   *
   * Pinch needs two hands here — one is usually holding the skin taut, or the phone steady at macro
   * distance — so the existing zoom indicator is made interactive rather than adding a hidden
   * gesture. It was already on screen and already showed the current zoom, so this costs no new UI
   * and is discoverable, which a double-tap-and-drag would not be.
   *
   * Absolute mapping (position along the track = zoom level), like a native camera slider, so a
   * single tap can jump straight to a level. minDistance(0) makes that tap register without waiting
   * for movement. The width comes from onLayout rather than SW * 0.6 so it stays correct if the
   * layout ever changes.
   */
  const zoomTrackW = useSharedValue(0);
  const zoomDrag = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          'worklet';
          if (zoomTrackW.value <= 0) return;
          const t = Math.min(1, Math.max(0, e.x / zoomTrackW.value));
          zoomSV.value = minZoom + t * (maxZoom - minZoom);
        })
        .onUpdate((e) => {
          'worklet';
          if (zoomTrackW.value <= 0) return;
          const t = Math.min(1, Math.max(0, e.x / zoomTrackW.value));
          zoomSV.value = minZoom + t * (maxZoom - minZoom);
        }),
    [minZoom, maxZoom, zoomSV, zoomTrackW],
  );

  // One haptic tick the moment the frame becomes good, so a well-framed shot feels earned.
  const wasReady = useRef(false);
  useEffect(() => {
    const ready = coach === 'ready';
    if (ready && !wasReady.current) Vibration.vibrate(10);
    wasReady.current = ready;
  }, [coach]);

  async function shoot() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      // Never fire a flash burst: it flickers (VisionCamera toggles the torch off→burst→on) and
      // captures at the wrong exposure. The torch toggle is the light control — WYSIWYG with the
      // preview — so we shoot under the steady light already shown.
      const photo = await camera.current.takePhoto({ flash: 'off' });
      const raw = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      // VisionCamera writes orientation as EXIF only; bake it into the pixels so the crop
      // screen's Image.getSize dims and the displayed image agree (otherwise it shows sideways).
      // Cap the long edge in the same pass: everything downstream (crop, the IQA decode, the
      // classifier's pre-decode resize) pays for every extra pixel, and none of them can use
      // more than this. Capture is portrait-locked, so after `rotate: 0` the long edge is the
      // height; if a device ever surprises us the image just stays larger, never distorted.
      const actions: Parameters<typeof manipulateAsync>[1] = [{ rotate: 0 }];
      if (Math.max(photo.width, photo.height) > PHOTO_LONG_EDGE) {
        actions.push({ resize: { height: PHOTO_LONG_EDGE } });
      }
      const upright = await manipulateAsync(raw, actions, { compress: 0.92, format: SaveFormat.JPEG });
      // Carry the live detector's verdict + box forward. We can't re-run the model on the still
      // here — its interpreter is busy on the camera thread, and hitting it from JS crashes — so
      // the crop screen uses this box (full-frame normalized) to auto-frame the lesion.
      const box = lastImgBox.current;
      const hadDetection = metricsRef.current != null;
      router.push({
        pathname: '/scan/crop',
        params: {
          uri: upright.uri,
          detected: hadDetection ? '1' : '0',
          ...(box && hadDetection
            ? { lx: String(box.cx), ly: String(box.cy), lw: String(box.w), lh: String(box.h) }
            : {}),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  if (!hasPermission) {
    return (
      <View style={[styles.black, styles.permission, { paddingTop: insets.top + Space.huge }]}>
        <ThemedText type="title2" style={styles.permTitle}>
          Camera access needed
        </ThemedText>
        <ThemedText type="body" style={styles.permBody}>
          SpotOn uses your camera to detect and capture the skin spot for triage.
        </ThemedText>
        <Button label="Allow camera" variant="brand" onPress={requestPermission} style={styles.permBtn} />
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <ThemedText type="headline" style={styles.permCancel}>
            Not now
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  if (!device) return <View style={styles.black} />;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <ReanimatedCamera
            ref={camera}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isFocused && appActive}
            photo
            animatedProps={animatedProps}
            torch={torch ? 'on' : 'off'}
            frameProcessor={aiCamera && isFocused ? frameProcessor : undefined}
          />
        </View>
      </GestureDetector>

      {focusPt ? <FocusReticle key={focusPt.id} x={focusPt.x} y={focusPt.y} /> : null}

      {/* Framing brackets */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.bracket, styles.tl]} />
        <View style={[styles.bracket, styles.tr]} />
        <View style={[styles.bracket, styles.bl]} />
        <View style={[styles.bracket, styles.br]} />
      </View>

      {/* AI camera = live lesion detector; the box tracks the detected lesion. */}
      {aiCamera ? <DetectionBox values={boxValues} /> : null}

      {/* Standing framing hint, tied to the bracket frame it refers to.
          The coach pill above is REACTIVE — it only says "Center the spot" once the detector has
          found a lesion and it has already drifted off. This states the goal up front, which is
          what a first-time user needs while the detector is still searching. It disappears once
          the frame is good ('ready') or once the coach is saying the same thing ('offcenter'),
          so the two never stack. Framing matters here beyond tidiness: the classifier is
          scale-sensitive, and a lesion parked in the corner is the wide-framing failure mode the
          whole detector-crop path exists to fight. */}
      {!busy && coach !== 'ready' && coach !== 'offcenter' && coach !== 'dark' && coach !== 'bright' ? (
        <View style={styles.frameHint} pointerEvents="none">
          <ThemedText type="caption" style={styles.frameHintText}>
            Keep the spot centered in the box
          </ThemedText>
        </View>
      ) : null}

      {/* Hide the live coaches during capture — frames glitch dark/blurry as the shutter fires.
          Too-dark takes the full screen (you can't see anyway); blur is a compact banner so the
          preview stays visible and the user can watch it sharpen. */}
      {busy || coach == null ? null : coach === 'dark' ? (
        <CaptureCoach title="It's too dark" subtitle="Turn on the light or move somewhere brighter" icon="sun.max" />
      ) : coach === 'bright' ? (
        <CaptureCoach title="It's too bright" subtitle="Move out of direct light or glare" icon="sun.max" />
      ) : coach === 'blurry' ? (
        <FocusBanner top={insets.top + Space.xxl} steady={tier !== 'low'} />
      ) : (
        <CoachPill kind={coach} top={insets.top + Space.xxl} />
      )}

      {/* Close */}
      <Pressable
        hitSlop={12}
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + Space.sm }]}
        accessibilityRole="button"
        accessibilityLabel="Close camera">
        <Icon name="xmark" tintColor="#FFFFFF" size={22} />
      </Pressable>

      {/* Instructions */}
      <Pressable onPress={() => router.push('/scan/instructions')} style={styles.instructions} accessibilityRole="button">
        <ThemedText type="subhead" style={styles.instructionsLabel}>
          Instructions
        </ThemedText>
      </Pressable>

      {/* Zoom indicator */}
      <View style={styles.zoomWrap}>
        <GestureDetector gesture={zoomDrag}>
          {/* Padded so the 4pt bar has a real ~44pt touch target without looking heavier. */}
          <View
            style={styles.zoomHit}
            onLayout={(e) => {
              zoomTrackW.value = e.nativeEvent.layout.width;
            }}>
            <View style={styles.zoomTrack}>
              <Reanimated.View style={[styles.zoomFill, zoomBarStyle]} />
            </View>
            <Reanimated.View style={[styles.zoomKnob, zoomKnobStyle]} pointerEvents="none" />
          </View>
        </GestureDetector>
      </View>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Space.lg }]}>
        <Pressable
          hitSlop={12}
          onPress={() => setTorch((t) => !t)}
          style={styles.sideBtn}
          accessibilityRole="button"
          accessibilityLabel="Toggle flash">
          <Icon name={torch ? 'bolt.fill' : 'bolt.slash.fill'} tintColor="#FFFFFF" size={26} />
        </Pressable>

        {session.images.length > 0 ? (
          <View style={styles.shotCount} pointerEvents="none">
            <ThemedText type="caption" style={styles.shotCountText}>
              {session.images.length} of {MAX_IMAGES_PER_SCREENING}
            </ThemedText>
          </View>
        ) : null}
        <Pressable onPress={shoot} disabled={busy} style={styles.shutter} accessibilityRole="button" accessibilityLabel="Capture">
          <GradientBackground variant="sunsetVivid" start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.shutterFill} />
          <Icon name="camera.fill" tintColor="#FFFFFF" size={28} />
        </Pressable>

        <Pressable
          hitSlop={12}
          onPress={() => setAiCamera((v) => !v)}
          style={styles.sideBtn}
          accessibilityRole="button"
          accessibilityLabel="Toggle AI camera">
          <View style={[styles.toggle, aiCamera && styles.toggleOn]}>
            <View style={[styles.knob, aiCamera && styles.knobOn]} />
          </View>
          <ThemedText type="caption" style={styles.aiLabel}>
            AI camera
          </ThemedText>
        </Pressable>
      </View>

      <PerfHud
        counters={perf}
        // No explicit format any more — the OS picks per device, so there is nothing to print here
        // beyond the fact that we are not constraining it.
        formatLabel="device default (unconstrained)"
      />
    </View>
  );
}

const RETICLE = 76;

function FocusReticle({ x, y }: { x: number; y: number }) {
  const scale = useSharedValue(1.35);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(1, { duration: 180 });
    opacity.value = withSequence(withTiming(1, { duration: 110 }), withDelay(450, withTiming(0, { duration: 240 })));
  }, [scale, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[focusStyles.reticle, { left: x - RETICLE / 2, top: y - RETICLE / 2 }, style]}
    />
  );
}

/**
 * Compact, non-blocking "hold steady" banner. Unlike the full-screen too-dark coach, it leaves
 * the preview visible so the user can watch the shot come into focus.
 */
function FocusBanner({ top, steady }: { top: number; steady: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    // The pulse is decoration; on a device already missing its frame budget it is one more
    // thing competing for the UI thread while the user is trying to hold the phone still.
    if (steady) pulse.value = withRepeat(withTiming(0.55, { duration: 650 }), -1, true);
  }, [pulse, steady]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={[focusStyles.bannerWrap, { top }]} pointerEvents="none">
      <Reanimated.View style={[focusStyles.banner, style]}>
        <Icon name="camera.viewfinder" tintColor="#FFFFFF" size={18} />
        <ThemedText type="subhead" style={focusStyles.bannerText}>
          Hold steady to focus
        </ThemedText>
      </Reanimated.View>
    </View>
  );
}

/** The positional half of the coaching vocabulary — one message at a time. */

const COACH_COPY: Record<CoachKind, { text: string; icon: IconName }> = {
  search: { text: 'Point at the spot', icon: 'camera.viewfinder' },
  far: { text: 'Move closer', icon: 'camera.viewfinder' },
  close: { text: 'Move back a little', icon: 'camera.viewfinder' },
  offcenter: { text: 'Center the spot', icon: 'camera.viewfinder' },
  steady: { text: 'Hold steady…', icon: 'camera.viewfinder' },
  ready: { text: 'Looks good — tap to capture', icon: 'checkmark.circle.fill' },
};

/**
 * Compact positional coach. Neutral guidance (point/move/center) shows in a dark pill; the
 * "ready" state turns green to match the locked DetectionBox, signalling a good frame.
 */
function CoachPill({ kind, top }: { kind: CoachKind; top: number }) {
  const { text, icon } = COACH_COPY[kind];
  const ready = kind === 'ready';
  return (
    <View style={[focusStyles.bannerWrap, { top }]} pointerEvents="none">
      <View style={[coachStyles.pill, ready ? coachStyles.pillReady : coachStyles.pillNeutral]}>
        <Icon name={icon} tintColor="#FFFFFF" size={18} />
        <ThemedText type="subhead" style={focusStyles.bannerText}>
          {text}
        </ThemedText>
      </View>
    </View>
  );
}

const coachStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.sm,
    borderRadius: 999,
  },
  pillNeutral: { backgroundColor: 'rgba(20,16,13,0.6)' },
  pillReady: { backgroundColor: 'rgba(52,168,120,0.96)' }, // matches DetectionBox LOCKED green
});

const focusStyles = StyleSheet.create({
  reticle: {
    position: 'absolute',
    width: RETICLE,
    height: RETICLE,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#FFD7C0',
  },
  bannerWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(242,169,59,0.96)',
  },
  bannerText: { color: '#FFFFFF', fontWeight: '600' },
});

const BRACKET = 36;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  black: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: 'rgba(255,255,255,0.95)' },
  tl: { top: '24%', left: '12%', borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: '24%', right: '12%', borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: '34%', left: '12%', borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: '34%', right: '12%', borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  // Rides just inside the bracket frame's bottom edge (brackets end at bottom: '34%'), so it reads
  // as a label for the box rather than as another floating message.
  //
  // Do NOT move this lower to sit outside the frame: `instructions` is pinned at bottom 196 and is
  // ~34pt tall, so on a 667pt screen the bracket bottom (227) is already level with it — there is
  // no room below the frame on small devices. At 36% the clearance is +10pt on an SE and 60-100pt
  // on current phones. Re-check this arithmetic before changing either value.
  frameHint: {
    position: 'absolute',
    bottom: '36%',
    alignSelf: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(20,16,13,0.45)',
  },
  frameHintText: { color: 'rgba(255,255,255,0.92)' },
  close: { position: 'absolute', left: Space.lg, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  instructions: {
    position: 'absolute',
    bottom: 196,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(20,16,13,0.45)',
  },
  instructionsLabel: { color: '#FFFFFF' },
  /**
   * Above the Instructions pill (which stays at bottom 196 and runs to ~232), not below it.
   *
   * The band between the shutter row and that pill is only ~32pt once the multi-photo "N of 3"
   * counter is accounted for, and a slider needs a 44pt touch target — so sharing that strip is
   * what made the two fight in the first place. Sitting above the pill leaves the frame brackets
   * (which end ~290pt from the bottom) clear as well.
   */
  zoomWrap: { position: 'absolute', bottom: 240, left: 0, right: 0, alignItems: 'center' },
  zoomHit: { width: '62%', paddingVertical: ZOOM_PAD_V, justifyContent: 'center' },
  zoomTrack: {
    width: '100%',
    height: ZOOM_TRACK_H,
    borderRadius: ZOOM_TRACK_H / 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  zoomKnob: {
    position: 'absolute',
    // Seated ON the track, computed rather than percentage-positioned: `top: '50%'` resolves
    // against a height that only exists because of the padding above, which is fragile, and Yoga
    // does not reliably apply a parent's align/justify to absolute children. This lands the knob's
    // centre exactly on the track's centre line whatever the padding becomes.
    top: ZOOM_PAD_V + ZOOM_TRACK_H / 2 - ZOOM_KNOB / 2,
    width: ZOOM_KNOB,
    height: ZOOM_KNOB,
    marginLeft: -ZOOM_KNOB / 2, // re-centre on the point its percentage `left` resolves to
    borderRadius: ZOOM_KNOB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#FF8A4C',
    shadowColor: '#211A15',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  zoomFill: { height: ZOOM_TRACK_H, borderRadius: ZOOM_TRACK_H / 2, backgroundColor: '#FF8A4C' },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Space.xl,
  },
  sideBtn: { width: 64, alignItems: 'center', gap: 4 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  shutterFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  shotCount: {
    position: 'absolute',
    top: -34,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(20,16,13,0.55)',
  },
  shotCountText: { color: '#FFFFFF' },
  toggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.3)', padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#FF8A4C' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { alignSelf: 'flex-end' },
  aiLabel: { color: 'rgba(255,255,255,0.9)' },
  permission: { alignItems: 'center', paddingHorizontal: Space.xl, gap: Space.base },
  permTitle: { color: '#FFFFFF', textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  permBtn: { alignSelf: 'stretch', marginTop: Space.base },
  permCancel: { color: 'rgba(255,255,255,0.7)' },
});

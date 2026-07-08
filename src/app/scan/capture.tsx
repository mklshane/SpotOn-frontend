import { NitroModules } from 'react-native-nitro-modules';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, Vibration, View } from 'react-native';
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
import { useRunOnJS } from 'react-native-worklets-core';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { GradientBackground } from '@/components/ui/gradient-background';
import { CaptureCoach } from '@/components/scan/too-dark-overlay';
import { DetectionBox, type DetectionBBox } from '@/components/scan/detection-box';
import { getLesionModel, type LesionModel } from '@/lib/lesion-model';
import { makeOneEuro } from '@/lib/one-euro';
import { Space } from '@/constants/theme';

// Reanimated-animated camera so pinch-zoom writes to a shared value (no React re-renders, which
// would recreate the gesture mid-pinch and crash react-native-gesture-handler).
const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);
Reanimated.addWhitelistedNativeProps({ zoom: true });

// Confidence hysteresis: a high bar to *create* the box, a low bar to *keep* it — so it appears
// only when we're sure and doesn't flicker as the score hovers near a single threshold.
// CREATE_SCORE calibrated from the offline detector eval (SpotOn-synthetic/synth/eval/detector_eval):
// on real lesion anchors, dropping 0.35 -> 0.30 lifts detection recall ~0.69 -> ~0.72 with no
// added non-skin false positives (the IQA skin gate backstops non-skin). The same eval showed
// letterbox/stretch preprocessing does NOT beat the resize-plugin's center crop, so preprocessing
// is left unchanged. A triage capture should favour recall (rarely miss a lesion).
const CREATE_SCORE = 0.3; // score needed for the box to first appear (recall-favouring, eval-tuned)
const KEEP_SCORE = 0.28; // once shown, the box stays while the score holds above this
const FUSE_SCORE = 0.25; // anchors this confident (and near the best) are fused into the box
const LOCK_SCORE = 0.5; // above this the box is "locked" (green + eligible for the ready coach)
const DETECT_SHOW = 2; // consecutive qualifying frames before the box first appears
const KEEP_GRACE = 3; // extra frames the box survives detection misses before it drops
const STABLE_EPS = 0.01; // box move (fraction of screen) under this counts as "held still"
const STABLE_FRAMES = 5; // consecutive still frames before the framing is "stable" (good to shoot)
const BOX_PAD = 0.25; // grow the drawn green box this much around the lesion (breathing room)
const BOX_MAX = 0.98; // sanity cap: a bad frame can't blow the box up past the screen
// One-Euro filter params for the box (see lib/one-euro.ts). Low minCutoff = steady when still;
// beta adds responsiveness when the lesion actually moves. Tune on device.
const EURO_MIN_CUTOFF = 1.5;
const EURO_BETA = 0.05; // higher = snaps to real motion faster (less follow-lag), still smooth when still
const DEADBAND = 0.004; // ignore box moves smaller than this (fraction of screen) — no creep
// Coaching thresholds, in full-frame normalized units (box size = max(w,h); center offset).
const FAR_MAX = 0.14; // lesion smaller than this → "move closer"
const CLOSE_MIN = 0.72; // lesion larger than this → "move back"
const OFFSET_MAX = 0.25; // center further than this from frame center → "center the spot"
const DARK_THRESHOLD = 0.2; // mean luminance below which we coach "too dark"
const BRIGHT_THRESHOLD = 0.82; // mean luminance above which we coach "too bright"
const BLUR_THRESHOLD = 0.0004; // mean gradient energy below this = genuinely blurry (normal use ≥~0.001)
const BLUR_SHOW = 5; // consecutive blurry frames before coaching (avoids flicker on plain/brief frames)
const DEBUG = false; // set true to log [fp] best/sharp/lume for tuning

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const { width: SW, height: SH } = useWindowDimensions();

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
  const [tooDark, setTooDark] = useState(false);
  const [tooBright, setTooBright] = useState(false);
  const [tooBlurry, setTooBlurry] = useState(false);
  const [detection, setDetection] = useState<DetectionBBox | null>(null);
  // Full-frame box metrics (normalized) used for the positional coaching (distance/centering).
  // `stable` = the box has barely moved for STABLE_FRAMES, i.e. the framing is settled.
  const [frameMetrics, setFrameMetrics] = useState<
    { cx: number; cy: number; w: number; h: number; locked: boolean; stable: boolean } | null
  >(null);
  const [focusPt, setFocusPt] = useState<{ x: number; y: number; id: number } | null>(null);

  const maxZoom = Math.min(device?.maxZoom ?? 1, 8);
  const minZoom = device?.minZoom ?? 1;

  const zoomSV = useSharedValue(1);
  const startZoom = useSharedValue(1);
  useEffect(() => {
    if (device?.neutralZoom) zoomSV.value = device.neutralZoom;
  }, [device, zoomSV]);

  const detStreak = useRef(0);
  const activeRef = useRef(false); // whether a box is currently shown (drives confidence hysteresis)
  const stableStreak = useRef(0); // consecutive frames the box has held still
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
    activeRef.current = false;
    stableStreak.current = 0;
    setDetection(null);
    setFrameMetrics(null);
    lastCenter.current = null;
    lastSize.current = null;
    lastImgBox.current = null;
    // Forget filter history so re-acquiring snaps to the new box instead of gliding from the old.
    Object.values(euro).forEach((f) => f.reset());
  };
  const onDetection = useRunOnJS(
    (d: { p: DetectionBBox; cx: number; cy: number; iw: number; ih: number; score: number; locked: boolean } | null) => {
      // The worklet emits a box whenever score ≥ KEEP_SCORE. Confidence hysteresis lives here:
      // while inactive, a weak box (< CREATE_SCORE) can't build toward appearing; once active,
      // any emitted box (≥ KEEP_SCORE) sustains it, and it only drops after KEEP_GRACE misses.
      if (d) {
        if (!activeRef.current && d.score < CREATE_SCORE) {
          detStreak.current = Math.max(0, detStreak.current - 1);
          return;
        }
        detStreak.current = Math.min(DETECT_SHOW + KEEP_GRACE, detStreak.current + 1);
        if (!activeRef.current) {
          if (detStreak.current < DETECT_SHOW) return; // still acquiring — don't show a box yet
          activeRef.current = true;
        }

        const t = Date.now();
        const b = d.p;

        // Filter the preview box (center + size), then apply a deadband so tiny residual
        // movement doesn't make the box creep when the user is holding still.
        let fx = euro.px.filter(b.x + b.w / 2, t);
        let fy = euro.py.filter(b.y + b.h / 2, t);
        let fw = euro.pw.filter(b.w, t);
        let fh = euro.ph.filter(b.h, t);
        const prev = lastCenter.current;
        // Track how far the box moved this frame → "stable" once it holds still for a while.
        const moved = prev ? Math.max(Math.abs(fx - prev.x), Math.abs(fy - prev.y)) : 1;
        if (prev && Math.abs(fx - prev.x) < DEADBAND && Math.abs(fy - prev.y) < DEADBAND) {
          fx = prev.x;
          fy = prev.y;
        }
        const prevS = lastSize.current;
        if (prevS && Math.abs(fw - prevS.w) < DEADBAND * 1.5 && Math.abs(fh - prevS.h) < DEADBAND * 1.5) {
          fw = prevS.w;
          fh = prevS.h;
        }
        stableStreak.current = moved < STABLE_EPS ? stableStreak.current + 1 : 0;
        lastCenter.current = { x: fx, y: fy };
        lastSize.current = { w: fw, h: fh };
        setDetection({ x: fx - fw / 2, y: fy - fh / 2, w: fw, h: fh });

        // Filter the forward-to-crop box in full-frame coords (also feeds positional coaching).
        const icx = euro.ix.filter(d.cx, t);
        const icy = euro.iy.filter(d.cy, t);
        const iw = euro.iw.filter(d.iw, t);
        const ih = euro.ih.filter(d.ih, t);
        lastImgBox.current = { cx: icx, cy: icy, w: iw, h: ih };
        setFrameMetrics({
          cx: icx,
          cy: icy,
          w: iw,
          h: ih,
          locked: d.locked,
          stable: stableStreak.current >= STABLE_FRAMES,
        });
      } else {
        detStreak.current = Math.max(0, detStreak.current - 1);
        stableStreak.current = 0;
        if (detStreak.current === 0) clearTrack();
      }
    },
    [],
  );
  const onDark = useRunOnJS((d: boolean) => setTooDark(d), []);
  const onBright = useRunOnJS((b: boolean) => setTooBright(b), []);
  const blurStreak = useRef(0);
  const onBlur = useRunOnJS((b: boolean) => {
    if (b) {
      blurStreak.current = Math.min(BLUR_SHOW + 2, blurStreak.current + 1);
      if (blurStreak.current >= BLUR_SHOW) setTooBlurry(true);
    } else {
      blurStreak.current = 0;
      setTooBlurry(false);
    }
  }, []);
  const onDebug = useRunOnJS((msg: string) => console.log('[fp]', msg), []);

  // VisionCamera v4's worklet can't touch a Nitro HybridObject's native state, so box the
  // model (unbox inside the worklet) and read the output/input shapes here on the JS thread.
  const boxedModel = useMemo(() => (model != null ? NitroModules.box(model) : undefined), [model]);
  const layout = useMemo(() => {
    if (model == null) return null;
    const shape = model.outputs[0].shape; // [1, d1, d2]
    const d1 = shape[1];
    const d2 = shape[2];
    const chMajor = d1 < d2; // [1, channels, anchors]
    const channels = chMajor ? d1 : d2;
    const anchors = chMajor ? d2 : d1;
    const inShape = model.inputs[0].shape;
    const inputSize = inShape.length === 4 ? (inShape[3] === 3 ? inShape[1] : inShape[2]) : 640;
    return { chMajor, channels, anchors, numClasses: channels - 4, inputSize };
  }, [model]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (boxedModel == null || layout == null) return;
      runAtTargetFps(12, () => {
        'worklet';
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
        onDark(lume < DARK_THRESHOLD);
        onBright(lume > BRIGHT_THRESHOLD);
        // Only flag blur when the lighting is usable (not too dark or blown out) to focus on.
        onBlur(lume >= DARK_THRESHOLD && lume <= BRIGHT_THRESHOLD && sharp < BLUR_THRESHOLD);

        const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
        const outputs = tflite.runSync([inputBuffer as ArrayBuffer]);
        const out = new Float32Array(outputs[0]);
        const chMajor = layout.chMajor;
        const channels = layout.channels;
        const anchors = layout.anchors;
        const numClasses = layout.numClasses;

        // Pass 1 — argmax: find the single highest-scoring anchor and its box (center in
        // channels 0,1; w/h in channels 2,3, all normalized to the model input).
        let best = 0;
        let bcx = 0;
        let bcy = 0;
        let bbw = 0;
        let bbh = 0;
        for (let i = 0; i < anchors; i++) {
          let score = 0;
          for (let k = 0; k < numClasses; k++) {
            const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
            if (v > score) score = v;
          }
          if (score > best) {
            best = score;
            bcx = out[chMajor ? i : i * channels];
            bcy = out[chMajor ? anchors + i : i * channels + 1];
            bbw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            bbh = out[chMajor ? 3 * anchors + i : i * channels + 3];
          }
        }

        // Pass 2 — Weighted Boxes Fusion: a single argmax anchor flickers frame-to-frame (a
        // different anchor wins each frame), which makes the box jitter. Fuse all confident
        // anchors near the best one (confidence-weighted average of cx,cy,w,h) into one steady
        // box. The proximity gate keeps a second, distant lesion from being merged in.
        let cx = bcx;
        let cy = bcy;
        let bw = bbw;
        let bh = bbh;
        if (best >= KEEP_SCORE) {
          const gate = Math.max(bbw, bbh) * 0.5;
          let ws = 0;
          let sx = 0;
          let sy = 0;
          let sw = 0;
          let sh = 0;
          for (let i = 0; i < anchors; i++) {
            let score = 0;
            for (let k = 0; k < numClasses; k++) {
              const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
              if (v > score) score = v;
            }
            if (score < FUSE_SCORE) continue;
            const ax = out[chMajor ? i : i * channels];
            const ay = out[chMajor ? anchors + i : i * channels + 1];
            if (Math.abs(ax - bcx) > gate || Math.abs(ay - bcy) > gate) continue;
            const aw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            const ah = out[chMajor ? 3 * anchors + i : i * channels + 3];
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
          // Map the model box to the screen. The model input is a center 1:1 crop of the
          // upright frame (resize-plugin default), so first undo that crop to get full-frame
          // coords, then apply the preview's cover-crop.
          const Rw = Math.min(frame.width, frame.height); // upright frame width
          const Rh = Math.max(frame.width, frame.height); // upright frame height
          const fX = cx; // center x — square crop keeps full width
          const fY = ((Rh - Rw) / 2 + cy * Rw) / Rh; // center y — undo the vertical center crop
          const fW = bw; // box width — full width uncropped
          const fH = (bh * Rw) / Rh; // box height — bh is a fraction of the crop band (Rw)
          const sc = Math.max(SW / Rw, SH / Rh);
          const dispW = Rw * sc;
          const dispH = Rh * sc;
          const pcx = (fX * dispW - (dispW - SW) / 2) / SW;
          const pcy = (fY * dispH - (dispH - SH) / 2) / SH;
          // Draw the YOLO box with a little padding so the green frame sits around the lesion,
          // not right on its edge; cap the size so a bad frame can't blow it up past the screen.
          // (The img box below stays tight — the crop screen adds its own padding.)
          const w = Math.min(BOX_MAX, (fW * dispW * (1 + BOX_PAD)) / SW);
          const h = Math.min(BOX_MAX, (fH * dispH * (1 + BOX_PAD)) / SH);
          onDetection({
            p: { x: pcx - w / 2, y: pcy - h / 2, w, h },
            cx: fX,
            cy: fY,
            iw: fW,
            ih: fH,
            score: best,
            locked: best >= LOCK_SCORE,
          });
        } else {
          onDetection(null);
        }
      });
    },
    [boxedModel, layout, resize, onDetection, onDark, onBright, onBlur, onDebug],
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
      console.log('[focus] tap', Math.round(x), Math.round(y), 'supportsFocus=', device?.supportsFocus);
      if (!cam) return;
      setFocusPt({ x, y, id: Date.now() });
      cam
        .focus({ x, y })
        .then(() => console.log('[focus] ok'))
        .catch((e) => console.log('[focus] err', String(e)));
    },
    [device],
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

  // Positional coaching — one message at a time, and only when lighting/focus are already OK so
  // messages never stack. Narrows the user toward a good frame the way ID/document scanners do.
  const positionalCoach = useMemo<CoachKind | null>(() => {
    if (!aiCamera || tooDark || tooBright || tooBlurry) return null;
    if (!frameMetrics) return 'search';
    const size = Math.max(frameMetrics.w, frameMetrics.h);
    if (size < FAR_MAX) return 'far';
    if (size > CLOSE_MIN) return 'close';
    if (Math.abs(frameMetrics.cx - 0.5) > OFFSET_MAX || Math.abs(frameMetrics.cy - 0.5) > OFFSET_MAX) return 'offcenter';
    if (!frameMetrics.locked) return 'search';
    // Framing is good — only call it "ready" once the box has settled (stable for N frames).
    return frameMetrics.stable ? 'ready' : 'steady';
  }, [aiCamera, tooDark, tooBright, tooBlurry, frameMetrics]);

  // One haptic tick the moment the frame becomes good, so a well-framed shot feels earned.
  const wasReady = useRef(false);
  useEffect(() => {
    const ready = positionalCoach === 'ready';
    if (ready && !wasReady.current) Vibration.vibrate(10);
    wasReady.current = ready;
  }, [positionalCoach]);

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
      const upright = await manipulateAsync(raw, [{ rotate: 0 }], { compress: 0.95, format: SaveFormat.JPEG });
      // Carry the live detector's verdict + box forward. We can't re-run the model on the still
      // here — its interpreter is busy on the camera thread, and hitting it from JS crashes — so
      // the crop screen uses this box (full-frame normalized) to auto-frame the lesion.
      const box = lastImgBox.current;
      router.push({
        pathname: '/scan/crop',
        params: {
          uri: upright.uri,
          detected: detection != null ? '1' : '0',
          ...(box && detection != null
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
            isActive
            photo
            animatedProps={animatedProps}
            torch={torch ? 'on' : 'off'}
            frameProcessor={aiCamera ? frameProcessor : undefined}
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
      {aiCamera ? <DetectionBox bbox={detection} /> : null}

      {/* Hide the live coaches during capture — frames glitch dark/blurry as the shutter fires.
          Too-dark takes the full screen (you can't see anyway); blur is a compact banner so the
          preview stays visible and the user can watch it sharpen. */}
      {busy ? null : tooDark ? (
        <CaptureCoach title="It's too dark" subtitle="Turn on the light or move somewhere brighter" icon="sun.max" />
      ) : tooBright ? (
        <CaptureCoach title="It's too bright" subtitle="Move out of direct light or glare" icon="sun.max" />
      ) : tooBlurry ? (
        <FocusBanner top={insets.top + Space.xxl} />
      ) : positionalCoach ? (
        <CoachPill kind={positionalCoach} top={insets.top + Space.xxl} />
      ) : null}

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
      <View style={styles.zoomWrap} pointerEvents="none">
        <View style={styles.zoomTrack}>
          <Reanimated.View style={[styles.zoomFill, zoomBarStyle]} />
        </View>
        <ThemedText type="caption" style={styles.zoomLabel}>
          Zoom
        </ThemedText>
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
function FocusBanner({ top }: { top: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.55, { duration: 650 }), -1, true);
  }, [pulse]);
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

type CoachKind = 'search' | 'far' | 'close' | 'offcenter' | 'steady' | 'ready';
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
  zoomWrap: { position: 'absolute', bottom: 150, left: 0, right: 0, alignItems: 'center', gap: 6 },
  zoomTrack: { width: '60%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  zoomFill: { height: 4, borderRadius: 2, backgroundColor: '#FF8A4C' },
  zoomLabel: { color: 'rgba(255,255,255,0.9)' },
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

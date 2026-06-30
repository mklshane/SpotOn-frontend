import { loadTensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
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
import { Icon } from '@/components/ui/icon';
import { GradientBackground } from '@/components/ui/gradient-background';
import { TooDarkOverlay } from '@/components/scan/too-dark-overlay';
import { DetectionBox, type DetectionBBox } from '@/components/scan/detection-box';
import { Space } from '@/constants/theme';

const DETECT_SCORE = 0.32; // clean gap from logs: blank ≤~0.25, lesions ≥~0.34
const DETECT_SHOW = 2; // consecutive valid frames before showing (debounce)
const BOX_FRAC = 0.24; // displayed framing box side, as a fraction of screen width
const SMOOTH = 0.45; // EMA weight for the new center (lower = smoother/laggier)
const DARK_THRESHOLD = 0.2; // mean luminance below which we coach "too dark"
const DEBUG = false; // set true to log [fp] scores/coords for tuning

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const { width: SW, height: SH } = useWindowDimensions();

  const [model, setModel] = useState<Awaited<ReturnType<typeof loadTensorflowModel>> | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const src = Image.resolveAssetSource(require('../../../assets/models/itobos_plus_large_v2_float16.tflite'));
        let uri = src.uri;
        if (uri.startsWith('http')) {
          const dest = `${FileSystem.cacheDirectory}itobos_plus_large_v2_float16.tflite`;
          await FileSystem.downloadAsync(uri, dest);
          uri = dest;
        }
        const m = await loadTensorflowModel({ url: uri }, []);
        if (alive) setModel(m);
      } catch (e) {
        console.warn('[tflite] model load failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [torch, setTorch] = useState(false);
  const [aiCamera, setAiCamera] = useState(true);
  const [zoom, setZoom] = useState(device?.neutralZoom ?? 1);
  const [busy, setBusy] = useState(false);
  const [tooDark, setTooDark] = useState(false);
  const [detection, setDetection] = useState<DetectionBBox | null>(null);
  const startZoom = useSharedValue(1);

  const maxZoom = Math.min(device?.maxZoom ?? 1, 8);
  const minZoom = device?.minZoom ?? 1;

  const detStreak = useRef(0);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const onDetection = useRunOnJS((b: DetectionBBox | null) => {
    if (b) {
      detStreak.current = Math.min(DETECT_SHOW + 1, detStreak.current + 1);
      const cxn = b.x + b.w / 2;
      const cyn = b.y + b.h / 2;
      const prev = lastCenter.current;
      const sx = prev ? prev.x * (1 - SMOOTH) + cxn * SMOOTH : cxn;
      const sy = prev ? prev.y * (1 - SMOOTH) + cyn * SMOOTH : cyn;
      lastCenter.current = { x: sx, y: sy };
      if (detStreak.current >= DETECT_SHOW) setDetection({ x: sx - b.w / 2, y: sy - b.h / 2, w: b.w, h: b.h });
    } else {
      detStreak.current = Math.max(0, detStreak.current - 1);
      if (detStreak.current === 0) {
        setDetection(null);
        lastCenter.current = null;
      }
    }
  }, []);
  const onDark = useRunOnJS((d: boolean) => setTooDark(d), []);
  const setZoomJS = useRunOnJS((z: number) => setZoom(z), []);
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
      runAtTargetFps(8, () => {
        'worklet';
        const tflite = boxedModel.unbox();
        const input = resize(frame, {
          scale: { width: layout.inputSize, height: layout.inputSize },
          pixelFormat: 'rgb',
          dataType: 'float32',
          rotation: '90deg',
        });

        let sum = 0;
        let n = 0;
        for (let i = 0; i < input.length; i += 30) {
          sum += input[i];
          n++;
        }
        onDark(n > 0 && sum / n < DARK_THRESHOLD);

        const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
        const outputs = tflite.runSync([inputBuffer as ArrayBuffer]);
        const out = new Float32Array(outputs[0]);
        const chMajor = layout.chMajor;
        const channels = layout.channels;
        const anchors = layout.anchors;
        const numClasses = layout.numClasses;

        let best = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < anchors; i++) {
          let score = 0;
          for (let k = 0; k < numClasses; k++) {
            const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
            if (v > score) score = v;
          }
          if (score > best) {
            best = score;
            cx = out[chMajor ? i : i * channels];
            cy = out[chMajor ? anchors + i : i * channels + 1];
          }
        }

        if (best >= DETECT_SCORE) {
          // Map the lesion center to the screen. The model input is a center 1:1 crop of
          // the upright frame (resize-plugin default), so first undo that crop to get
          // full-frame coords, then apply the preview's cover-crop.
          const Rw = Math.min(frame.width, frame.height); // upright frame width
          const Rh = Math.max(frame.width, frame.height); // upright frame height
          const fX = cx; // square crop keeps full width
          const fY = ((Rh - Rw) / 2 + cy * Rw) / Rh; // undo the vertical center crop
          const sc = Math.max(SW / Rw, SH / Rh);
          const dispW = Rw * sc;
          const dispH = Rh * sc;
          const pcx = (fX * dispW - (dispW - SW) / 2) / SW;
          const pcy = (fY * dispH - (dispH - SH) / 2) / SH;
          const w = (BOX_FRAC * SW) / SW;
          const h = (BOX_FRAC * SW) / SH;
          if (DEBUG) onDebug('best=' + best.toFixed(2) + ' cx=' + cx.toFixed(2) + ' cy=' + cy.toFixed(2) + ' f=' + frame.width + 'x' + frame.height);
          onDetection({ x: pcx - w / 2, y: pcy - h / 2, w, h });
        } else {
          onDetection(null);
        }
      });
    },
    [boxedModel, layout, resize, onDetection, onDark, onDebug],
  );

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      startZoom.value = zoom;
    })
    .onUpdate((e) => {
      'worklet';
      const next = Math.min(maxZoom, Math.max(minZoom, startZoom.value * e.scale));
      setZoomJS(next);
    });

  async function shoot() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePhoto({ flash: torch ? 'on' : 'off' });
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      router.push({ pathname: '/scan/crop', params: { uri } });
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

  const zoomPct = Math.round(((zoom - minZoom) / Math.max(0.001, maxZoom - minZoom)) * 100);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pinch}>
        <View style={StyleSheet.absoluteFill}>
          <Camera
            ref={camera}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            photo
            zoom={zoom}
            torch={torch ? 'on' : 'off'}
            frameProcessor={aiCamera ? frameProcessor : undefined}
          />
        </View>
      </GestureDetector>

      {/* Framing brackets */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.bracket, styles.tl]} />
        <View style={[styles.bracket, styles.tr]} />
        <View style={[styles.bracket, styles.bl]} />
        <View style={[styles.bracket, styles.br]} />
      </View>

      {/* AI camera = live lesion detector; the box tracks the detected lesion. */}
      {aiCamera ? <DetectionBox bbox={detection} /> : null}

      {tooDark ? <TooDarkOverlay /> : null}

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
          <View style={[styles.zoomFill, { width: `${zoomPct}%` }]} />
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
  zoomTrack: { width: '60%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
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

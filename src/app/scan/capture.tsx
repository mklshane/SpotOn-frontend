import { loadTensorflowModel } from 'react-native-fast-tflite';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
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

const INPUT_SIZE = 640; // YOLOv8 export imgsz
const SCORE_THRESHOLD = 0.45;
const DARK_THRESHOLD = 0.2; // mean luminance (0..1) below which we coach "too dark"

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);

  const { resize } = useResizePlugin();

  // Load the model from a real local file. (Expo's dev Metro asset URL isn't fetchable
  // by fast-tflite's native AssetLoader, so we download it to cache and load via {url}.)
  const [model, setModel] = useState<Awaited<ReturnType<typeof loadTensorflowModel>> | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const src = Image.resolveAssetSource(require('../../../assets/models/yolo_best_float16.tflite'));
        let uri = src.uri;
        if (uri.startsWith('http')) {
          const dest = `${FileSystem.cacheDirectory}yolo_best_float16.tflite`;
          await FileSystem.downloadAsync(uri, dest);
          uri = dest;
        }
        const m = await loadTensorflowModel({ url: uri });
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

  const onDetection = useRunOnJS((b: DetectionBBox | null) => setDetection(b), []);
  const onDark = useRunOnJS((d: boolean) => setTooDark(d), []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (model == null) return;
      runAtTargetFps(5, () => {
        'worklet';
        const input = resize(frame, {
          scale: { width: INPUT_SIZE, height: INPUT_SIZE },
          pixelFormat: 'rgb',
          dataType: 'float32',
          rotation: '90deg',
        });

        // Mean luminance for the "too dark" coach (sample every 30th channel).
        let sum = 0;
        let n = 0;
        for (let i = 0; i < input.length; i += 30) {
          sum += input[i];
          n++;
        }
        onDark(n > 0 && sum / n < DARK_THRESHOLD);

        const outputs = model.runSync([input]);
        const out = outputs[0] as unknown as Float32Array;
        const shape = model.outputs[0].shape; // [1, d1, d2]
        const d1 = shape[1];
        const d2 = shape[2];
        const chMajor = d1 < d2; // [1, channels, anchors]
        const channels = chMajor ? d1 : d2;
        const anchors = chMajor ? d2 : d1;
        const numClasses = channels - 4;

        let best = 0;
        let cx = 0;
        let cy = 0;
        let bw = 0;
        let bh = 0;
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
            bw = out[chMajor ? 2 * anchors + i : i * channels + 2];
            bh = out[chMajor ? 3 * anchors + i : i * channels + 3];
          }
        }

        if (best >= SCORE_THRESHOLD) {
          // Ultralytics tflite coords are normalized 0..1; guard against pixel-space exports.
          if (cx > 1.5 || cy > 1.5) {
            cx /= INPUT_SIZE;
            cy /= INPUT_SIZE;
            bw /= INPUT_SIZE;
            bh /= INPUT_SIZE;
          }
          onDetection({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
        } else {
          onDetection(null);
        }
      });
    },
    [model, resize, onDetection, onDark],
  );

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      startZoom.value = zoom;
    })
    .onUpdate((e) => {
      'worklet';
      const next = Math.min(maxZoom, Math.max(minZoom, startZoom.value * e.scale));
      runOnJS(setZoom)(next);
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

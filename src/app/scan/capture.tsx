import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { GradientBackground } from '@/components/ui/gradient-background';
import { TooDarkOverlay } from '@/components/scan/too-dark-overlay';
import { Space } from '@/constants/theme';

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [torch, setTorch] = useState(false);
  const [aiCamera, setAiCamera] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [busy, setBusy] = useState(false);
  // TODO(ml): drive `tooDark` from vision-camera frame luminance once the ML camera lands.
  const [tooDark] = useState(false);
  const startZoom = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      startZoom.value = zoom;
    })
    .onUpdate((e) => {
      'worklet';
      const next = Math.min(1, Math.max(0, startZoom.value + (e.scale - 1) * 0.35));
      runOnJS(setZoom)(next);
    });

  async function shoot() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        router.push({ pathname: '/scan/crop', params: { uri: photo.uri } });
      }
    } finally {
      setBusy(false);
    }
  }

  // Permission gate.
  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.permission, { paddingTop: insets.top + Space.huge }]}>
        <ThemedText type="title2" style={styles.permTitle}>
          Camera access needed
        </ThemedText>
        <ThemedText type="body" style={styles.permBody}>
          SpotOn uses your camera to capture the skin spot for triage.
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

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pinch}>
        <View style={StyleSheet.absoluteFill}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={zoom} enableTorch={torch} />
        </View>
      </GestureDetector>

      {/* Framing brackets + focus square overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.bracket, styles.tl]} />
        <View style={[styles.bracket, styles.tr]} />
        <View style={[styles.bracket, styles.bl]} />
        <View style={[styles.bracket, styles.br]} />
        {/* AI camera = framing assist for now. TODO(ml): real AI auto-capture. */}
        {aiCamera ? (
          <View style={styles.focus}>
            <Icon name="plus" tintColor="rgba(255,255,255,0.9)" size={22} />
          </View>
        ) : null}
      </View>

      {/* "It's too dark" coaching (detection wired in the ML phase) */}
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
      <Pressable
        onPress={() => router.push('/scan/instructions')}
        style={styles.instructions}
        accessibilityRole="button">
        <ThemedText type="subhead" style={styles.instructionsLabel}>
          Instructions
        </ThemedText>
      </Pressable>

      {/* Zoom indicator */}
      <View style={styles.zoomWrap} pointerEvents="none">
        <View style={styles.zoomTrack}>
          <View style={[styles.zoomFill, { width: `${Math.round(zoom * 100)}%` }]} />
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
const FOCUS = 96;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  black: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bracket: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  tl: { top: '24%', left: '12%', borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: '24%', right: '12%', borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: '34%', left: '12%', borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: '34%', right: '12%', borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  focus: {
    width: FOCUS,
    height: FOCUS,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#34A878',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  close: {
    position: 'absolute',
    left: Space.lg,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.3)',
    padding: 3,
    justifyContent: 'center',
  },
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

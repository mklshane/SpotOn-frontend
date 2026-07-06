import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Space } from '@/constants/theme';

const OUTPUT = 1024;
const CROP_PAD = 0.3; // padding around the detected lesion when auto-framing the crop
const CROP_MIN_FRAC = 0.3; // smallest auto-crop side, as a fraction of the image's short side

export default function CropScreen() {
  const { uri, detected, lx, ly, lw, lh } = useLocalSearchParams<{
    uri: string;
    detected?: string;
    lx?: string;
    ly?: string;
    lw?: string;
    lh?: string;
  }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const frame = width - Space.xl * 2;
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  useEffect(() => {
    if (!uri) return;
    RNImage.getSize(uri, (w, h) => setImg({ w, h }));
  }, [uri]);

  // Cover scale: shorter side fills the frame.
  const s0 = img ? frame / Math.min(img.w, img.h) : 1;
  const displayW = img ? img.w * s0 : frame;
  const displayH = img ? img.h * s0 : frame;

  // Auto-frame: pre-position the crop square to hug the lesion the live detector found (box is
  // carried from capture as full-frame normalized params). The user can still pan/pinch to
  // adjust. Falls back to the centered default when there's no box (e.g. no live detection).
  useEffect(() => {
    if (!img) return;
    const cx = parseFloat(lx ?? '');
    const cy = parseFloat(ly ?? '');
    const bw = parseFloat(lw ?? '');
    const bh = parseFloat(lh ?? '');
    if (![cx, cy, bw, bh].every(Number.isFinite)) return;

    const { w: IW, h: IH } = img;
    const shortSide = Math.min(IW, IH);
    const lesionPx = Math.max(bw * IW, bh * IH);
    // Desired crop side in source pixels: lesion + padding, floored and capped to the square.
    const cropSide = Math.min(shortSide, Math.max(shortSide * CROP_MIN_FRAC, lesionPx * (1 + CROP_PAD)));
    const s0local = frame / shortSide;
    const scv = Math.min(4, shortSide / cropSide); // pinch caps zoom at 4x
    const eff = s0local * scv;
    // What confirm() will actually crop (mirrors its cropSize math) — keep centers consistent.
    const actualCrop = Math.min(shortSide, frame / eff);
    const half = actualCrop / 2;
    const cxPx = Math.min(IW - half, Math.max(half, cx * IW));
    const cyPx = Math.min(IH - half, Math.max(half, cy * IH));
    scale.value = scv;
    tx.value = (IW / 2 - cxPx) * eff;
    ty.value = (IH / 2 - cyPx) * eff;
  }, [img, lx, ly, lw, lh, frame, scale, tx, ty]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      'worklet';
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(4, Math.max(1, startScale.value * e.scale));
    });

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  async function confirm() {
    if (!uri || !img || busy) return;
    setBusy(true);
    try {
      const effective = s0 * scale.value;
      const cropSize = Math.min(img.w, img.h, frame / effective);
      const srcCenterX = img.w / 2 - tx.value / effective;
      const srcCenterY = img.h / 2 - ty.value / effective;
      const originX = Math.min(Math.max(0, srcCenterX - cropSize / 2), img.w - cropSize);
      const originY = Math.min(Math.max(0, srcCenterY - cropSize / 2), img.h - cropSize);

      const result = await manipulateAsync(
        uri,
        [
          { crop: { originX, originY, width: cropSize, height: cropSize } },
          { resize: { width: OUTPUT, height: OUTPUT } },
        ],
        { compress: 0.9, format: SaveFormat.JPEG },
      );
      // Hand off to the image-quality gate; it records the entry on pass / "use anyway".
      router.replace({ pathname: '/scan/quality', params: { uri: result.uri, detected } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Retake">
          <Icon name="arrow.counterclockwise" tintColor="#FFFFFF" size={22} />
        </Pressable>
        <ThemedText type="headline" style={styles.title}>
          Position the spot
        </ThemedText>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.frameWrap}>
        <View style={[styles.frame, { width: frame, height: frame }]}>
          {img ? (
            <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
              <Animated.View style={[styles.imgWrap, imgStyle]}>
                <Image source={{ uri }} style={{ width: displayW, height: displayH }} contentFit="cover" />
              </Animated.View>
            </GestureDetector>
          ) : null}

          {/* Center target — where the lesion should sit */}
          <View style={styles.centerGuide} pointerEvents="none">
            <View style={styles.centerRing} />
            <View style={styles.crossH} />
            <View style={styles.crossV} />
          </View>
        </View>
        <ThemedText type="footnote" style={styles.hint}>
          Center the spot in the circle
        </ThemedText>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.lg }]}>
        <Button label="Use photo" variant="brand" loading={busy} onPress={confirm} />
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.retake}>
          <ThemedText type="headline" style={styles.retakeText}>
            Retake
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A1411' },
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: '#FFFFFF' },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.lg },
  frame: {
    borderRadius: Space.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imgWrap: { alignItems: 'center', justifyContent: 'center' },
  centerGuide: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRing: {
    width: '44%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  crossH: { position: 'absolute', width: 16, height: 1.5, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  crossV: { position: 'absolute', width: 1.5, height: 16, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  hint: { color: 'rgba(255,255,255,0.7)' },
  footer: { paddingHorizontal: Space.xl, gap: Space.md, alignItems: 'center' },
  retake: { paddingVertical: Space.sm },
  retakeText: { color: 'rgba(255,255,255,0.85)' },
});

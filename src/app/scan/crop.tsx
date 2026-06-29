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
import { useScanDraft } from '@/lib/scan-draft';
import { useScanHistory } from '@/lib/scan-history';

const OUTPUT = 1024;

export default function CropScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { bodyMark, reset } = useScanDraft();
  const { addEntry } = useScanHistory();

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
      // Record the screening in history so it appears on the body-lesions map.
      if (bodyMark) addEntry({ mark: bodyMark, imageUri: result.uri });
      reset();
      router.replace('/(tabs)/home');
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
        </View>
        <ThemedText type="footnote" style={styles.hint}>
          Drag and pinch to center the spot
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
  hint: { color: 'rgba(255,255,255,0.7)' },
  footer: { paddingHorizontal: Space.xl, gap: Space.md, alignItems: 'center' },
  retake: { paddingVertical: Space.sm },
  retakeText: { color: 'rgba(255,255,255,0.85)' },
});

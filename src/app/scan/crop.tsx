import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Colors, Space } from '@/constants/theme';
import { LESION_TARGET_FILL } from '@/lib/classifier/model-config';
import { locateLesionInImage } from '@/lib/classifier/preprocess';

const OUTPUT = 1024;
const CROP_PAD = 0.3; // padding around the detected lesion when auto-framing the crop
const CROP_MIN_FRAC = 0.3; // smallest auto-crop side, as a fraction of the image's short side
// The guide circle's diameter as a fraction of the crop frame == the lesion-fill the classifier is
// most reliable on. Fill this ring with the spot and the resulting crop lands in the model's stable
// band. Single source of truth in model-config so the guide and the auto-refinement never drift.
const GUIDE_PCT = `${Math.round(LESION_TARGET_FILL * 100)}%` as `${number}%`;

export default function CropScreen() {
  const { uri, detected, source, lx, ly, lw, lh } = useLocalSearchParams<{
    uri: string;
    detected?: string;
    source?: string;
    lx?: string;
    ly?: string;
    lw?: string;
    lh?: string;
  }>();
  const fromGallery = source === 'gallery';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const frame = width - Space.xl * 2;
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Auto-framing is a one-shot on open — never re-run and yank the view out from under the user.
  const preframed = useRef(false);

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

  // Auto-frame for uploads: there's no live detector box, so find the lesion in the photo itself
  // (same dark-blob localizer the classifier's zoom refinement uses) and open the crop already
  // zoomed to the target fill — the spot lands inside the guide ring instead of the user having to
  // pinch it there. Best-effort: if no confident blob is found we leave the centered default.
  // Skipped entirely when the camera handed us a box, which the effect above already used.
  useEffect(() => {
    if (!img || !uri || preframed.current) return;
    const hasDetectorBox = [lx, ly, lw, lh]
      .map((v) => parseFloat(v ?? ''))
      .every(Number.isFinite);
    if (hasDetectorBox) return;

    // NB: the ref is set only once the transform is actually applied, never up-front. `frame`
    // comes from useWindowDimensions, which commonly updates just after mount on iOS — marking
    // early meant that re-render cancelled the in-flight localization and the retry then bailed on
    // the ref, so the preframe silently never happened. Letting the re-run retry is the fix.
    let alive = true;
    locateLesionInImage(uri, { targetFill: LESION_TARGET_FILL })
      .then((box) => {
        if (!alive || !box || preframed.current) return;
        preframed.current = true;
        const { w: IW, h: IH } = img;
        const shortSide = Math.min(IW, IH);
        // box.cx/cy/half are fractions of the short edge, so they scale straight to source pixels.
        const wanted = box.half * 2 * shortSide;
        const cropSide = Math.min(shortSide, Math.max(shortSide * CROP_MIN_FRAC, wanted));
        const s0local = frame / shortSide;
        const scv = Math.min(4, shortSide / cropSide); // pinch caps zoom at 4x
        const eff = s0local * scv;
        // Mirror confirm()'s cropSize math so the preview and the actual crop stay centred alike.
        const actualCrop = Math.min(shortSide, frame / eff);
        const half = actualCrop / 2;
        const cxPx = Math.min(IW - half, Math.max(half, box.cx * shortSide));
        const cyPx = Math.min(IH - half, Math.max(half, box.cy * shortSide));
        scale.value = scv;
        tx.value = (IW / 2 - cxPx) * eff;
        ty.value = (IH / 2 - cyPx) * eff;
      })
      .catch(() => {}); // localization is a convenience; a failure just leaves the default framing
    return () => {
      alive = false;
    };
  }, [img, uri, lx, ly, lw, lh, frame, scale, tx, ty]);

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
        // compress 1.0, not 0.9: the sensor JPEG is already lossy at 0.92, so re-encoding at 0.9
        // here put the classifier's input through a SECOND lossy pass. Two rounds of JPEG smear
        // exactly the fine texture the model reads, and at 1024² the file-size saving is trivial.
        { compress: 1, format: SaveFormat.JPEG },
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
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={fromGallery ? 'Choose another photo' : 'Retake'}>
          <Icon name={fromGallery ? 'photo.on.rectangle' : 'arrow.counterclockwise'} tintColor="#FFFFFF" size={22} />
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

          {/* Framing target: fill this circle with the spot. Its diameter is the lesion-fill the
              classifier reads most reliably, so "fill the circle" == "zoom to the right amount". */}
          <View style={styles.centerGuide} pointerEvents="none">
            <View style={[styles.targetRing, { width: GUIDE_PCT }]}>
              <View style={[styles.tick, styles.tickTop]} />
              <View style={[styles.tick, styles.tickBottom]} />
              <View style={[styles.tick, styles.tickLeft]} />
              <View style={[styles.tick, styles.tickRight]} />
            </View>
            <View style={styles.centerDot} />
          </View>
        </View>
        <ThemedText type="footnote" style={styles.hint}>
          Zoom so the spot fills the circle
        </ThemedText>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.lg }]}>
        <Button label="Use photo" variant="brand" loading={busy} onPress={confirm} />
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.retake}>
          <ThemedText type="headline" style={styles.retakeText}>
            {fromGallery ? 'Choose another' : 'Retake'}
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
  targetRing: {
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: Colors.light.brand,
    alignItems: 'center',
    justifyContent: 'center',
    // Soft brand glow so the ring reads as the target against a busy photo.
    shadowColor: Colors.light.brand,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  // N/E/S/W ticks turn the ring into a framing reticle (medical-precise, not a plain circle).
  tick: { position: 'absolute', backgroundColor: Colors.light.brand, borderRadius: 1 },
  tickTop: { top: -5, width: 2, height: 8 },
  tickBottom: { bottom: -5, width: 2, height: 8 },
  tickLeft: { left: -5, width: 8, height: 2 },
  tickRight: { right: -5, width: 8, height: 2 },
  centerDot: { position: 'absolute', width: 5, height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)' },
  hint: { color: 'rgba(255,255,255,0.75)' },
  footer: { paddingHorizontal: Space.xl, gap: Space.md, alignItems: 'center' },
  retake: { paddingVertical: Space.sm },
  retakeText: { color: 'rgba(255,255,255,0.85)' },
});

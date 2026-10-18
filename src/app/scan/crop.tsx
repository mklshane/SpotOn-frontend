import { t, useLocale } from '@/lib/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSurfaceWidth } from '@/hooks/use-surface-width';
import { releaseBlobUri } from '@/lib/blob-uri';
import { isDebug } from '@/lib/debug-flag';
import { transformToUri } from '@/lib/image-ops';
import { perfLog, perfSince } from '@/lib/perf-log';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Space } from '@/constants/theme';
import { cropSideForLesion, type Framing, framingFor } from '@/lib/classifier/candidate-core';
import { findLesionCandidates, lastSpotSearchReport, type LesionCandidate } from '@/lib/classifier/lesion-candidates';
import { LESION_TARGET_FILL } from '@/lib/classifier/model-config';
import { rememberUpscale } from '@/lib/capture-upscale';
import { discardScratch } from '@/lib/scratch-files';
import { StatusBar } from 'expo-status-bar';
import { TourTarget } from '@/lib/product-tour';
import { useScanTips } from '@/lib/scan-tips';

const OUTPUT = 1024;
/** Same long-edge cap capture.tsx bakes camera stills to (PHOTO_LONG_EDGE). */
const GALLERY_LONG_EDGE = 2048;
const CROP_PAD = 0.3; // padding around the detected lesion when auto-framing the crop
const CROP_MIN_FRAC = 0.3; // smallest auto-crop side, as a fraction of the image's short side
// The guide circle's diameter as a fraction of the crop frame, and the fill the upload auto-frame
// zooms to - one constant so the ring and the auto-frame can never disagree. Sits inside (not at
// the middle of) the classifier's stable band: this is a viewfinder a person reads, so it is
// framed wider than the inference-only REFINE_TARGET_FILL. See model-config for why they differ.
const GUIDE_PCT = `${Math.round(LESION_TARGET_FILL * 100)}%` as `${number}%`;
const MAX_ZOOM = 4; // the pinch limit
/** Give up on the spot search after this long (e.g. a slow first model load) and frame as before. */
const FIND_TIMEOUT_MS = 8000;
/** Tallest the picker's photo may be, relative to the frame width. */
const PICK_MAX_ASPECT = 1.5;
/** Picker close-up thumbnail side, and room reserved for its heading and thumbnail strip. */
const THUMB = 64;
const PICK_CHROME = 190;
const BADGE = 22;

/**
 * Ring geometry for the picker, with each number badge on whichever corner of its ring does not
 * collide with a badge already placed (two rings on neighbouring spots stacked their badges).
 */
function placeRings(spots: readonly LesionCandidate[], W: number, H: number) {
  const corners = [
    { dx: 1, dy: -1 }, // top-right
    { dx: -1, dy: -1 }, // top-left
    { dx: 1, dy: 1 }, // bottom-right
    { dx: -1, dy: 1 }, // bottom-left
  ];
  const placed: { x: number; y: number }[] = [];
  return spots.map((c) => {
    // Ring a little wider than the lesion box, never under the 44 pt tap target.
    const d = Math.max(44, Math.max(c.bw * W, c.bh * H) * 1.35);
    const cx = c.cx * W;
    const cy = c.cy * H;
    const off = d * 0.36; // a badge sits on the ring, about 45 degrees round from the centre
    const score = ({ dx, dy }: { dx: number; dy: number }) => {
      const x = cx + dx * off;
      const y = cy + dy * off;
      const clash = placed.some((p) => Math.abs(p.x - x) < BADGE && Math.abs(p.y - y) < BADGE) ? 100 : 0;
      const outside = x < BADGE / 2 || x > W - BADGE / 2 || y < BADGE / 2 || y > H - BADGE / 2 ? 10 : 0;
      return clash + outside;
    };
    const best = corners.reduce((a, b) => (score(b) < score(a) ? b : a));
    const bx = cx + best.dx * off;
    const by = cy + best.dy * off;
    placed.push({ x: bx, y: by });
    return {
      d,
      left: cx - d / 2,
      top: cy - d / 2,
      badge: { left: bx - (cx - d / 2) - BADGE / 2, top: by - (cy - d / 2) - BADGE / 2 },
    };
  });
}

/**
 * Uploads open in one of three modes:
 *  - finding: looking for lesions in the photo (lesion-candidates.ts);
 *  - pick:    it found two or more, and the user taps the one to check;
 *  - frame:   the usual pan/pinch viewfinder.
 * Camera shots go straight to frame - the live detector already chose the spot.
 */
type Mode = 'finding' | 'pick' | 'frame';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export default function CropScreen() {
  useLocale();
  const { uri: paramUri, source, lx, ly, lw, lh, w: pw, h: ph } = useLocalSearchParams<{
    uri: string;
    w?: string;
    h?: string;
    detected?: string;
    source?: string;
    lx?: string;
    ly?: string;
    lw?: string;
    lh?: string;
  }>();
  const fromGallery = source === 'gallery';
  // A box from the live camera detector, as full-frame normalized params.
  const hasDetectorBox = [lx, ly, lw, lh].map((v) => parseFloat(v ?? '')).every(Number.isFinite);

  // Android gallery photos: Image.getSize measures a DOWNSCALED decode of a large file (a 3000x4000
  // Samsung photo reports 1500x2000), while expo-image-manipulator crops the full-size pixels. Every
  // crop coordinate was therefore computed at half scale and the export landed up-and-left of the
  // lesion framed in the ring - on bare skin (2026-09-27, Galaxy A42). Normalize the upload through
  // the manipulator to the camera path's long edge and take the dimensions from ITS output, so the
  // numbers the crop maths uses and the pixels it cuts are the same by construction.
  const normalizeGallery = Platform.OS === 'android' && fromGallery;
  const [prepared, setPrepared] = useState<{ uri: string; w: number; h: number } | null>(null);
  const uri = normalizeGallery ? prepared?.uri ?? null : paramUri;
  const width = useSurfaceWidth();
  const insets = useSafeAreaInsets();

  const frame = width - Space.xl * 2;
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Auto-framing is a one-shot on open - never re-run and yank the view out from under the user.
  const preframed = useRef(false);
  const [mode, setMode] = useState<Mode>(fromGallery && !hasDetectorBox ? 'finding' : 'frame');
  // Not in the multi-spot picker or while spots are still being found: the ring isn't up yet.
  useScanTips('crop', { enabled: mode === 'frame' && Boolean(img) });
  // An upload with several spots opens on the picker, which gets its own tips.
  useScanTips('cropPick', { enabled: mode === 'pick' && Boolean(img) });
  // Lesions found in an upload (most confident first). Two or more → the picker.
  const [spots, setSpots] = useState<LesionCandidate[]>([]);
  const [wrapH, setWrapH] = useState(0);
  // The spot the picker will check. Defaults to the most likely one (spots are sorted by confidence),
  // so the primary button works straight away; tapping a ring or a thumbnail changes it.
  const [selected, setSelected] = useState(0);
  // Hidden diagnostics: long-press the header to show the last spot search's timings and scores.
  const [showReport, setShowReport] = useState(false);
  // The search outlives several renders; it reads the frame size at the moment it frames.
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  // Pixel dimensions: the sender's (capture.tsx passes the manipulator's) when given, since
  // Image.getSize measures a downscaled decode of large files on Android.
  const givenW = Number(pw);
  const givenH = Number(ph);
  const hasGivenSize = givenW > 0 && givenH > 0;
  useEffect(() => {
    if (!uri || normalizeGallery) return;
    if (hasGivenSize) {
      setImg({ w: givenW, h: givenH }); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    RNImage.getSize(uri, (w, h) => setImg({ w, h }));
  }, [uri, normalizeGallery, hasGivenSize, givenW, givenH]);

  useEffect(() => {
    if (!normalizeGallery || !paramUri) return;
    let alive = true;
    const prepare = (actions: Parameters<typeof transformToUri>[1]) =>
      transformToUri(paramUri, actions).then((out) => {
        if (!alive) {
          void discardScratch(out.uri);
          return;
        }
        setPrepared({ uri: out.uri, w: out.width, h: out.height });
        setImg({ w: out.width, h: out.height });
      });
    // getSize is only trusted for the aspect ratio here, never for pixel coordinates.
    RNImage.getSize(
      paramUri,
      (w, h) => {
        const resize = Math.max(w, h) >= GALLERY_LONG_EDGE / 2
          ? [{ resize: w >= h ? { width: GALLERY_LONG_EDGE } : { height: GALLERY_LONG_EDGE } }]
          : [];
        prepare(resize).catch((e) => console.warn('[crop] gallery normalize failed', e));
      },
      () => prepare([]).catch((e) => console.warn('[crop] gallery normalize failed', e)),
    );
    return () => {
      alive = false;
    };
  }, [normalizeGallery, paramUri]);

  // Android: load the quality screen's models while the user is framing the crop, so that screen's
  // checks are not queued behind a 1-3 s model load. Both getters cache, so quality.tsx's own
  // warm-up becomes a no-op. iOS loads fast enough that its timing is left as it was.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    import('@/lib/skin-gate')
      .then((m) => m.getSkinGateModel())
      .catch((e) => console.warn('[crop] skin gate warm-up failed', e));
    import('@/lib/classifier/classifier-model')
      .then((m) => m.getClassifierModel())
      .catch((e) => console.warn('[crop] classifier warm-up failed', e));
  }, []);

  // Cover scale: shorter side fills the frame.
  const s0 = img ? frame / Math.min(img.w, img.h) : 1;
  const displayW = img ? img.w * s0 : frame;
  const displayH = img ? img.h * s0 : frame;

  const applyFraming = (f: Framing, animate: boolean) => {
    if (animate) {
      const cfg = { duration: 280, easing: Easing.out(Easing.cubic) };
      scale.value = withTiming(f.scale, cfg);
      tx.value = withTiming(f.tx, cfg);
      ty.value = withTiming(f.ty, cfg);
    } else {
      scale.value = f.scale;
      tx.value = f.tx;
      ty.value = f.ty;
    }
  };

  // Frame a found spot so the WHOLE lesion shows: its box sits at the guide ring's fill, never
  // tighter (framingFor only ever widens the crop for the minimum size and the zoom cap).
  const frameOnSpot = (c: LesionCandidate, animate: boolean) => {
    if (!img) return;
    applyFraming(
      framingFor({
        imageW: img.w,
        imageH: img.h,
        frame: frameRef.current,
        cx: c.cx * img.w,
        cy: c.cy * img.h,
        cropSide: cropSideForLesion(c, img.w, img.h, LESION_TARGET_FILL),
        minFrac: CROP_MIN_FRAC,
        maxZoom: MAX_ZOOM,
      }),
      animate,
    );
  };

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
    const f = framingFor({
      imageW: img.w,
      imageH: img.h,
      frame,
      cx: cx * img.w,
      cy: cy * img.h,
      // Desired crop side in source pixels: lesion + padding.
      cropSide: Math.max(bw * img.w, bh * img.h) * (1 + CROP_PAD),
      minFrac: CROP_MIN_FRAC,
      maxZoom: MAX_ZOOM,
    });
    scale.value = f.scale;
    tx.value = f.tx;
    ty.value = f.ty;
  }, [img, lx, ly, lw, lh, frame, scale, tx, ty]);

  // Auto-frame for uploads: there's no live detector box, so find the lesions in the photo itself.
  //  - two or more → the picker, so the user chooses which one (a photo of a face or a back holds
  //    several, and zooming to whichever looked most central was a coin toss - on a face it was an
  //    eye);
  //  - exactly one → open framed on it;
  //  - none → the detector's box on the whole photo when it is confident, else the whole photo
  //    unzoomed; the search failing or timing out → unzoomed.
  // Skipped entirely when the camera handed us a box, which the effect above already used, and for
  // every camera shot without one: no live detection means there is no spot to zoom to, and the
  // blob finder would otherwise lock onto whatever dark feature it finds (keyboard keys, a sleeve
  // edge) and open the crop zoomed onto it.
  useEffect(() => {
    if (!fromGallery || !img || !uri || preframed.current || hasDetectorBox) return;

    // NB: the ref is set only once a result is actually applied, never up-front, so a re-run (a new
    // `img` or `uri`) can retry. `frame` is read through frameRef rather than being a dependency:
    // it commonly updates just after mount on iOS, and restarting a ~1 s search for that would only
    // queue duplicate detector work.
    let alive = true;
    // Nothing found, or the search failed: open UNZOOMED rather than guess. The old dark-blob
    // auto-zoom used to run here and zoomed onto the core of a large crusted lesion (seen on an
    // iPhone) - a crop that cuts the lesion off is worse than one the user zooms in on.
    const noZoom = () => {
      if (!alive || preframed.current) return;
      preframed.current = true;
      setMode('frame');
    };

    withTimeout(findLesionCandidates(uri, img), FIND_TIMEOUT_MS)
      .then(({ spots: found, fallback }) => {
        if (!alive || preframed.current) return;
        if (found.length === 0) {
          // A close-up of a lesion the verifier would not confirm: the detector's box on the whole
          // photo (the kind of picture it was trained on) frames the whole lesion.
          if (fallback) frameOnSpot(fallback, false);
          return noZoom();
        }
        preframed.current = true;
        setSpots(found);
        setSelected(0);
        if (found.length === 1) frameOnSpot(found[0], false);
        setMode(found.length >= 2 ? 'pick' : 'frame');
      })
      .catch((e) => {
        if (isDebug()) console.warn('[crop] spot search failed', e);
        noZoom();
      });
    return () => {
      alive = false;
    };
    // applyFraming/frameOnSpot only touch shared values and frameRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromGallery, img, uri, hasDetectorBox]);

  const pickSpot = (c: LesionCandidate) => {
    frameOnSpot(c, true);
    setMode('frame');
  };

  const positionMyself = () => {
    applyFraming({ scale: 1, tx: 0, ty: 0 }, true);
    setMode('frame');
  };

  const canReturnToSpots = mode === 'frame' && spots.length >= 2;
  const returnToSpots = () => setMode('pick');

  const pan = Gesture.Pan()
    .enabled(mode === 'frame')
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
    .enabled(mode === 'frame')
    .onBegin(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(MAX_ZOOM, Math.max(1, startScale.value * e.scale));
    });

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  async function confirm() {
    if (!uri || !img || busy || mode !== 'frame') return;
    setBusy(true);
    try {
      const effective = s0 * scale.value;
      const cropSize = Math.min(img.w, img.h, frame / effective);
      const srcCenterX = img.w / 2 - tx.value / effective;
      const srcCenterY = img.h / 2 - ty.value / effective;
      const originX = Math.min(Math.max(0, srcCenterX - cropSize / 2), img.w - cropSize);
      const originY = Math.min(Math.max(0, srcCenterY - cropSize / 2), img.h - cropSize);

      // Via image-ops so the web build uses the browser's downscaler rather than
      // expo-image-manipulator's JS Hermite filter, which softened this crop enough to fail the
      // blur gate (edgeWidth 19.6 against a limit of 14) on photos a phone accepts. This is the
      // image everything downstream measures - the gate reads it directly, and the classifier and
      // detector resample from it - so it is the one that has to be right. Quality is 1.0, not
      // 0.9: the sensor JPEG is already lossy at 0.92, and a second lossy pass smears exactly the
      // fine texture the model reads.
      if (isDebug()) {
        // Is this a downscale or an upscale? An auto-zoom that crops tight and enlarges to
        // OUTPUT cannot invent detail, and the blur gate will (correctly) call it soft.
        console.log(
          '[crop]', 'src=' + img.w + 'x' + img.h,
          'cropSize=' + Math.round(cropSize),
          'output=' + OUTPUT,
          'scale=' + (OUTPUT / cropSize).toFixed(2) + 'x',
        );
      }
      const tExport = Date.now();
      const result = await transformToUri(uri, [
        { crop: { originX, originY, width: cropSize, height: cropSize } },
        { resize: { width: OUTPUT, height: OUTPUT } },
      ]);
      perfLog('crop.export', Date.now() - tExport, `${result.width}x${result.height}`);
      // The source is dead once the crop exists: every route in here arrives by push/replace and
      // leaves by the replace below, so this screen is off the stack and no back-nav can want it
      // again. Camera sources are the upright temp from capture; gallery sources are ImagePicker's
      // own cache copy, not the library original. discardScratch ignores anything that is neither.
      await discardScratch(uri);
      if (paramUri && paramUri !== uri) await discardScratch(paramUri);
      // On web the source is a blob: URL (ImagePicker, or the canvas capture) that discardScratch
      // cannot touch. The crop supersedes it, so release it rather than holding the decoded frame
      // for the life of the page.
      releaseBlobUri(uri);
      // >1 when the auto-zoom had to enlarge to reach OUTPUT. Diagnostics only (the [iqa] debug
      // line) - the blur gate stopped dividing by it 2026-09-19.
      rememberUpscale(result.uri, Math.max(1, OUTPUT / cropSize));
      // Hand off to the review screen, which adds the photo to the set. The image checks run once,
      // on the whole set, when the user taps Proceed there - not after every capture.
      router.replace({ pathname: '/scan/review', params: { uri: result.uri } });
    } finally {
      setBusy(false);
    }
  }

  // Picker: the whole photo, fitted (not cropped) inside the frame's width, with a ring on each
  // spot, a strip of close-up thumbnails under it, and the primary button in the footer. Height is
  // whatever the center area leaves after its heading and strip, capped for very tall photos.
  const pickBoxH = Math.max(frame * 0.6, Math.min(wrapH - PICK_CHROME, frame * PICK_MAX_ASPECT));
  const aspect = img ? img.w / img.h : 1;
  const pickW = Math.min(frame, pickBoxH * aspect);
  const pickH = pickW / aspect;
  const rings = img ? placeRings(spots, pickW, pickH) : [];
  const current = spots[selected] ?? spots[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Dark glyphs are unreadable over this near-black backdrop - see the note in capture.tsx. */}
      <StatusBar style="light" />
      <Pressable style={styles.header} onLongPress={() => setShowReport((v) => !v)} delayLongPress={800}>
        <Pressable
          hitSlop={12}
          onPress={canReturnToSpots ? returnToSpots : () => router.back()}
          accessibilityRole="button"
          accessibilityLabel={canReturnToSpots ? t("Back to detected spots") : t("Back")}>
          <Icon name="chevron.left" tintColor="#FFFFFF" size={22} />
        </Pressable>
        {mode === 'pick' ? <View style={{ width: 22 }} /> : (
          <ThemedText type="headline" style={styles.title}>{t("Position the spot")}</ThemedText>
        )}
        <View style={{ width: 22 }} />
      </Pressable>
      {showReport ? (
        <Pressable onPress={() => setShowReport(false)} style={styles.report}>
          <ThemedText type="caption" style={styles.reportText} selectable>
            {lastSpotSearchReport() || 'No spot search has run on this photo.'}
          </ThemedText>
        </Pressable>
      ) : null}

      <View
        style={styles.frameWrap}
        onLayout={(e: LayoutChangeEvent) => setWrapH(e.nativeEvent.layout.height)}>
        {mode === 'pick' && img ? (
          <ScrollView
            style={styles.pickScroll}
            contentContainerStyle={styles.pickContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled>
            <View style={styles.pickIntro}>
              <ThemedText type="headline" style={styles.title}>{t("Choose a spot")}</ThemedText>
              <ThemedText type="subhead" style={styles.pickSubtitle}>
                {t("We found {{n}} spots. Tap the one you want to check.", { n: spots.length })}
              </ThemedText>
            </View>
            <TourTarget id="cropPickPhoto" style={[styles.pickPhoto, { width: pickW, height: pickH }]}>
              <Image source={{ uri: uri ?? undefined }} style={{ width: pickW, height: pickH }} contentFit="fill" />
              {rings.map(({ d, left, top, badge }, i) => {
                const on = i === selected;
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSelected(i)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t("Spot {{n}}", { n: i + 1 })}
                    style={[styles.spotRing, on && styles.spotRingOn, { width: d, height: d, left, top }]}>
                    <View style={[styles.spotBadge, on && styles.spotBadgeOn, badge]}>
                      <ThemedText type="caption" style={[styles.spotBadgeText, on && styles.spotBadgeTextOn]}>{i + 1}</ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </TourTarget>
            {/* Close-ups of each spot: on a wide photo the rings sit on specks you cannot judge. */}
            <TourTarget id="cropPickThumbs">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ width: frame, flexGrow: 0 }}
                contentContainerStyle={styles.thumbRow}>
                {spots.map((c, i) => {
                  const on = i === selected;
                  // Zoom so the spot's box fills about half the tile, centred on it.
                  const L = Math.max(c.bw * img.w, c.bh * img.h);
                  const k = Math.min(THUMB * 4 / Math.min(img.w, img.h), Math.max(THUMB / Math.min(img.w, img.h), (THUMB * 0.5) / L));
                  return (
                    <Pressable
                      key={i}
                      onPress={() => setSelected(i)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={t("Spot {{n}}", { n: i + 1 })}
                      style={[styles.thumb, on && styles.thumbOn]}>
                      <Image
                        source={{ uri: uri ?? undefined }}
                        contentFit="fill"
                        style={{
                          position: 'absolute',
                          width: img.w * k,
                          height: img.h * k,
                          left: THUMB / 2 - c.cx * img.w * k,
                          top: THUMB / 2 - c.cy * img.h * k,
                        }}
                      />
                      <View style={[styles.thumbLabel, on && styles.thumbLabelOn]}>
                        <ThemedText type="caption" style={styles.thumbLabelText}>{i + 1}</ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </TourTarget>
          </ScrollView>
        ) : (
          <>
            <View style={[styles.frame, { width: frame, height: frame }]}>
              {img ? (
                <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
                  <Animated.View style={[styles.imgWrap, imgStyle]}>
                    <Image source={{ uri: uri ?? undefined }} style={{ width: displayW, height: displayH }} contentFit="cover"
                      onDisplay={() => perfLog('crop.visible', perfSince('shutter'), 'since shutter')} />
                  </Animated.View>
                </GestureDetector>
              ) : null}

              {/* Framing target: fill this circle with the spot. Its diameter is the lesion-fill the
                  classifier reads most reliably, so "fill the circle" == "zoom to the right amount". */}
              <View style={styles.centerGuide} pointerEvents="none">
                <TourTarget id="cropRing" style={[styles.ringTarget, { width: GUIDE_PCT }]}>
                  <View style={[styles.targetRing, styles.ringFill]}>
                    <View style={[styles.tick, styles.tickTop]} />
                    <View style={[styles.tick, styles.tickBottom]} />
                    <View style={[styles.tick, styles.tickLeft]} />
                    <View style={[styles.tick, styles.tickRight]} />
                  </View>
                </TourTarget>
                <View style={styles.centerDot} />
              </View>

              {mode === 'finding' ? (
                <View style={styles.findingPill} pointerEvents="none">
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <ThemedText type="subhead" style={styles.findingText}>{t("Finding spots…")}</ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="footnote" style={styles.hint}>
              {t("Zoom so the spot fills the circle")}</ThemedText>
            {canReturnToSpots ? (
              <Pressable
                onPress={returnToSpots}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [styles.changeChip, pressed && styles.pressed]}>
                <Icon name="camera.viewfinder" tintColor="#FFFFFF" size={16} />
                <ThemedText type="subhead" style={styles.changeChipText}>{t("Choose a detected spot")}</ThemedText>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.lg }]}>
        {mode === 'pick' && current ? (
          <>
            <TourTarget id="cropPickCheck" style={styles.cta}>
              <Button
                label={t("Check spot {{n}}", { n: selected + 1 })}
                icon="arrow.right.circle.fill"
                variant="brand"
                onPress={() => pickSpot(current)}
              />
            </TourTarget>
            <TourTarget id="cropPickMyself" style={styles.secondaryRow}>
              <Pressable
                onPress={positionMyself}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
                <Icon name="plus.viewfinder" tintColor="#FFFFFF" size={16} />
                <ThemedText type="subhead" style={styles.secondaryText}>{t("Position it myself")}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
                <Icon name="photo.on.rectangle" tintColor="#FFFFFF" size={16} />
                <ThemedText type="subhead" style={styles.secondaryText}>{t("Another photo")}</ThemedText>
              </Pressable>
            </TourTarget>
          </>
        ) : (
          <>
            <TourTarget id="cropUse" style={styles.cta}>
              <Button label={t("Use photo")} variant="brand" loading={busy || mode === 'finding'} onPress={confirm} />
            </TourTarget>
            <Pressable hitSlop={10} onPress={() => router.back()} style={styles.retake}>
              <ThemedText type="headline" style={styles.retakeText}>
                {fromGallery ? t("Choose another") : t("Retake")}
              </ThemedText>
            </Pressable>
          </>
        )}
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
  pickScroll: { flex: 1, alignSelf: 'stretch' },
  pickContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: Space.lg, paddingVertical: Space.lg },
  pickIntro: { alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.xl },
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
  pickSubtitle: { color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  pickPhoto: { borderRadius: Space.md, overflow: 'hidden', backgroundColor: '#000' },
  // Unselected: a white ring with a dark halo, legible on pale and dark skin. Selected: the brand
  // ring, thicker, with a soft brand glow - one colour carries "this is the one".
  spotRing: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  spotRingOn: {
    borderWidth: 3,
    borderColor: Colors.light.brand,
    shadowColor: Colors.light.brand,
    shadowOpacity: 0.7,
    shadowRadius: 8,
  },
  spotBadge: {
    position: 'absolute',
    width: BADGE,
    height: BADGE,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotBadgeOn: { backgroundColor: Colors.light.brand },
  spotBadgeText: { color: '#211A15', fontWeight: '700' },
  spotBadgeTextOn: { color: '#FFFFFF' },
  thumbRow: { gap: Space.md, paddingVertical: Space.xs, paddingHorizontal: 2 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  thumbOn: { borderColor: Colors.light.brand, borderWidth: 3 },
  thumbLabel: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 5,
    backgroundColor: 'rgba(26,20,17,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLabelOn: { backgroundColor: Colors.light.brand },
  thumbLabelText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11, lineHeight: 14 },
  cta: { alignSelf: 'stretch' },
  ringTarget: { aspectRatio: 1 },
  ringFill: { width: '100%' },
  secondaryRow: { flexDirection: 'row', gap: Space.md, alignSelf: 'stretch' },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  secondaryText: { color: '#FFFFFF' },
  findingPill: {
    position: 'absolute',
    bottom: Space.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(26,20,17,0.72)',
  },
  findingText: { color: '#FFFFFF' },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 44,
    paddingHorizontal: Space.lg,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  changeChipText: { color: '#FFFFFF' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  report: {
    position: 'absolute',
    top: 96,
    left: Space.md,
    right: Space.md,
    zIndex: 10,
    padding: Space.md,
    borderRadius: Space.md,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  reportText: { color: '#FFFFFF', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 10, lineHeight: 13 },
  retakeText: { color: 'rgba(255,255,255,0.85)' },
});

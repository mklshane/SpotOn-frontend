import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/icon';
import { Space, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { assessImage, type IqaChecks } from '@/lib/image-quality';
import { MAX_IMAGES_PER_SCREENING } from '@/lib/classifier/model-config';
import { useScreeningSession } from '@/lib/screening-session';
import { decideQuality, nextStepAfterQuality } from '@/lib/triage/scan-flow';
import {
  combineReadability,
  evaluateSafetyFloor,
  evaluateScaleConsistency,
} from '@/lib/triage/tps-core';

const STEP_MS = 1300; // per-check reveal cadence
/**
 * A clean pass used to auto-advance after a short beat. It no longer does.
 *
 * Once this screen started offering a second photo, the timer stopped being a convenience and
 * became a race: it fired before the offer could be read, so the choice was theoretical. An
 * explicit Proceed costs the single-photo path one tap and is the honest trade — the screen is
 * showing the user a verdict about their photo, which is a reasonable moment to ask for a decision.
 */
/**
 * Grace period, after the IQA rows have finished revealing, to wait for the first classification
 * pass before giving up and advancing anyway.
 *
 * The point of this screen is that every "this photo won't work" verdict lands HERE, next to the
 * IQA result — not eight questions later. Confidence is a readability signal exactly like blur is,
 * and telling someone to retake after they have answered the whole questionnaire wastes their
 * effort. Inference starts on mount and the rows take ~3.9s to reveal, so on most devices the
 * result is already in by then and this grace is never spent. When it IS exceeded we advance as
 * before and analysis.tsx catches it — degraded to today's behaviour, never worse.
 */
const READABILITY_GRACE_MS = 2000;

type RowStatus = 'pending' | 'ok' | 'warn';
const ROW_META: { label: string; icon: IconName }[] = [
  { label: 'Lighting', icon: 'sun.max' },
  { label: 'Focus', icon: 'camera.viewfinder' },
  { label: 'Lesion in frame', icon: 'sparkles' },
];

export default function QualityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { uri, detected } = useLocalSearchParams<{ uri: string; detected?: string }>();
  const session = useScreeningSession();
  const { setImageUri, questionnaireComplete } = session;

  // Warm up the classifier while the IQA animation plays — the load (1–3s) is free here.
  // Lazy import keeps the TFLite module off the app-startup path.
  useEffect(() => {
    import('@/lib/classifier/classifier-model')
      .then((m) => m.getClassifierModel())
      .catch((e) => console.warn('[classifier] warm-up failed', e));
  }, []);

  const CARD = Math.min(width - Space.xl * 2, 216);

  // Lesion verdict comes from the live camera detector (carried via param). Gallery uploads
  // have no live detection, so they fall back to skin-colour presence.
  const lesionKnown = detected === '0' || detected === '1';
  const lesionFound = detected === '1';

  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<IqaChecks | null>(null);
  const [error, setError] = useState(false);
  const [readability, setReadability] = useState<'pending' | 'ok' | 'unreadable' | 'timeout'>('pending');
  const proceeded = useRef(false);

  // Start inference the moment the photo lands, not at proceed(): that is what lets the
  // low-confidence verdict be shown on THIS screen instead of after the questionnaire. The index
  // is the one addImage() will assign in proceed(); enqueueImage is keyed on (index, uri), so a
  // retake replaces this run rather than inheriting it.
  const pendingIndex = session.images.length;
  useEffect(() => {
    if (!uri) return;
    session.enqueueImage(uri, pendingIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Join the first pass as soon as it settles and apply the same Safety Floor rule analysis.tsx
  // uses, so the two screens can never disagree about whether a photo is readable.
  useEffect(() => {
    if (session.classificationState !== 'done' && session.classificationState !== 'error') return;
    let alive = true;
    session
      .getClassification()
      .then((out) => {
        if (!alive) return;
        const verdict = combineReadability(
          evaluateSafetyFloor(out.topConfidence, session.attempt),
          evaluateScaleConsistency(out.scaleUnstable, session.attempt),
        );
        setReadability(verdict === 'ok' ? 'ok' : 'unreadable');
      })
      // A hard classifier failure is analysis.tsx's error state to own, not a retake prompt here.
      .catch(() => alive && setReadability('ok'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.classificationState]);

  // Bound the wait: once the rows have revealed, give inference a short grace, then move on.
  useEffect(() => {
    if (readability !== 'pending') return;
    const t = setTimeout(
      () => setReadability((r) => (r === 'pending' ? 'timeout' : r)),
      ROW_META.length * STEP_MS + READABILITY_GRACE_MS,
    );
    return () => clearTimeout(t);
  }, [readability]);

  useEffect(() => {
    let alive = true;
    if (!uri) {
      setError(true);
      return;
    }
    assessImage(uri)
      .then((c) => alive && setChecks(c))
      .catch((e) => {
        console.warn('[iqa] failed', e);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [uri]);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(ROW_META.length, s + 1)), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const settled = checks != null || error;

  const brightnessOk = checks?.brightness.ok ?? false;
  const sharpOk = checks?.sharpness.ok ?? false;
  const skinOk = checks?.skin.ok ?? false;
  // Gallery uploads have no live detector, so they fall back to skin-colour presence. Skin coverage
  // is always a hard "is this skin?" guard on top of the carried lesion verdict.
  const lesionOk = (lesionKnown ? lesionFound : skinOk) && skinOk;
  const iqaPass = !error && brightnessOk && sharpOk && lesionOk;
  const readableOk = readability !== 'unreadable';
  // The verdict itself lives in scan-flow.ts so every branch is pinned by npm run test:flow.
  const { pass, analyzing } = decideQuality({
    iqaPass,
    read: readability,
    checksSettled: step >= ROW_META.length && settled,
  });

  // Offer a second angle only where it makes sense: a clean camera photo, still under the cap, with
  // no gallery selection queued behind it. `images` doesn't include this photo yet — it is added by
  // proceed()/addAnotherAngle() — hence the +1.
  const canAddAngle = pass && !analyzing && session.images.length + 1 < MAX_IMAGES_PER_SCREENING;

  const reasons = useMemo(() => {
    if (error) return ['We couldn’t analyze this photo.'];
    if (!checks) return [];
    const out: string[] = [];
    if (!brightnessOk) {
      out.push(
        checks.brightness.issue === 'dark'
          ? 'The photo looks too dark.'
          : checks.brightness.issue === 'glare'
            ? 'Glare on the spot — tilt slightly to avoid the reflection.'
            : 'The photo looks too bright — try softer, even light.',
      );
    }
    if (!sharpOk) out.push('The photo looks blurry — move closer and tap to focus.');
    if (!skinOk) out.push('This doesn’t look like a photo of skin.');
    else if (!lesionOk) out.push('We couldn’t find a clear lesion — center the spot in the frame.');
    // Confidence is a readability signal like blur is — surfaced here rather than after the
    // questionnaire, so a retake costs the user a photo and not eight answers.
    if (!readableOk) out.push('We couldn’t get a clear read of this spot — a sharper, closer photo usually fixes it.');
    // Shadow is advisory: it never blocks, but when we're already asking for a retake, surface it.
    if (checks.shadow && !checks.shadow.ok) {
      out.push('Tip: even out the lighting — avoid casting a shadow across the spot.');
    }
    return out;
  }, [error, checks, brightnessOk, sharpOk, skinOk, lesionOk, readableOk]);

  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [sweep]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (CARD - 56) }] }));

  function proceed() {
    if (proceeded.current || !uri) return;
    proceeded.current = true;
    // The user has now SEEN the low-confidence warning here. Asking again after the questionnaire
    // would be the exact double-prompt this change exists to remove, so analysis applies the
    // Safety Floor directly instead (same outcome as its own "continue anyway").
    if (readability === 'unreadable') session.acceptLowConfidence();

    const index = session.addImage({
      uri,
      source: session.source,
      qualityPassed: pass,
      detected: lesionKnown ? lesionOk : undefined,
    });
    if (index === 0) setImageUri(uri);
    // Inference starts HERE, not at the analysis screen: by the time the user has cropped the next
    // photo and answered the questionnaire, this one is usually already done.
    session.enqueueImage(uri, index);

    const step = nextStepAfterQuality({ questionnaireComplete });
    router.replace(`/scan/${step.kind}`);
  }

  /**
   * Accept this photo and go straight back to the camera for another angle of the SAME spot.
   * Deliberately not a separate review screen: the user is already looking at the photo they just
   * took, so the decision belongs here.
   */
  async function addAnotherAngle() {
    if (proceeded.current || !uri) return;
    proceeded.current = true;
    const index = session.addImage({
      uri,
      source: session.source,
      qualityPassed: pass,
      detected: lesionKnown ? lesionOk : undefined,
    });
    if (index === 0) setImageUri(uri);
    session.enqueueImage(uri, index);

    // Return to whichever source they used, so "another angle" costs one action, not a re-pick of
    // camera-vs-upload they already made.
    if (session.source === 'gallery') {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
      if (result.canceled || !result.assets[0]) {
        proceeded.current = false; // they backed out — this photo is already accepted, so just move on
        return;
      }
      router.replace({ pathname: '/scan/crop', params: { uri: result.assets[0].uri, source: 'gallery' } });
      return;
    }
    router.replace('/scan/capture');
  }

  function retake() {
    // Drop this photo's pending/settled run so the retake is classified fresh. (enqueueImage is
    // keyed on (index, uri) as a second guard, but not leaving orphans is cheaper than relying on it.)
    if (uri) session.removeImage(uri);
    router.back();
  }

  function statusFor(i: number): RowStatus {
    const ready = step > i && settled;
    if (!ready) return 'pending';
    if (error) return 'warn';
    const ok = i === 0 ? brightnessOk : i === 1 ? sharpOk : lesionOk;
    return ok ? 'ok' : 'warn';
  }

  const title = analyzing ? 'Analyzing your photo' : pass ? 'Looks great' : 'A few things to check';
  const subtitle = analyzing
    ? 'Scanning lighting, focus and skin…'
    : pass
      ? canAddAngle
        ? 'Proceed, or add another photo of the same spot.'
        : // At the photo cap — "preparing your result" would be a lie now that nothing auto-advances.
          `That's ${MAX_IMAGES_PER_SCREENING} photos — ready when you are.`
      : 'You can still continue if you’d like';

  const rows = useMemo(
    () => ROW_META.map((r, i) => ({ ...r, status: statusFor(i) })),
    [step, settled, error, brightnessOk, sharpOk, lesionOk], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const frameColor = analyzing ? 'rgba(255,255,255,0.9)' : pass ? theme.riskLow : theme.riskModerate;
  const showFooter = !analyzing && !pass;

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Scanning preview of the actual photo */}
        <View style={[styles.card, { width: CARD, height: CARD, borderColor: frameColor }]}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View style={styles.dim} pointerEvents="none" />
          <View style={[styles.bracket, styles.tl, { borderColor: frameColor }]} />
          <View style={[styles.bracket, styles.tr, { borderColor: frameColor }]} />
          <View style={[styles.bracket, styles.bl, { borderColor: frameColor }]} />
          <View style={[styles.bracket, styles.br, { borderColor: frameColor }]} />
          {analyzing ? (
            <Animated.View style={[styles.beam, beamStyle]} pointerEvents="none">
              <LinearGradient
                colors={['rgba(255,138,76,0)', 'rgba(255,138,76,0.45)', 'rgba(255,255,255,0.9)', 'rgba(255,138,76,0.45)', 'rgba(255,138,76,0)']}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : (
            <View style={styles.badgeWrap} pointerEvents="none">
              <Animated.View
                entering={ZoomIn.springify().damping(12)}
                style={[styles.resultBadge, { backgroundColor: pass ? theme.riskLow : theme.riskModerate }]}>
                <Icon name={pass ? 'checkmark' : 'exclamationmark.triangle.fill'} tintColor="#FFFFFF" size={32} />
              </Animated.View>
            </View>
          )}
        </View>

        <Animated.View key={title} entering={FadeIn} style={styles.header}>
          <ThemedText type="title2" style={styles.center}>
            {title}
          </ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary" style={styles.center}>
            {subtitle}
          </ThemedText>
        </Animated.View>

        <Card style={styles.checklist}>
          {rows.map((row, i) => (
            <Animated.View
              key={row.label}
              entering={FadeInDown.delay(120 * i)}
              style={[styles.row, i > 0 && { borderTopColor: theme.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={[styles.rowIcon, { backgroundColor: theme.brandTint }]}>
                <Icon name={row.icon} tintColor={theme.brand} size={20} />
              </View>
              <ThemedText type="headline" style={styles.rowLabel}>
                {row.label}
              </ThemedText>
              <Animated.View key={row.status} entering={ZoomIn.springify().damping(11)}>
                {row.status === 'pending' ? (
                  <PendingDot color={theme.muted} />
                ) : row.status === 'ok' ? (
                  <Icon name="checkmark.circle.fill" tintColor={theme.riskLow} size={26} />
                ) : (
                  <Icon name="exclamationmark.triangle.fill" tintColor={theme.riskModerate} size={24} />
                )}
              </Animated.View>
            </Animated.View>
          ))}
        </Card>

        {showFooter && reasons.length > 0 ? (
          <Animated.View entering={FadeIn} style={styles.reasons}>
            {reasons.map((r) => (
              <ThemedText key={r} type="footnote" themeColor="muted" style={styles.reason}>
                {r}
              </ThemedText>
            ))}
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* The whole multi-photo offer: one line, on the screen the user is already on, only when a
          second angle is actually possible. Ignoring it advances as normal — it never blocks. */}
      {/* Clean pass: Proceed is the primary action, with the second-photo offer beneath it. There is
          no auto-advance — a timer that fires before the offer can be read isn't an offer. */}
      {!analyzing && pass ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button label="Proceed" variant="brand" onPress={proceed} style={styles.useAnyway} />
          {canAddAngle ? (
            <Button
              label="Add another photo"
              variant="outline"
              icon="plus.viewfinder"
              onPress={addAnotherAngle}
              style={styles.useAnyway}
            />
          ) : null}
        </Animated.View>
      ) : null}

      {showFooter ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button label="Retake or choose another" variant="brand" onPress={retake} style={styles.useAnyway} />
          <Pressable hitSlop={10} onPress={proceed} style={styles.retake} accessibilityRole="button">
            <ThemedText type="headline" themeColor="textSecondary">
              Use anyway
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

/** Pulsing dot shown while a check is still pending. */
function PendingDot({ color }: { color: string }) {
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 650 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Space.xl, paddingTop: Space.lg, paddingBottom: Space.lg, alignItems: 'stretch' },
  card: {
    alignSelf: 'center',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    backgroundColor: '#1A1411',
  },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,13,0.18)' },
  bracket: { position: 'absolute', width: 24, height: 24 },
  tl: { top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 10, left: 10, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 10, right: 10, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  beam: { position: 'absolute', left: 0, right: 0, top: 0, height: 56 },
  badgeWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  resultBadge: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', gap: Space.xs, paddingTop: Space.lg },
  center: { textAlign: 'center' },
  checklist: { marginTop: Space.lg, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base, paddingVertical: Space.base },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  reasons: { marginTop: Space.lg, gap: Space.xs, paddingHorizontal: Space.sm },
  reason: { textAlign: 'center' },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.sm, alignItems: 'center' },
  useAnyway: { alignSelf: 'stretch', paddingVertical: Space.base },
  retake: { paddingVertical: Space.sm },
});

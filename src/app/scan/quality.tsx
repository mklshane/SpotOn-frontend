import { t, localizedCopy, useLocale } from '@/lib/i18n';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { useSurfaceWidth } from '@/hooks/use-surface-width';
import { useTheme } from '@/hooks/use-theme';
import { releaseBlobUri } from '@/lib/blob-uri';
import { upscaleFor } from '@/lib/capture-upscale';
import { assessHair, assessImage, type IqaChecks } from '@/lib/image-quality';
import { useScreeningSession } from '@/lib/screening-session';
import { discardScratch } from '@/lib/scratch-files';
import {
  decideIqa,
  decideQuality,
  decideSetQuality,
  isHeadRegion,
  nextStepAfterQuality,
  readStateFromVerdict,
  retakeStartsRescan,
  skinGateVerdict,
  type IqaVerdict,
  type SkinGateVerdict,
} from '@/lib/triage/scan-flow';
import {
  combineReadability,
  evaluateSafetyFloor,
  evaluateScaleConsistency,
} from '@/lib/triage/tps-core';
import { perfLog } from '@/lib/perf-log';

const STEP_MS = 1300; // per-check reveal cadence

/**
 * A clean set auto-advances after this beat (2026-10-07).
 *
 * It didn't while this screen offered the second photo: a timer that fired before the offer could be
 * read made the choice theoretical. That offer now lives on the review screen, where the user has
 * already tapped Proceed, so asking them to confirm a "Looks great" a second time is pure friction.
 * Long enough to read the verdict, short enough not to feel like waiting.
 */
const AUTO_ADVANCE_MS = 900;

/**
 * Grace period, after the IQA rows have finished revealing, to wait for the first classification
 * pass before giving up and advancing anyway.
 *
 * The point of this screen is that every "this photo won't work" verdict lands HERE, next to the
 * IQA result - not eight questions later. Confidence is a readability signal exactly like blur is,
 * and telling someone to retake after they have answered the whole questionnaire wastes their
 * effort. On iOS/web inference starts on the review screen, so it is usually in before this screen
 * even mounts. When the grace IS exceeded we advance as before and analysis.tsx catches it -
 * degraded to today's behaviour, never worse.
 */
const READABILITY_GRACE_MS = 2000;

/**
 * Bound on each photo's skin-gate run. Exceeding it degrades to "could not answer", which BLOCKS
 * the row (2026-09-17) - so this is 20 s, not 4 s: a first scan on the web build loads the WASM
 * runtime and the model, and a slow load must not be mistaken for a failure. It only costs time when
 * the model is slow; body.tsx prewarms the model before capture.
 */
const SKIN_GATE_TIMEOUT_MS = 20000;

type RowStatus = 'pending' | 'ok' | 'warn';
const ROW_META: { label: string; icon: IconName }[] = localizedCopy([
  { label: 'Lighting', icon: 'sun.max' },
  { label: 'Focus', icon: 'camera.viewfinder' },
  { label: 'Skin in frame', icon: 'sparkles' },
]);

/** One photo's image checks. `skinGate` is the learned skin gate (skin-gate.ts). */
type PhotoCheck = {
  uri: string;
  checks: IqaChecks | null;
  error: boolean;
  skinGate: SkinGateVerdict | 'pending';
};

const isSettled = (p: PhotoCheck) => (p.checks != null || p.error) && p.skinGate !== 'pending';

function verdictOf(p: PhotoCheck): IqaVerdict {
  return decideIqa({
    error: p.error,
    brightnessOk: p.checks?.brightness.ok ?? false,
    sharpOk: p.checks?.sharpness.ok ?? false,
    skinOk: p.checks?.skin.ok ?? false,
    /**
     * THE IMAGE OWNS PRESENCE, NOT THE DETECTOR (2026-08-25). The detector fires on 88% of
     * lesion-free skin - it answers "where", never "whether". `checks.lesion` is the centre-surround
     * contrast test; since 2026-09-29 it is advisory (see decideIqa) and only recorded.
     */
    presenceOk: p.checks?.lesion.ok ?? false,
    // Only a model that RAN and said 'skin' passes; 'pending' never reaches a verdict (see isSettled).
    skinGate: p.skinGate === 'pending' ? 'failed' : p.skinGate,
  });
}

/** Run the skin gate once, retry once (a failed load clears skin-gate.ts's cache), bounded. */
async function runSkinGate(uri: string): Promise<SkinGateVerdict> {
  const run = () => import('@/lib/skin-gate').then((m) => m.classifySkin(uri));
  const attempt = run().catch((e) => {
    console.warn('[iqa] skin gate failed, retrying once', e);
    return run();
  });
  const timeout = new Promise<'failed'>((resolve) => setTimeout(() => resolve('failed'), SKIN_GATE_TIMEOUT_MS));
  try {
    const p = await Promise.race([attempt, timeout]);
    if (p === 'failed') return 'failed';
    if (__DEV__) console.log('[iqa] skin gate', JSON.stringify(p));
    return skinGateVerdict(p);
  } catch (e) {
    console.warn('[iqa] skin gate failed', e);
    return 'failed';
  }
}

/**
 * The image checks over the WHOLE photo set, once (2026-10-07).
 *
 * Photos are collected on the review screen and this screen checks all of them together, instead of
 * running after every capture. Per-photo verdicts come from decideIqa (every term a veto), and
 * decideSetQuality turns them into what is offered:
 *   - every photo passes -> wait briefly for the classifier's readability verdict, then auto-advance;
 *   - some pass          -> "Continue with N photos" (drops the failures) or "Use anyway" (keeps all);
 *   - none pass          -> "Retake or choose another" or "Use anyway".
 * The checklist rows are the aggregate over the set; the reasons say which photo when there are
 * several.
 */
export default function QualityScreen() {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const width = useSurfaceWidth();
  const session = useScreeningSession();
  const { questionnaireComplete } = session;

  // The set as it was when the user tapped Proceed. It only shrinks from here, and only through this
  // screen's own buttons, so a snapshot keeps the per-photo results aligned with what is shown.
  const [set] = useState(() => session.images.map((p) => p.uri));
  const [photos, setPhotos] = useState<PhotoCheck[]>(() =>
    set.map((uri) => ({ uri, checks: null, error: false, skinGate: 'pending' })),
  );
  const [checkingPos, setCheckingPos] = useState(0);
  const [readabilityState, setReadability] = useState<'pending' | 'ok' | 'unreadable' | 'timeout'>('pending');
  const proceeded = useRef(false);

  const patch = (pos: number, next: Partial<PhotoCheck>) =>
    setPhotos((prev) => prev.map((p, i) => (i === pos ? { ...p, ...next } : p)));

  // Warm up the classifier while the checks run - the load (1–3s) is free here.
  // Lazy import keeps the TFLite module off the app-startup path.
  useEffect(() => {
    import('@/lib/classifier/classifier-model')
      .then((m) => m.getClassifierModel())
      .catch((e) => console.warn('[classifier] warm-up failed', e));
  }, []);

  // Nothing to check (a stale route): back to taking a photo.
  useEffect(() => {
    if (set.length > 0) return;
    if (router.canGoBack()) router.back();
    else router.replace('/scan/capture');
  }, [set.length]);

  /**
   * Check the photos one after another. The skin gate is a single interpreter, and on Android the
   * IQA decode and the skin gate share one JS thread, so running three photos at once would only
   * make every row later. Within one photo the IQA and the skin gate run side by side, as before.
   *
   * NO DETECTOR RUN ON THIS SCREEN (removed 2026-09-08): its only consumer was a waiver of the skin
   * check that let photos of a street through - see decideIqa. The detector still owns the crop the
   * classifier reads (classify.ts).
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let pos = 0; pos < set.length; pos++) {
        if (!alive) return;
        const uri = set[pos];
        setCheckingPos(pos);
        const tIqa = Date.now();
        const iqa = assessImage(uri, upscaleFor(uri))
          .then((c) => {
            perfLog('quality.iqa', Date.now() - tIqa,
              `photo=${pos + 1} sharp=${c.sharpness.value.toExponential(2)} edge=${c.sharpness.edgeWidth.toFixed(1)} ok=${c.sharpness.ok}`);
            if (alive) patch(pos, { checks: c });
          })
          .catch((e) => {
            console.warn('[iqa] failed', e);
            if (alive) patch(pos, { error: true });
          });
        const tSkin = Date.now();
        const gate = runSkinGate(uri).then((v) => {
          perfLog('quality.skinGate', Date.now() - tSkin, `photo=${pos + 1}`);
          if (alive) patch(pos, { skinGate: v });
        });
        await Promise.all([iqa, gate]);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(ROW_META.length, s + 1)), STEP_MS);
    return () => clearInterval(id);
  }, []);

  // No row is judged before every photo's checks have landed, or a slow device would show a verdict
  // a later photo then contradicts.
  const settled = photos.length > 0 && photos.every(isSettled);

  // Rows also reveal one STEP_MS apart counted from when the analysis settled, not only from mount.
  // iOS settles inside the first step, so the mount clock governs; a slow Android device settled
  // after every mount step had elapsed, and all three rows landed at once.
  const [stepsSinceSettled, setStepsSinceSettled] = useState(0);
  useEffect(() => {
    if (!settled) return;
    const id = setInterval(
      () => setStepsSinceSettled((s) => Math.min(ROW_META.length, s + 1)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [settled]);
  const revealed = settled ? Math.min(step, stepsSinceSettled + 1) : 0;
  const rowsDone = revealed >= ROW_META.length;

  // Android defers the advisory hair check out of assessImage (it is ~half the IQA cost on Hermes).
  // Run it once every row has revealed, photo by photo; it only ever adds the hair tip, never changes
  // pass/fail. No-op (null) where it ran inline.
  const hairPendingAny = photos.some((p) => p.checks != null && p.checks.hair == null);
  useEffect(() => {
    if (!rowsDone || !hairPendingAny) return;
    let alive = true;
    (async () => {
      for (let pos = 0; pos < photos.length; pos++) {
        const p = photos[pos];
        if (!alive || !p.checks || p.checks.hair != null) continue;
        try {
          const hair = await assessHair(p.uri);
          if (alive && hair) {
            setPhotos((prev) =>
              prev.map((q, i) => (i === pos && q.checks ? { ...q, checks: { ...q.checks, hair } } : q)),
            );
          }
        } catch (e) {
          console.warn('[iqa] hair check failed', e);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsDone, hairPendingAny]);

  // Android: the classifier, skin gate and IQA share one JS thread and CPU budget, so classification
  // starts once the checks have settled. iOS/web already started it on the review screen; enqueueing
  // again is a no-op there (the session dedupes by uri).
  const classifyGate = Platform.OS !== 'android' || settled;
  useEffect(() => {
    if (!classifyGate) return;
    session.images.forEach((p) => session.enqueueImage(p.uri, p.index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifyGate]);

  /**
   * The readability verdict on the PRIMARY photo (pooling ships off, so it is the one the result
   * reports). Same Safety Floor rule analysis.tsx uses, so the two screens can never disagree.
   */
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
        setReadability(readStateFromVerdict(verdict));
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
    if (readabilityState !== 'pending' || !classifyGate) return;
    const timer = setTimeout(
      () => setReadability((r) => (r === 'pending' ? 'timeout' : r)),
      ROW_META.length * STEP_MS + READABILITY_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [readabilityState, classifyGate]);

  const mountedAtRef = useRef(0);
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);
  useEffect(() => {
    if (settled) perfLog('quality.settled', Date.now() - mountedAtRef.current, `since mount, ${set.length} photo(s)`);
  }, [settled, set.length]);

  const verdicts = useMemo(() => photos.map(verdictOf), [photos]);
  const setQ = decideSetQuality(verdicts);
  const readability = readabilityState;
  // The verdict itself lives in scan-flow.ts so every branch is pinned by npm run test:flow.
  const { pass, analyzing } = decideQuality({
    iqaPass: settled && setQ.allPass,
    read: readability,
    checksSettled: rowsDone && settled,
  });
  const mixed = settled && !setQ.allPass && !setQ.nonePass;
  const multi = photos.length > 1;

  const hairTipAt = (p: PhotoCheck) =>
    !!p.checks?.skin.ok && p.skinGate === 'skin' && !!p.checks?.hair && !p.checks.hair.ok;
  const hairTip = photos.some((p, i) => verdicts[i].pass && hairTipAt(p));

  const reasons = useMemo(() => {
    const out: string[] = [];
    photos.forEach((p, pos) => {
      const lines = reasonsFor(p, verdicts[pos], pos === 0 && readability === 'unreadable', hairTipAt(p), session.bodyMark?.region);
      const prefix = multi ? `${t('Photo {{n}}', { n: pos + 1 })}: ` : '';
      lines.forEach((l) => out.push(prefix + l));
    });
    return out;
  }, [photos, verdicts, readability, multi, session.bodyMark?.region]);

  const sweep = useSharedValue(0);
  const CARD = Math.min(width - Space.xl * 2, 216);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [sweep]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (CARD - 56) }] }));

  /** Write each kept photo's verdict onto the session, then move on. */
  function advance(keep: readonly number[]) {
    if (proceeded.current) return;
    proceeded.current = true;
    const keptPrimary = keep.includes(0);
    // The user has now SEEN the low-confidence warning here. Asking again after the questionnaire
    // would be the double-prompt this screen exists to remove, so analysis applies the Safety Floor
    // directly instead (same outcome as its own "continue anyway"). Only meaningful while the photo
    // it was about is still the primary.
    if (keptPrimary && readability === 'unreadable') session.acceptLowConfidence();

    photos.forEach((p, pos) => {
      if (keep.includes(pos)) return;
      session.removeImage(p.uri);
      void discardScratch(p.uri);
      releaseBlobUri(p.uri);
    });
    keep.forEach((pos) => {
      const p = photos[pos];
      const read = pos !== 0 || readability === 'ok' || readability === 'timeout';
      session.updateImage(p.uri, {
        // `pending` is not a pass: it is recorded on the screening, so it must never claim a verdict.
        qualityPassed: verdicts[pos].pass && read,
        detected: p.checks ? verdicts[pos].lesionSeen : undefined,
      });
    });

    const next = nextStepAfterQuality({ questionnaireComplete });
    router.replace(`/scan/${next.kind}`);
  }

  const all = photos.map((_, i) => i);

  // A clean set moves on by itself. A hair tip holds it: that advice is the whole point of
  // surfacing it on a passing photo, and it cannot be read on a screen that leaves in under a second.
  useEffect(() => {
    if (!pass || analyzing || hairTip || hairPendingAny) return;
    const timer = setTimeout(() => advance(all), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, analyzing, hairTip, hairPendingAny]);

  function retake() {
    if (proceeded.current) return;
    proceeded.current = true;
    // Answering the low-confidence prompt is the Safety Floor's first strike: move to attempt 2 the
    // same way analysis.tsx does, or every retake re-prompts and the floor is never reached.
    // beginRescan clears the whole set; otherwise drop the photos (and their runs) ourselves.
    if (retakeStartsRescan(readability, session.attempt)) {
      session.beginRescan();
    } else {
      photos.forEach((p) => {
        session.removeImage(p.uri);
        void discardScratch(p.uri);
        releaseBlobUri(p.uri);
      });
    }
    // The capture screen (or, for an upload, the screen that offered the picker) is directly below.
    if (router.canGoBack()) router.back();
    else router.replace('/scan/capture');
  }

  function statusFor(row: number): RowStatus {
    if (!(revealed > row && settled)) return 'pending';
    const ok = photos.every((p, i) => {
      if (p.error) return false;
      if (row === 0) return p.checks?.brightness.ok ?? false;
      if (row === 1) return p.checks?.sharpness.ok ?? false;
      return verdicts[i].lesionRowOk;
    });
    return ok ? 'ok' : 'warn';
  }

  const failingCount = setQ.failing.length;
  const title = analyzing
    ? multi
      ? t('Checking your photos')
      : t('Analyzing your photo')
    : pass
      ? t('Looks great')
      : mixed
        ? failingCount === 1
          ? t('1 photo needs another look')
          : t('{{n}} photos need another look', { n: failingCount })
        : t('A few things to check');
  const subtitle = analyzing
    ? multi && !settled
      ? t('Checking photo {{n}} of {{total}}…', { n: checkingPos + 1, total: photos.length })
      : t('Scanning lighting, focus and skin…')
    : pass
      ? hairTip
        ? t('One tip before you continue.')
        : t('Taking you to the next step…')
      : mixed
        ? t('You can continue with the clear ones.')
        : t('You can still continue if you’d like');

  const rows = useMemo(
    () => ROW_META.map((r, i) => ({ ...r, status: statusFor(i) })),
    [revealed, settled, photos, verdicts], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The card holds still on the main photo while checking (cycling through the set read as
  // flicker), then shows the first photo with a problem - that is what the reasons are about.
  const shownPos = !settled ? 0 : setQ.failing[0] ?? 0;
  const shownUri = photos[shownPos]?.uri;
  const frameColor = analyzing ? 'rgba(255,255,255,0.9)' : pass ? theme.riskLow : theme.riskModerate;
  const showReasons = !analyzing && (!pass || hairTip);
  const keepCount = setQ.passing.length;

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Scanning preview of the actual photo */}
        <View style={[styles.card, { width: CARD, height: CARD, borderColor: frameColor }]}>
          {shownUri ? <Image source={{ uri: shownUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} /> : null}
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

        {/* Per-photo verdicts, so "1 photo needs another look" points at a face, not a number. */}
        {multi ? (
          <View style={styles.thumbs}>
            {photos.map((p, pos) => {
              const done = isSettled(p) && settled;
              const ok = verdicts[pos].pass;
              return (
                <View key={p.uri} style={[styles.thumb, { borderColor: !done ? 'transparent' : ok ? theme.riskLow : theme.riskModerate }]}>
                  <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <View style={[styles.thumbBadge, { backgroundColor: !done ? theme.surface : ok ? theme.riskLow : theme.riskModerate }]}>
                    {!done ? (
                      <PendingDot color={pos === checkingPos && !settled ? theme.brand : theme.muted} size={8} />
                    ) : (
                      <Animated.View entering={ZoomIn.springify().damping(11)}>
                        <Icon name={ok ? 'checkmark' : 'exclamationmark'} tintColor="#FFFFFF" size={12} />
                      </Animated.View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

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

        {showReasons && reasons.length > 0 ? (
          <Animated.View entering={FadeIn} style={styles.reasons}>
            {reasons.map((r) => (
              <ThemedText key={r} type="footnote" themeColor="muted" style={styles.reason}>
                {r}
              </ThemedText>
            ))}
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* Clean set with a hair tip: it does not auto-advance, so give it an explicit way on. */}
      {!analyzing && pass && hairTip ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button label={t('Proceed')} variant="brand" onPress={() => advance(all)} style={styles.cta} />
          <Pressable hitSlop={10} onPress={retake} style={styles.link} accessibilityRole="button">
            <ThemedText type="headline" themeColor="textSecondary">
              {t('Retake')}
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Some photos are fine: keep those, or keep everything. No per-photo retake by design. */}
      {!analyzing && mixed ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button
            label={keepCount === 1 ? t('Continue with 1 photo') : t('Continue with {{n}} photos', { n: keepCount })}
            variant="brand"
            onPress={() => advance(setQ.passing)}
            style={styles.cta}
          />
          <Pressable hitSlop={10} onPress={() => advance(all)} style={styles.link} accessibilityRole="button">
            <ThemedText type="headline" themeColor="textSecondary">
              {t('Use anyway')}
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Nothing usable, or every photo is fine but the classifier could not read the spot. */}
      {!analyzing && !pass && !mixed ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button label={t('Retake or choose another')} variant="brand" onPress={retake} style={styles.cta} />
          <Pressable hitSlop={10} onPress={() => advance(all)} style={styles.link} accessibilityRole="button">
            <ThemedText type="headline" themeColor="textSecondary">
              {t('Use anyway')}
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

/**
 * What to tell the user about ONE photo. Empty for a clean photo without a tip.
 *
 * On a frame that is not skin, the skin sentence is the ONLY truthful thing we can say: every other
 * line is a sentence about skin, a spot, or a read of a lesion, and three of them once fired at once
 * on a photo of a night street. Say what is actually wrong and stop.
 */
function reasonsFor(
  p: PhotoCheck,
  v: IqaVerdict,
  unreadable: boolean,
  hairTip: boolean,
  region: string | null | undefined,
): string[] {
  if (p.error) return [t('We couldn’t analyze this photo.')];
  const c = p.checks;
  if (!c) return [];
  // A whole face is skin, so it gets its own sentence - the fix is to move closer.
  if (p.skinGate === 'face') return [t('This looks like a whole face - move closer so the spot fills the frame.')];
  if (!c.skin.ok || p.skinGate === 'not_skin') return [t('This doesn’t look like a photo of skin.')];
  const out: string[] = [];
  if (!c.brightness.ok) {
    out.push(
      c.brightness.issue === 'dark'
        ? t('The photo looks too dark.')
        : t('Glare on the spot - tilt slightly to avoid the reflection.'),
    );
  }
  // Covers both ways this fails now: a missed focus lock and a moving hand (see LESION_EDGE_WIDTH).
  if (!c.sharpness.ok) out.push(t('The photo looks blurry - hold still, and tap the spot to focus.'));
  if (p.skinGate === 'failed') {
    out.push(t('We couldn’t check this photo for a spot - please try again.'));
  } else if (!c.lesion.ok && !v.pass) {
    // Advisory since 2026-09-29 (see decideIqa): a faint spot is still allowed through, so the tip
    // only rides along when the photo is already being flagged for something else.
    out.push(t('Tip: if the spot is hard to see, center it in the frame.'));
  }
  // Confidence is a readability signal like blur is - surfaced here rather than after the
  // questionnaire, so a retake costs the user a photo and not eight answers.
  if (unreadable) out.push(t('We couldn’t get a clear read of this spot - a sharper, closer photo usually fixes it.'));
  // Shadow is advisory: it never blocks, but when we're already asking for a retake, surface it.
  if (!v.pass && c.shadow && !c.shadow.ok) {
    out.push(t('Tip: even out the lighting - avoid casting a shadow across the spot.'));
  }
  /**
   * Hair is advisory too, but UNLIKE shadow it is surfaced even on a passing photo: the failure it
   * addresses is a well-exposed, sharp, correctly framed photo whose lesion happens to be under hair
   * (retrain/WHY_CONFIDENT_ERRORS.md records one called MEL at 99.2%). It is a tip and not a gate
   * because there are no hair-mask annotations to fit HAIR_ROI_MAX against, and removing the hair
   * for the user cost accuracy on exactly the hairy images (synth/eval/HAIR_REMOVAL.md). The scalp
   * gets its own wording: the fix there has to be the user parting it.
   */
  if (hairTip) {
    out.push(
      isHeadRegion(region)
        ? t('Tip: part the hair so the spot is fully visible, then retake.')
        : t('Tip: hair is covering the spot - move it aside and retake for a clearer read.'),
    );
  }
  return out;
}

/** Pulsing dot shown while a check is still pending. */
function PendingDot({ color, size = 12 }: { color: string; size?: number }) {
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 650 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
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
  thumbs: { flexDirection: 'row', justifyContent: 'center', gap: Space.md, marginTop: Space.base },
  thumb: { width: 48, height: 48, borderRadius: Radius.sm, overflow: 'hidden', borderWidth: 2, backgroundColor: '#1A1411' },
  thumbBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { alignItems: 'center', gap: Space.xs, paddingTop: Space.lg },
  center: { textAlign: 'center' },
  checklist: { marginTop: Space.lg, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base, paddingVertical: Space.base },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1 },
  reasons: { marginTop: Space.lg, gap: Space.xs, paddingHorizontal: Space.sm },
  reason: { textAlign: 'center' },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.sm, alignItems: 'center' },
  cta: { alignSelf: 'stretch', paddingVertical: Space.base },
  link: { paddingVertical: Space.sm },
});

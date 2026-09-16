import { t, useLocale } from '@/lib/i18n';
import { classifyDbError, type DbErrorKind } from '@/data/db';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Radius, Space } from '@/constants/theme';
import { useBlockAndroidBack } from '@/hooks/use-android-back';
import { useSurfaceWidth } from '@/hooks/use-surface-width';
import { useTheme } from '@/hooks/use-theme';
import { describeNonError } from '@/lib/classifier/errors';
import { useScanHistory } from '@/lib/scan-history';
import { useScreeningSession } from '@/lib/screening-session';
import {
  IMAGE_AGREEMENT_CHECK_ENABLED,
  MALIGNANT_THRESHOLD,
} from '@/lib/classifier/model-config';
import { RESCAN_PROMPT } from '@/lib/triage/recommendations';
import { decideAnalysis } from '@/lib/triage/scan-flow';
import {
  combineReadability,
  computeMalignantScore,
  computeTriage,
  evaluateImageAgreement,
  evaluateSafetyFloor,
  evaluateScaleConsistency,
} from '@/lib/triage/tps-core';
import type { ClassificationOutput, SymptomAnswers } from '@/lib/triage/types';

const MIN_BEAT_MS = 1500; // never flash the analyzing state, even when inference is already done
const STATUS_MS = 1400;

const STATUS_LINES = [
  'Reviewing your photo…',
  'Comparing with lesion patterns…',
  'Combining with your answers…',
];

type Stage = 'analyzing' | 'retake' | 'error';

/**
 * Diagnostic line for the error state: step + ClassifierError kind + message + cause.
 *
 * Shown to everyone, not just under isDebug(). The deployed web replica has no telemetry of any
 * kind, so this line is the ONLY channel a remote tester has for telling us what actually broke -
 * and "we couldn't save this screening" on its own sent us hunting the wrong cause for a week.
 * Non-Error rejections go through describeNonError because the web stack rejects with DOM objects
 * (Event, HTMLCanvasElement), which String() renders as a useless "[object Event]".
 */
function describeError(step: string, e: unknown): string {
  const kind = (e as { kind?: string })?.kind;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : describeNonError(e);
  const cause = e instanceof Error && e.cause ? ` ← ${String((e.cause as Error)?.message ?? e.cause)}` : '';
  return `${step}${kind ? `/${kind}` : ''}: ${msg}${cause}`;
}

/**
 * The decision point of the screening flow. Joins on the background classification,
 * runs the TPS engine, handles the Safety Floor Rule (first low-confidence pass →
 * non-alarming retake prompt; second → Moderate floor with a confidence qualifier),
 * persists the record, and hands off to the results screen.
 */
type PendingSave = Parameters<ReturnType<typeof useScanHistory>['addEntry']>[0];

/**
 * What to tell the user when the save failed, per cause.
 *
 * This screen used to show ONE message - "If SpotOn is open in another tab, close it and try
 * again" - for every save failure, because analysis.tsx called isDatabaseLockedOut() and threw the
 * answer away. A user whose session had expired, or whose disk was full, was told to close a tab
 * they did not have open. Each branch below now names a cause the user can actually act on; the
 * matching detection lives in data/db.ts classifyDbError, next to the code that emits each error.
 */
function describeSaveFailure(kind: DbErrorKind): { title: string; body: string } {
  switch (kind) {
    case 'locked':
      return {
        title: t("We couldn’t save this screening"),
        body: t("Another SpotOn tab or window is holding your data. Close the others, reload this page, and try again."),
      };
    case 'poisoned':
      return {
        title: t("We couldn’t save this screening"),
        body: t("This page lost its connection to SpotOn's storage. Reload the page and try again - the screenings you already have are safe."),
      };
    case 'full':
      return {
        title: t("Not enough space to save"),
        body: t("Your device is out of storage for SpotOn. Free up some space, or delete an older screening, then try again."),
      };
    case 'signed-out':
      return {
        title: t("Your session has ended"),
        body: t("Sign in again to save screenings to your history."),
      };
    default:
      return {
        title: t("We couldn’t save this screening"),
        body: t("The analysis finished, but saving it was interrupted. Your result is still here - try again."),
      };
  }
}

export default function AnalysisScreen() {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const width = useSurfaceWidth();
  const session = useScreeningSession();
  const { addEntry } = useScanHistory();

  const CARD = Math.min(width - Space.xl * 2, 216);

  const [stage, setStage] = useState<Stage>('analyzing');
  const [statusIdx, setStatusIdx] = useState(0);
  // Which step failed (ClassifierError kind + message + cause). Rendered in every build - see
  // describeError.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /**
   * Why the save failed, or null when the failure was in the analysis itself - very different
   * things for the user, and until now they rendered identically.
   */
  const [saveError, setSaveError] = useState<DbErrorKind | null>(null);
  /**
   * The TPS engine refused the answers. Only reachable if a question never got answered - a
   * follow-up carrying answers written by an older build, or a questionnaire left in a state the
   * gates missed - and it used to dead-end on "we couldn't save this screening", which is both
   * wrong and unfixable by the user. There is an obvious way out: go answer them.
   */
  const [answersIncomplete, setAnswersIncomplete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Snapshot the low-confidence output so "continue anyway" works even after
  // beginRescan clears the session's run state.
  const pendingOutput = useRef<ClassificationOutput | null>(null);
  /**
   * The fully-built record, kept so "Try again" re-runs the SAVE and nothing else. Re-running the
   * classifier for a storage failure costs the user another wait on a result we already have, and
   * on web it reloads a 30 MB model to answer a question that was never in doubt.
   */
  const pendingSave = useRef<PendingSave | null>(null);
  const finalized = useRef(false);

  useEffect(() => {
    if (stage !== 'analyzing') return;
    const id = setInterval(() => setStatusIdx((i) => Math.min(STATUS_LINES.length - 1, i + 1)), STATUS_MS);
    return () => clearInterval(id);
  }, [stage]);

  /**
   * Write the record, retrying the transient failures silently.
   *
   * The failure this backs off for is a collision with the background directory sync: it opens
   * eight transactions per page on the SAME SQLite connection, keeps running long after the user
   * leaves the Clinics tab, and used to make the screening save throw "cannot start a transaction
   * within a transaction". data/db.ts's withDbTransaction queue is the real fix; these two retries
   * cover what a queue in this process cannot reach (a second tab, a native SQLITE_BUSY).
   */
  async function attemptSave(payload: PendingSave): Promise<boolean> {
    const BACKOFF_MS = [150, 600];
    for (let attempt = 0; ; attempt++) {
      try {
        const entry = await addEntry(payload);
        session.reset();
        // `from: 'scan'` tells the result screen it is the END of a capture run rather than a row
        // someone tapped in a list. Back from here must LEAVE the flow - every screen underneath
        // (followup-confirm, capture, crop, quality, questionnaire) belongs to a session that has
        // just been reset, so popping into them shows empty states. See result.tsx `exitFlow`.
        router.replace({ pathname: '/scan/result', params: { id: entry.id, from: 'scan' } });
        return true;
      } catch (e) {
        const kind = classifyDbError(e);
        if ((kind === 'busy' || kind === 'locked') && attempt < BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
          continue;
        }
        // NOT the same failure as "we couldn't analyze": by this point classification has already
        // succeeded and only the save threw. Saying "something went wrong while analyzing ... your
        // answers are saved" was doubly wrong - nothing was wrong with the analysis, and the
        // answers were precisely what did not save.
        console.warn('[analysis] persist failed', e);
        setErrorDetail(describeError('persist', e));
        setSaveError(kind);
        setStage('error');
        return false;
      }
    }
  }

  async function finalize(output: ClassificationOutput, applyFloor: boolean) {
    if (finalized.current) return;
    finalized.current = true;
    const s = session; // captured pre-reset; reset() runs only after the record persists
    let payload: PendingSave;
    try {
      const triage = computeTriage(
        output.topClass,
        output.topConfidence,
        s.answers as SymptomAnswers,
        {
          applyFloor,
          malignantScore: computeMalignantScore(output.probs),
          malignantThreshold: MALIGNANT_THRESHOLD,
        },
      );
      payload = {
        // Minted here rather than inside addEntry so that a retry REPLACES this row instead of
        // minting a second screening (and a second tracked lesion) from the same photo and
        // answers - insertScreening is INSERT OR REPLACE, keyed on exactly this id.
        id: `scan-${Date.now()}`,
        // On a follow-up the lesion owns the location, so the user is never asked to re-place it.
        mark: s.followUp?.lesion.mark ?? s.bodyMark,
        imageUri: s.images[0]?.uri ?? s.imageUri ?? '',
        images: s.images.length ? s.images : undefined,
        source: s.source,
        questionnaire: {
          answers: s.answers as SymptomAnswers,
          completedAt: new Date().toISOString(),
        },
        classification: output,
        firstAttempt: s.firstAttempt ?? undefined,
        triage,
        // Null mints a new lesion in scan-history, so every screening is trackable without the
        // user having to opt in at scan time.
        lesionId: s.followUp?.lesion.id ?? null,
        followUpOf: s.followUp?.priorScreening.id,
        answersCarried: s.followUp != null,
        answersSourceId: s.followUp?.priorScreening.id,
      };
    } catch (e) {
      // computeTriage validates every input and throws on a bad one. That is a scoring failure,
      // not a storage failure, so it keeps the "we couldn't analyze" copy and a retry that really
      // does re-run the analysis.
      console.warn('[analysis] triage failed', e);
      finalized.current = false;
      setErrorDetail(describeError('triage', e));
      setAnswersIncomplete(e instanceof Error && /missing or invalid answer/i.test(e.message));
      setStage('error');
      return;
    }
    pendingSave.current = payload;
    await attemptSave(payload);
  }

  /** Retry the SAVE only. finalized stays true, so the analysing effect cannot re-enter. */
  async function retrySave() {
    const payload = pendingSave.current;
    if (!payload) return retryAfterError();
    setRetrying(true);
    setErrorDetail(null);
    try {
      await attemptSave(payload);
    } finally {
      setRetrying(false);
    }
  }

  /**
   * Nothing to analyse. The questionnaire now refuses to route here without a photo, so this is a
   * backstop for any other path that might: `getClassification()` would throw 'classification
   * never started', and the resulting error state is a trap - its "Try again" calls
   * `retryClassification`, which returns early on an empty URI list, and back is blocked on this
   * screen. Leaving instead of failing keeps the session (and the user's answers) alive.
   */
  useEffect(() => {
    if (session.images.length > 0 || session.imageUri) return;
    console.warn('[analysis] reached with no photo - returning to the capture step');
    if (router.canGoBack()) router.back();
    else router.replace(session.followUp ? '/scan/followup-confirm' : '/scan/body');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Join the background classification with the minimum animation beat.
  useEffect(() => {
    if (stage !== 'analyzing') return;
    let alive = true;
    const beat = new Promise((r) => setTimeout(r, MIN_BEAT_MS));
    (async () => {
      try {
        const [output] = await Promise.all([session.getClassification(), beat]);
        if (!alive) return;
        // Independent readability checks: confidence (Safety Floor), framing stability (scale
        // check), and cross-image agreement. Any one failing routes to a rescan, then to the
        // Moderate floor. The agreement check is off by default - it is recorded on every record
        // either way, but the measured flag-rate/accuracy trade did not justify the friction
        // (model-config IMAGE_AGREEMENT_CHECK_ENABLED, synth/eval/MULTIVIEW_EVAL.md).
        const verdict = combineReadability(
          evaluateSafetyFloor(output.topConfidence, session.attempt),
          evaluateScaleConsistency(output.scaleUnstable, session.attempt),
          IMAGE_AGREEMENT_CHECK_ENABLED
            ? evaluateImageAgreement(output.imageDisagreement ?? false, session.attempt)
            : 'ok',
        );
        const action = decideAnalysis({
          verdict,
          acceptedLowConfidence: session.acceptedLowConfidence,
        });
        if (action.kind === 'prompt-retake') {
          pendingOutput.current = output;
          setStage('retake');
        } else {
          await finalize(output, action.applyFloor);
        }
      } catch (e) {
        console.warn('[analysis] classification failed', e);
        await beat;
        if (alive) {
          setErrorDetail(describeError('classification', e));
          setStage('error');
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, session.attempt]);

  function retakeWithCamera() {
    session.beginRescan();
    router.replace('/scan/capture');
  }

  async function repickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    // Send to our crop screen (with the lesion-framing guide) rather than the OS cropper - a
    // too-wide rescan is exactly what got us here.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      session.beginRescan();
      router.replace({ pathname: '/scan/crop', params: { uri: result.assets[0].uri, source: 'gallery' } });
    }
  }

  function continueAnyway() {
    // User autonomy: accept the low-confidence photo. The Safety Floor applies now
    // (Moderate + confidence qualifier) and is recorded in the audit trail.
    if (pendingOutput.current) finalize(pendingOutput.current, true);
  }

  function retryAfterError() {
    setStatusIdx(0);
    setErrorDetail(null);
    setSaveError(null); // was never cleared, so a later analysis failure kept the save wording
    setAnswersIncomplete(false);
    setStage('analyzing');
    session.retryClassification();
  }

  /** `poisoned`: the page's database worker is unrecoverable in-process. Only a reload fixes it. */
  function reloadPage() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
    else retrySave();
  }

  function goSignIn() {
    session.reset();
    router.replace('/(auth)/login');
  }

  /** Back to the questionnaire with the run intact - the photo and classification are still good. */
  function goAnswerQuestions() {
    finalized.current = false;
    setStage('analyzing');
    router.replace('/scan/questionnaire');
  }

  function exitToHome() {
    session.reset();
    router.replace('/(tabs)/home');
  }

  // Android back is swallowed here, the same way `gestureEnabled: false` swallows the iOS swipe.
  // While analysing there is nothing valid to go back TO - the screens underneath belong to a run
  // that is mid-flight - and in the retake/error states the way out is one of this screen's own
  // buttons, each of which says what it discards. A silent pop would throw the photo and answers
  // away without asking.
  useBlockAndroidBack();

  /**
   * Title, body and primary action for the error state, in one place.
   *
   * `saveError == null` means the ANALYSIS failed, which is a different apology and a retry that
   * really does re-run the model. Everything else is a save failure, and each kind gets the one
   * instruction that can actually help - the whole point of this rewrite, since the screen used to
   * tell every user to close a second tab.
   */
  const failure: { title: string; body: string; cta: string; onPress: () => void } = answersIncomplete
    ? {
        title: t("A few answers are missing"),
        body: t("We need every question answered before we can score this screening. Your photo is still here."),
        cta: t("Answer the questions"),
        onPress: goAnswerQuestions,
      }
    : saveError
    ? {
        ...describeSaveFailure(saveError),
        cta: saveError === 'poisoned'
          ? t("Reload the page")
          : saveError === 'signed-out'
            ? t("Sign in")
            : t("Try again"),
        onPress: saveError === 'poisoned'
          ? reloadPage
          : saveError === 'signed-out'
            ? goSignIn
            : retrySave,
      }
    : {
        title: t("We couldn’t analyze this photo"),
        body: t("Something went wrong while analyzing on your device. Your answers are saved - you can try again, or come back later."),
        cta: t("Try again"),
        onPress: retryAfterError,
      };

  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [sweep]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (CARD - 56) }] }));

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <View style={styles.content}>
        {stage === 'analyzing' ? (
          <>
            <View style={[styles.card, { width: CARD, height: CARD, borderColor: 'rgba(255,255,255,0.9)' }]}>
              {session.imageUri ? (
                <Image source={{ uri: session.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
              <View style={styles.dim} pointerEvents="none" />
              <Animated.View style={[styles.beam, beamStyle]} pointerEvents="none">
                <LinearGradient
                  colors={['rgba(255,138,76,0)', 'rgba(255,138,76,0.45)', 'rgba(255,255,255,0.9)', 'rgba(255,138,76,0.45)', 'rgba(255,138,76,0)']}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
            {session.images.length > 1 ? (
              <View style={[styles.countChip, { backgroundColor: theme.elementBg }]}>
                <Icon name="square.stack.3d.up.fill" tintColor={theme.textSecondary} size={13} />
                <ThemedText type="caption" themeColor="textSecondary">
                  {session.images.length} {t("photos")}</ThemedText>
              </View>
            ) : null}
            <Animated.View key={statusIdx} entering={FadeIn} style={styles.header}>
              <ThemedText type="title2" style={styles.center}>
                {t("Analyzing")}</ThemedText>
              <ThemedText type="subhead" themeColor="textSecondary" style={styles.center}>
                {STATUS_LINES[statusIdx]}
              </ThemedText>
            </Animated.View>
          </>
        ) : stage === 'retake' ? (
          <Animated.View entering={FadeInDown} style={styles.stateWrap}>
            <IconCircle icon="camera.viewfinder" variant="tint" size={72} />
            <ThemedText type="title2" style={styles.center}>
              {RESCAN_PROMPT.title}
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.center}>
              {RESCAN_PROMPT.body}
            </ThemedText>
            <Card style={styles.tipCard}>
              {['Move to bright, even light', 'Get a little closer to the spot', 'Keep hair and clothing out of the way'].map((tip) => (
                <View key={tip} style={styles.tipRow}>
                  <Icon name="checkmark.circle.fill" tintColor={theme.riskLow} size={18} />
                  <ThemedText type="subhead" themeColor="textSecondary" style={styles.tipText}>
                    {tip}
                  </ThemedText>
                </View>
              ))}
            </Card>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown} style={styles.stateWrap}>
            <IconCircle icon="exclamationmark.triangle.fill" variant="tint" size={72} iconColor={theme.riskModerate} />
            <ThemedText type="title2" style={styles.center}>
              {failure.title}</ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.center}>
              {failure.body}</ThemedText>
            {errorDetail ? (
              <ThemedText type="footnote" themeColor="muted" style={styles.center} selectable>
                {errorDetail}
              </ThemedText>
            ) : null}
          </Animated.View>
        )}
      </View>

      {stage !== 'analyzing' ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          {stage === 'retake' ? (
            <>
              <Button
                label={session.source === 'gallery' ? RESCAN_PROMPT.repickCta : RESCAN_PROMPT.retakeCta}
                variant="brand"
                onPress={session.source === 'gallery' ? repickFromGallery : retakeWithCamera}
                style={styles.cta}
              />
              <Pressable hitSlop={10} onPress={continueAnyway} style={styles.secondary} accessibilityRole="button">
                <ThemedText type="headline" themeColor="textSecondary">
                  {RESCAN_PROMPT.continueCta}
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <Button
                label={failure.cta}
                variant="brand"
                loading={retrying}
                onPress={failure.onPress}
                style={styles.cta}
              />
              <Pressable hitSlop={10} onPress={exitToHome} style={styles.secondary} accessibilityRole="button">
                <ThemedText type="headline" themeColor="textSecondary">
                  {t("Back to home")}</ThemedText>
              </Pressable>
            </>
          )}
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xl, gap: Space.lg },
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    backgroundColor: '#1A1411',
  },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,13,0.18)' },
  beam: { position: 'absolute', left: 0, right: 0, top: 0, height: 56 },
  header: { alignItems: 'center', gap: Space.xs },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  center: { textAlign: 'center' },
  stateWrap: { alignItems: 'center', gap: Space.base },
  tipCard: { alignSelf: 'stretch', gap: Space.md, marginTop: Space.sm },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  tipText: { flex: 1 },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.sm, alignItems: 'center' },
  cta: { alignSelf: 'stretch' },
  secondary: { paddingVertical: Space.sm },
});

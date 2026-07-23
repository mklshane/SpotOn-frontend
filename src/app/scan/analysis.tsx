import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';
import { useScreeningSession } from '@/lib/screening-session';
import { MALIGNANT_THRESHOLD } from '@/lib/classifier/model-config';
import { RESCAN_PROMPT } from '@/lib/triage/recommendations';
import { computeMalignantScore, computeTriage, evaluateSafetyFloor } from '@/lib/triage/tps-core';
import type { ClassificationOutput, SymptomAnswers } from '@/lib/triage/types';

const MIN_BEAT_MS = 1500; // never flash the analyzing state, even when inference is already done
const STATUS_MS = 1400;

const STATUS_LINES = [
  'Reviewing your photo…',
  'Comparing with lesion patterns…',
  'Combining with your answers…',
];

type Stage = 'analyzing' | 'retake' | 'error';

/** Dev diagnostic line for the error state: step + ClassifierError kind + message + cause. */
function describeError(step: string, e: unknown): string {
  const kind = (e as { kind?: string })?.kind;
  const msg = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && e.cause ? ` ← ${String((e.cause as Error)?.message ?? e.cause)}` : '';
  return `[dev] ${step}${kind ? `/${kind}` : ''}: ${msg}${cause}`;
}

/**
 * The decision point of the screening flow. Joins on the background classification,
 * runs the TPS engine, handles the Safety Floor Rule (first low-confidence pass →
 * non-alarming retake prompt; second → Moderate floor with a confidence qualifier),
 * persists the record, and hands off to the results screen.
 */
export default function AnalysisScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const session = useScreeningSession();
  const { addEntry } = useScanHistory();

  const CARD = Math.min(width - Space.xl * 2, 216);

  const [stage, setStage] = useState<Stage>('analyzing');
  const [statusIdx, setStatusIdx] = useState(0);
  // Dev-only diagnostic: which step failed (ClassifierError kind + message + cause).
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Snapshot the low-confidence output so "continue anyway" works even after
  // beginRescan clears the session's run state.
  const pendingOutput = useRef<ClassificationOutput | null>(null);
  const finalized = useRef(false);

  useEffect(() => {
    if (stage !== 'analyzing') return;
    const id = setInterval(() => setStatusIdx((i) => Math.min(STATUS_LINES.length - 1, i + 1)), STATUS_MS);
    return () => clearInterval(id);
  }, [stage]);

  async function finalize(output: ClassificationOutput, applyFloor: boolean) {
    if (finalized.current) return;
    finalized.current = true;
    const s = session; // captured pre-reset; reset() runs only after the record persists
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
      const entry = await addEntry({
        mark: s.bodyMark,
        imageUri: s.imageUri ?? '',
        source: s.source,
        questionnaire: {
          answers: s.answers as SymptomAnswers,
          completedAt: new Date().toISOString(),
        },
        classification: output,
        firstAttempt: s.firstAttempt ?? undefined,
        triage,
      });
      s.reset();
      router.replace({ pathname: '/scan/result', params: { id: entry.id } });
    } catch (e) {
      console.warn('[analysis] persist failed', e);
      finalized.current = false;
      setErrorDetail(describeError('persist', e));
      setStage('error');
    }
  }

  // Join the background classification with the minimum animation beat.
  useEffect(() => {
    if (stage !== 'analyzing') return;
    let alive = true;
    const beat = new Promise((r) => setTimeout(r, MIN_BEAT_MS));
    (async () => {
      try {
        const [output] = await Promise.all([session.getClassification(), beat]);
        if (!alive) return;
        const verdict = evaluateSafetyFloor(output.topConfidence, session.attempt);
        if (verdict === 'ok') {
          await finalize(output, false);
        } else if (verdict === 'prompt-rescan') {
          pendingOutput.current = output;
          setStage('retake');
        } else {
          await finalize(output, true); // second low-confidence pass → Moderate floor
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      session.beginRescan();
      router.replace({ pathname: '/scan/quality', params: { uri: result.assets[0].uri } });
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
    setStage('analyzing');
    session.retryClassification();
  }

  function exitToHome() {
    session.reset();
    router.replace('/(tabs)/home');
  }

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
            <Animated.View key={statusIdx} entering={FadeIn} style={styles.header}>
              <ThemedText type="title2" style={styles.center}>
                Analyzing
              </ThemedText>
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
              We couldn’t analyze this photo
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.center}>
              Something went wrong while analyzing on your device. Your answers are saved — you can
              try again, or come back later.
            </ThemedText>
            {__DEV__ && errorDetail ? (
              <ThemedText type="footnote" themeColor="muted" style={styles.center}>
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
              <Button label="Try again" variant="brand" onPress={retryAfterError} style={styles.cta} />
              <Pressable hitSlop={10} onPress={exitToHome} style={styles.secondary} accessibilityRole="button">
                <ThemedText type="headline" themeColor="textSecondary">
                  Back to home
                </ThemedText>
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
  center: { textAlign: 'center' },
  stateWrap: { alignItems: 'center', gap: Space.base },
  tipCard: { alignSelf: 'stretch', gap: Space.md, marginTop: Space.sm },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  tipText: { flex: 1 },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.sm, alignItems: 'center' },
  cta: { alignSelf: 'stretch' },
  secondary: { paddingVertical: Space.sm },
});

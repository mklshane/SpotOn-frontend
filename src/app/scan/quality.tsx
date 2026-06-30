import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import { assessImage, type IqaResult } from '@/lib/image-quality';
import { useScanDraft } from '@/lib/scan-draft';
import { useScanHistory } from '@/lib/scan-history';

const STEP_MS = 1300; // per-check reveal cadence
const PROCEED_MS = 850; // beat before auto-advancing on a clean pass

type RowStatus = 'pending' | 'ok' | 'warn';
type Row = { label: string; icon: IconName; ok: (r: IqaResult) => boolean };

const ROWS: Row[] = [
  { label: 'Lighting', icon: 'sun.max', ok: (r) => r.brightness.ok },
  { label: 'Focus', icon: 'camera.viewfinder', ok: (r) => r.sharpness.ok },
  { label: 'Lesion in frame', icon: 'sparkles', ok: (r) => r.lesion.found },
];

export default function QualityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const { bodyMark, reset } = useScanDraft();
  const { addEntry } = useScanHistory();

  const CARD = Math.min(width - Space.xl * 2, 216);

  const [step, setStep] = useState(0);
  const [result, setResult] = useState<IqaResult | null>(null);
  const [error, setError] = useState(false);
  const proceeded = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!uri) {
      setError(true);
      return;
    }
    assessImage(uri)
      .then((r) => alive && setResult(r))
      .catch((e) => {
        console.warn('[iqa] failed', e);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [uri]);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(ROWS.length, s + 1)), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const settled = result != null || error;
  const analyzing = step < ROWS.length || !settled;
  const pass = !error && result?.pass === true;
  const reasons = error ? ['We couldn’t analyze this photo.'] : (result?.reasons ?? []);

  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [sweep]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (CARD - 56) }] }));

  function proceed() {
    if (proceeded.current) return;
    proceeded.current = true;
    if (bodyMark) {
      const entry = addEntry({ mark: bodyMark, imageUri: uri });
      reset();
      router.replace({ pathname: '/scan/result', params: { id: entry.id } });
    } else {
      reset();
      router.replace('/(tabs)/home');
    }
  }

  function retake() {
    router.back();
  }

  useEffect(() => {
    if (!analyzing && pass) {
      const t = setTimeout(proceed, PROCEED_MS);
      return () => clearTimeout(t);
    }
  }, [analyzing, pass]); // eslint-disable-line react-hooks/exhaustive-deps

  function statusFor(i: number): RowStatus {
    const ready = step > i && settled;
    if (!ready) return 'pending';
    if (error) return 'warn';
    return result && ROWS[i].ok(result) ? 'ok' : 'warn';
  }

  const title = analyzing ? 'Analyzing your photo' : pass ? 'Looks great' : 'A few things to check';
  const subtitle = analyzing
    ? 'Scanning lighting, focus and skin…'
    : pass
      ? 'Preparing your result…'
      : 'You can still continue if you’d like';

  const rows = useMemo(() => ROWS.map((r, i) => ({ ...r, status: statusFor(i) })), [step, settled, error, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameColor = analyzing ? 'rgba(255,255,255,0.9)' : pass ? theme.riskLow : theme.riskModerate;
  const showFooter = !analyzing && !pass;

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
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
            <Animated.View
              entering={ZoomIn.springify().damping(12)}
              style={[styles.resultBadge, { backgroundColor: pass ? theme.riskLow : theme.riskModerate }]}>
              <Icon name={pass ? 'checkmark' : 'exclamationmark.triangle.fill'} tintColor="#FFFFFF" size={32} />
            </Animated.View>
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

      {showFooter ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Button label="Use anyway" variant="brand" onPress={proceed} style={styles.useAnyway} />
          <Pressable hitSlop={10} onPress={retake} style={styles.retake} accessibilityRole="button">
            <ThemedText type="headline" themeColor="brand">
              Retake or choose another
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
  resultBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -30,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  useAnyway: { alignSelf: 'stretch' },
  retake: { paddingVertical: Space.sm },
});

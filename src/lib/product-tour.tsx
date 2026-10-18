import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dots } from '@/components/ui/dots';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, useLocale } from './i18n';
import { markProductTourSeen } from './product-tour-storage';

type TargetId = 'scanTab' | 'directoryTab' | 'learnTab' | 'profileTab';
type TourOrigin = 'first-run' | 'settings';
type TourSession = { userId: string; origin: TourOrigin; step: number };
type TourStep = { route: '/home' | '/directory' | '/learn' | '/profile'; target: TargetId | null; title: string; body: string; icon: IconName };

const STEPS: TourStep[] = [
  {
    route: '/home', target: null, icon: 'sparkles',
    title: 'Welcome to your SpotOn tour',
    body: 'A quick look at where to screen a spot, find care, learn, and review your activity. You can skip anytime.',
  },
  {
    route: '/home', target: 'scanTab', icon: 'camera.viewfinder',
    title: 'Start with a spot',
    body: 'Tap Scan or the large Home card to start. SpotOn guides you through a clear photo and gives on-device triage, not a diagnosis.',
  },
  {
    route: '/directory', target: 'directoryTab', icon: 'building.2',
    title: 'Find care nearby',
    body: 'Search for dermatology clinics and doctors. Saved directory information is also available offline.',
  },
  {
    route: '/learn', target: 'learnTab', icon: 'book',
    title: 'Learn at your pace',
    body: 'Read short guides on warning signs, skin care, and when to seek help.',
  },
  {
    route: '/profile', target: 'profileTab', icon: 'person',
    title: 'Everything in one place',
    body: 'Find your screening history, saved dermatologists, and Settings here. You can replay this tour from Settings anytime.',
  },
];

type TourContextValue = {
  session: TourSession | null;
  targetEpoch: number;
  startFirstRun: (userId: string) => void;
  startReplay: (userId: string) => void;
  next: () => void;
  back: () => void;
  dismiss: () => void;
  registerTarget: (id: TargetId, ref: View | null) => void;
  refreshTarget: () => void;
  getTarget: (id: TargetId) => View | null;
};

const TourContext = createContext<TourContextValue | null>(null);

export function ProductTourProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<TourSession | null>(null);
  const [targetEpoch, setTargetEpoch] = useState(0);
  const targets = useRef(new Map<TargetId, View>());

  const registerTarget = useCallback((id: TargetId, ref: View | null) => {
    if (ref) targets.current.set(id, ref);
    else targets.current.delete(id);
    setTargetEpoch((value) => value + 1);
  }, []);
  const refreshTarget = useCallback(() => setTargetEpoch((value) => value + 1), []);
  const getTarget = useCallback((id: TargetId) => targets.current.get(id) ?? null, []);

  const startFirstRun = useCallback((userId: string) => {
    setSession((current) => current ?? { userId, origin: 'first-run', step: 0 });
  }, []);
  const startReplay = useCallback((userId: string) => {
    setSession({ userId, origin: 'settings', step: 0 });
    router.replace('/home');
  }, []);
  const move = useCallback((direction: 1 | -1) => {
    if (!session) return;
    const nextStep = Math.max(0, Math.min(STEPS.length - 1, session.step + direction));
    if (nextStep === session.step) return;
    setSession({ ...session, step: nextStep });
    if (STEPS[nextStep].route !== STEPS[session.step].route) {
      router.replace(STEPS[nextStep].route);
    }
  }, [session]);
  const dismiss = useCallback(() => {
    if (!session) return;
    if (session.origin === 'first-run') {
      void markProductTourSeen(session.userId).catch((e) =>
        console.warn('[tour] could not save dismissal:', e),
      );
    }
    setSession(null);
    router.replace(session.origin === 'settings' ? '/profile/settings' : '/home');
  }, [session]);
  const next = useCallback(() => {
    if (session?.step === STEPS.length - 1) dismiss();
    else move(1);
  }, [dismiss, move, session?.step]);
  const back = useCallback(() => {
    if (session?.step === 0) dismiss();
    else move(-1);
  }, [dismiss, move, session?.step]);

  const value = useMemo(() => ({
    session, targetEpoch, startFirstRun, startReplay, next, back, dismiss,
    registerTarget, refreshTarget, getTarget,
  }), [session, targetEpoch, startFirstRun, startReplay, next, back, dismiss, registerTarget, refreshTarget, getTarget]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useProductTour() {
  const context = useContext(TourContext);
  if (!context) throw new Error('useProductTour must be used within ProductTourProvider');
  return context;
}

/** Wrap a real control without changing its touch handling. The overlay measures this view. */
export function TourTarget({ id, children, style }: { id: TargetId; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { registerTarget, refreshTarget } = useProductTour();
  const ref = useRef<View>(null);
  useEffect(() => {
    registerTarget(id, ref.current);
    return () => registerTarget(id, null);
  }, [id, registerTarget]);
  const onLayout = useCallback((_event: LayoutChangeEvent) => refreshTarget(), [refreshTarget]);
  return <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>{children}</View>;
}

type Rect = { x: number; y: number; width: number; height: number };
const DIM = 'rgba(33, 26, 21, 0.62)';

export function ProductTourOverlay() {
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { session, targetEpoch, getTarget, next, back, dismiss } = useProductTour();
  const overlayRef = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [measurement, setMeasurement] = useState<{ key: string; rect: Rect | null; fallback: boolean } | null>(null);
  const [cardHeight, setCardHeight] = useState(250);
  const step = session ? STEPS[session.step] : null;
  const onRoute = Boolean(step && pathname === step.route);
  const measureKey = session ? `${session.userId}:${session.origin}:${session.step}` : '';
  const rect = measurement?.key === measureKey ? measurement.rect : null;
  const fallback = measurement?.key === measureKey ? measurement.fallback : false;

  useEffect(() => {
    if (onRoute && step) {
      AccessibilityInfo.announceForAccessibility(`${t(step.title)}. ${t(step.body)}`);
    }
  }, [session?.step, onRoute, locale, step]);

  useEffect(() => {
    if (!session) return;
    const handler = () => { back(); return true; };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); back(); }
    };
    if (Platform.OS === 'web') document.addEventListener('keydown', onKeyDown);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('keydown', onKeyDown);
    };
  }, [session, back]);

  useEffect(() => {
    if (!onRoute || !step?.target) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const target = getTarget(step.target!);
      if (!target || !overlayRef.current) return;
      overlayRef.current.measureInWindow((overlayX, overlayY) => {
        target.measureInWindow((x, y, width, height) => {
          if (cancelled || width <= 0 || height <= 0) return;
          setMeasurement({
            key: measureKey,
            rect: step.target === 'scanTab'
              ? { x: x - overlayX, y: y - overlayY - Space.xxl, width, height: height + Space.xxl }
              : { x: x - overlayX, y: y - overlayY, width, height },
            fallback: false,
          });
        });
      });
    });
    const timeout = setTimeout(() => {
      if (!cancelled) setMeasurement((current) => current?.key === measureKey && current.rect
        ? current : { key: measureKey, rect: null, fallback: true });
    }, 500);
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, [measureKey, step?.target, onRoute, targetEpoch, getTarget, size.width, size.height]);

  if (!session || !step || !onRoute) return null;
  const pad = Space.sm;
  const spot = rect && rect.x < size.width && rect.y < size.height && rect.x + rect.width > 0 && rect.y + rect.height > 0
    ? {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        width: Math.min(size.width, rect.x + rect.width + pad) - Math.max(0, rect.x - pad),
        height: Math.min(size.height, rect.y + rect.height + pad) - Math.max(0, rect.y - pad),
      }
    : null;
  if (step.target && !spot && !fallback) {
    return <View ref={overlayRef} style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} onLayout={(e) => setSize(e.nativeEvent.layout)} />;
  }

  const gap = Space.base;
  const topLimit = insets.top + Space.base;
  const bottomLimit = size.height - insets.bottom - Space.base;
  const centered = Math.max(topLimit, (size.height - cardHeight) / 2);
  const below = spot ? spot.y + spot.height + gap : centered;
  const above = spot ? spot.y - cardHeight - gap : centered;
  const cardTop = spot
    ? (below + cardHeight <= bottomLimit ? below : above >= topLimit ? above : centered)
    : centered;
  const cardWidth = Math.min(440, Math.max(0, size.width - Space.xl * 2));
  const cardLeft = (size.width - cardWidth) / 2;

  return (
    <View
      ref={overlayRef}
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      accessibilityViewIsModal
      importantForAccessibility="yes">
      {spot ? (
        <>
          <View style={[styles.dim, { left: 0, top: 0, width: size.width, height: spot.y }]} />
          <View style={[styles.dim, { left: 0, top: spot.y, width: spot.x, height: spot.height }]} />
          <View style={[styles.dim, { left: spot.x + spot.width, top: spot.y, width: size.width - spot.x - spot.width, height: spot.height }]} />
          <View style={[styles.dim, { left: 0, top: spot.y + spot.height, width: size.width, height: size.height - spot.y - spot.height }]} />
          <View style={[styles.spot, { left: spot.x, top: spot.y, width: spot.width, height: spot.height, borderColor: theme.brandBright }]} />
        </>
      ) : <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />}
      <Card
        padded={false}
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={[styles.card, { left: cardLeft, top: cardTop, width: cardWidth, maxHeight: Math.max(0, size.height - insets.top - insets.bottom - Space.xxl) }]}
        accessibilityLiveRegion="polite">
        <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <View style={styles.eyebrow}>
              <Icon name={step.icon} tintColor={theme.brand} size={16} />
              <ThemedText type="caption" themeColor="brand" style={styles.eyebrowText}>{t('PRODUCT TOUR')}</ThemedText>
            </View>
            <Button label={t('Skip')} accessibilityLabel={t('Skip tour')} variant="ghost" onPress={dismiss} style={styles.skipButton} />
          </View>
          <ThemedText type="title2" accessibilityRole="header">{t(step.title)}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">{t(step.body)}</ThemedText>
          <View style={styles.bottomRow}>
            <Dots count={STEPS.length} activeIndex={session.step} />
            <ThemedText type="caption" themeColor="muted">{session.step + 1} / {STEPS.length}</ThemedText>
          </View>
          <View style={[styles.actions, size.width < 375 && styles.actionsCompact]}>
            {session.step > 0 ? <Button label={t('Back')} variant="outline" onPress={back} style={[styles.backButton, size.width < 375 && styles.fullButton]} /> : null}
            <Button label={session.step === STEPS.length - 1 ? t('Finish tour') : t('Next')} onPress={next} style={[styles.nextButton, size.width < 375 && styles.fullButton]} />
          </View>
        </ScrollView>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: DIM },
  spot: { position: 'absolute', borderWidth: 2, borderRadius: Radius.lg, backgroundColor: 'transparent' },
  card: { position: 'absolute' },
  cardContent: { padding: Space.xl, gap: Space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  eyebrowText: { fontWeight: '700', letterSpacing: 0.6 },
  skipButton: { height: 44, paddingHorizontal: Space.sm },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.xs },
  actions: { flexDirection: 'row', gap: Space.sm },
  actionsCompact: { flexDirection: 'column-reverse' },
  fullButton: { flex: undefined },
  backButton: { flex: 1 },
  nextButton: { flex: 2 },
});

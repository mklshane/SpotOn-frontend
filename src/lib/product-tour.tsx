import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { CoachMarkOverlay, IntroCard, type CoachStep } from '@/components/tour/coach-mark';
import { TabContentInset } from '@/components/ui/tab-bar';
import { markProductTourSeen } from './product-tour-storage';

/** Any element a tour can spotlight: the app tour's ids and the scan tips' ids share one registry. */
export type TargetId = string;
type TourOrigin = 'first-run' | 'settings';
/**
 * `dir` is the way the user last moved, so a skipped optional step keeps going the same way;
 * `skipped` drops those steps from the progress count.
 */
type TourSession = { userId: string; origin: TourOrigin; step: number; dir: 1 | -1; skipped: number[] };
type TourStep = CoachStep & { route: '/home' | '/directory' | '/learn' | '/profile' };

const STEPS: TourStep[] = [
  {
    route: '/home', target: null, intro: true, icon: 'sparkles',
    title: 'Welcome to SpotOn',
    body: "Let's take a quick look at where to check a spot, find a dermatologist, and learn what to watch for.",
  },
  {
    route: '/home', target: 'homeScanCard', shape: 'card', icon: 'camera.viewfinder',
    title: 'Check a spot',
    body: "Take a guided photo and get an on-device triage. It doesn't give a diagnosis.",
  },
  {
    route: '/home', target: 'homeConditions', shape: 'card', optional: true, icon: 'sun.max',
    title: "Today's UV",
    body: 'Live UV and temperature, with sun-safety tips.',
  },
  {
    route: '/home', target: 'scanTab', shape: 'circle', inBottomBand: true, icon: 'camera.viewfinder',
    title: 'Scan from anywhere',
    body: 'This button opens the camera from any tab.',
  },
  {
    route: '/directory', target: 'directorySearch', shape: 'card', icon: 'magnifyingglass',
    title: 'Find a dermatologist',
    body: "Search clinics or doctors near you. Results you've loaded also work offline.",
  },
  {
    route: '/learn', target: 'learnFeatured', shape: 'card', icon: 'book',
    title: 'Learn the warning signs',
    body: 'Short guides you can read offline.',
  },
  {
    route: '/profile', target: 'profileBodyMap', shape: 'card', icon: 'figure.stand',
    title: 'Your spots on a 3D body',
    body: 'Every screening is pinned to where it is on your body.',
  },
];

type TourContextValue = {
  session: TourSession | null;
  targetEpoch: number;
  startFirstRun: (userId: string) => void;
  startReplay: (userId: string) => void;
  next: () => void;
  back: () => void;
  skipStep: () => void;
  dismiss: () => void;
  /** Returns the unregister function. An id can have several views (e.g. a header shared by two panes). */
  registerTarget: (id: TargetId, view: View) => () => void;
  refreshTarget: () => void;
  getTargets: (id: TargetId) => View[];
};

const TourContext = createContext<TourContextValue | null>(null);

export function ProductTourProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<TourSession | null>(null);
  const [targetEpoch, setTargetEpoch] = useState(0);
  const targets = useRef(new Map<TargetId, Set<View>>());

  const registerTarget = useCallback((id: TargetId, view: View) => {
    const views = targets.current.get(id) ?? new Set<View>();
    views.add(view);
    targets.current.set(id, views);
    setTargetEpoch((value) => value + 1);
    return () => {
      views.delete(view);
      if (!views.size) targets.current.delete(id);
      setTargetEpoch((value) => value + 1);
    };
  }, []);
  const refreshTarget = useCallback(() => setTargetEpoch((value) => value + 1), []);
  const getTargets = useCallback((id: TargetId) => [...(targets.current.get(id) ?? [])], []);

  const startFirstRun = useCallback((userId: string) => {
    setSession((current) => current ?? { userId, origin: 'first-run', step: 0, dir: 1, skipped: [] });
  }, []);
  const startReplay = useCallback((userId: string) => {
    setSession({ userId, origin: 'settings', step: 0, dir: 1, skipped: [] });
    router.replace('/home');
  }, []);
  const move = useCallback((direction: 1 | -1, skip = false) => {
    if (!session) return;
    const nextStep = Math.max(0, Math.min(STEPS.length - 1, session.step + direction));
    if (nextStep === session.step) return;
    const skipped = skip ? [...session.skipped, session.step] : session.skipped;
    setSession({ ...session, step: nextStep, dir: direction, skipped });
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
  const skipStep = useCallback(() => {
    if (!session) return;
    const atEnd = session.dir === 1 ? session.step === STEPS.length - 1 : session.step === 0;
    if (atEnd) dismiss();
    else move(session.dir, true);
  }, [dismiss, move, session]);

  const value = useMemo(() => ({
    session, targetEpoch, startFirstRun, startReplay, next, back, skipStep, dismiss,
    registerTarget, refreshTarget, getTargets,
  }), [session, targetEpoch, startFirstRun, startReplay, next, back, skipStep, dismiss, registerTarget, refreshTarget, getTargets]);

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
  useEffect(() => (ref.current ? registerTarget(id, ref.current) : undefined), [id, registerTarget]);
  const onLayout = useCallback((_event: LayoutChangeEvent) => refreshTarget(), [refreshTarget]);
  return <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>{children}</View>;
}

export function ProductTourOverlay() {
  const pathname = usePathname();
  const { session, targetEpoch, getTargets, next, back, skipStep, dismiss } = useProductTour();
  const step = session ? STEPS[session.step] : null;
  if (!session || !step || pathname !== step.route) return null;

  // Count only the stops that will show: not the intro, and not optional ones without a target.
  const counted = STEPS.flatMap((s, i) =>
    s.intro || session.skipped.includes(i) || (s.optional && s.target && !getTargets(s.target).length) ? [] : [i]);

  return (
    <CoachMarkOverlay
      step={step}
      stepKey={`${session.userId}:${session.origin}:${session.step}`}
      progress={{ index: Math.max(0, counted.indexOf(session.step)), count: counted.length }}
      canGoBack={session.step > 0}
      isLast={session.step === STEPS.length - 1}
      doneLabel="Done"
      bottomBand={TabContentInset}
      getTargets={getTargets}
      targetEpoch={targetEpoch}
      onNext={next}
      onBack={back}
      onDismiss={dismiss}
      onSkipMissing={skipStep}
      renderIntro={(layout) => (
        <IntroCard
          {...layout}
          art={require('@/assets/images/tour/welcome.svg')}
          artRatio={1.8}
          title={step.title}
          body={step.body}
          startLabel="Start tour"
          skipLabel="Not now"
          skipAccessibilityLabel="Skip tour"
          onStart={next}
          onSkip={dismiss}
        />
      )}
    />
  );
}

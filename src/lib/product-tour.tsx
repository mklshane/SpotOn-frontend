import { router, useFocusEffect, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView,
  type StyleProp, type ViewStyle,
} from 'react-native';

import { CoachMarkOverlay, IntroCard, type CoachStep } from '@/components/tour/coach-mark';
import { TabContentInset } from '@/components/ui/tab-bar';
import { useAuth } from './auth';
import { markProductTourSeen } from './product-tour-storage';

/** Any element a tour can spotlight: the app tour's ids and the scan tips' ids share one registry. */
export type TargetId = string;
type TourOrigin = 'first-run' | 'settings';
/**
 * `dir` is the way the user last moved, so a skipped optional step keeps going the same way;
 * `skipped` drops those steps from the progress count.
 */
type TourSession = { userId: string; origin: TourOrigin; step: number; dir: 1 | -1; skipped: number[] };
type TourRoute = '/home' | '/directory' | '/learn' | '/profile' | typeof SETTINGS;
type TourUser = ReturnType<typeof useAuth>['user'];
/** `shownIf` drops a step up front, instead of waiting out the missing-target timeout on screen. */
type TourStep = CoachStep & { route: TourRoute; shownIf?: (user: TourUser) => boolean };
/** The one stop outside the tabs. It is pushed over them, so its overlay lives in the profile stack. */
const SETTINGS = '/profile/settings';

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
  {
    // The row only exists when the server has research sharing on for this account.
    route: SETTINGS, target: 'settingsResearch', shape: 'card', optional: true, icon: 'person.2.fill',
    shownIf: (user) => user?.research_sharing_enabled === true,
    title: 'Help improve SpotOn',
    body: "Off unless you turn it on. When it's on, each new scan shares a small cropped photo of the spot with your age range, sex, skin type, body area, answers and result, never your name, face or location. Turn it off anytime and your shared photos are deleted.",
  },
  {
    route: SETTINGS, target: 'settingsBackup', shape: 'card', icon: 'arrow.up.doc.fill',
    title: 'Back up your screenings',
    body: 'Screenings and photos are saved only on this phone. Back up my data puts them in a file locked with a password you choose, then you save it to Files, Drive or email. Restore from a backup adds them back on any phone.',
  },
  {
    route: SETTINGS, target: 'settingsDelete', shape: 'card', icon: 'trash.fill',
    title: 'Delete your account',
    body: "Removes your account and any photos you shared for research from our server, and erases the history on this phone. It can't be undone, so back up first. You'll be asked to confirm.",
  },
];

/**
 * Settings is pushed over the tabs and popped back to them, so its Back button still works when
 * the tour ends there. Tab-to-tab moves replace, as before.
 */
function goTo(from: TourRoute | null, to: TourRoute) {
  if (from === to) return;
  if (to === SETTINGS) router.push(SETTINGS);
  else if (from === SETTINGS && router.canDismiss()) router.dismissTo(to);
  else router.replace(to);
}

/** Scrolls the focused screen's content by `dy`; returns false if it can't. */
type Scroller = (dy: number) => boolean;

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
  isShown: (step: number) => boolean;
  /** Returns the unregister function. */
  registerScroller: (scroller: Scroller) => () => void;
  scrollBy: Scroller;
};

const TourContext = createContext<TourContextValue | null>(null);

export function ProductTourProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [session, setSession] = useState<TourSession | null>(null);
  const isShown = useCallback((step: number) => STEPS[step].shownIf?.(user) ?? true, [user]);
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
  const scroller = useRef<Scroller | null>(null);
  const registerScroller = useCallback((next: Scroller) => {
    scroller.current = next;
    return () => { if (scroller.current === next) scroller.current = null; };
  }, []);
  const scrollBy = useCallback((dy: number) => scroller.current?.(dy) ?? false, []);

  const startFirstRun = useCallback((userId: string) => {
    setSession((current) => current ?? { userId, origin: 'first-run', step: 0, dir: 1, skipped: [] });
  }, []);
  const startReplay = useCallback((userId: string) => {
    setSession({ userId, origin: 'settings', step: 0, dir: 1, skipped: [] });
    goTo(SETTINGS, '/home');
  }, []);
  const move = useCallback((direction: 1 | -1, skip = false) => {
    if (!session) return;
    let nextStep = session.step + direction;
    while (nextStep >= 0 && nextStep < STEPS.length && !isShown(nextStep)) nextStep += direction;
    if (nextStep < 0 || nextStep >= STEPS.length) return;
    const skipped = skip ? [...session.skipped, session.step] : session.skipped;
    setSession({ ...session, step: nextStep, dir: direction, skipped });
    goTo(STEPS[session.step].route, STEPS[nextStep].route);
  }, [isShown, session]);
  const dismiss = useCallback(() => {
    if (!session) return;
    if (session.origin === 'first-run') {
      void markProductTourSeen(session.userId).catch((e) =>
        console.warn('[tour] could not save dismissal:', e),
      );
    }
    setSession(null);
    goTo(STEPS[session.step].route, session.origin === 'settings' ? SETTINGS : '/home');
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
    registerTarget, refreshTarget, getTargets, isShown, registerScroller, scrollBy,
  }), [session, targetEpoch, startFirstRun, startReplay, next, back, skipStep, dismiss, registerTarget, refreshTarget, getTargets, isShown, registerScroller, scrollBy]);

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

/**
 * Lets the tour scroll this screen's ScrollView to a target below the fold. Spread the result
 * onto the ScrollView: `<ScrollView {...useProductTourScroller()}>`.
 */
export function useProductTourScroller() {
  const { registerScroller } = useProductTour();
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  useFocusEffect(
    useCallback(() => registerScroller((dy) => {
      if (!ref.current) return false;
      ref.current.scrollTo({ y: Math.max(0, offset.current + dy), animated: true });
      return true;
    }), [registerScroller]),
  );
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  return { ref, onScroll, scrollEventThrottle: 32 };
}

/** True while the tour is showing a step on Settings, so the profile stack can hide its content from a11y. */
export function useTourOnSettings() {
  const { session } = useProductTour();
  return session ? STEPS[session.step].route === SETTINGS : false;
}

/**
 * `scope` says which layout this copy is mounted in: the tabs draw the tab-route steps, and the
 * profile stack draws the Settings ones (the tabs' copy would sit under the pushed screen).
 */
export function ProductTourOverlay({ scope }: { scope: 'tabs' | 'settings' }) {
  const pathname = usePathname();
  const { session, targetEpoch, getTargets, isShown, next, back, skipStep, dismiss, scrollBy } = useProductTour();
  const step = session ? STEPS[session.step] : null;
  if (!session || !step || pathname !== step.route) return null;
  const onSettings = step.route === SETTINGS;
  if (onSettings !== (scope === 'settings')) return null;

  // Count only the stops that will show: not the intro, and not optional ones without a target.
  const counted = STEPS.flatMap((s, i) =>
    s.intro || !isShown(i) || session.skipped.includes(i) || (s.optional && s.target && !getTargets(s.target).length) ? [] : [i]);

  return (
    <CoachMarkOverlay
      step={step}
      stepKey={`${session.userId}:${session.origin}:${session.step}`}
      progress={{ index: Math.max(0, counted.indexOf(session.step)), count: counted.length }}
      canGoBack={session.step > 0}
      isLast={session.step === STEPS.length - 1}
      doneLabel="Done"
      bottomBand={onSettings ? 0 : TabContentInset}
      getTargets={getTargets}
      targetEpoch={targetEpoch}
      onNext={next}
      onBack={back}
      onDismiss={dismiss}
      onSkipMissing={skipStep}
      onOffscreen={onSettings ? scrollBy : undefined}
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

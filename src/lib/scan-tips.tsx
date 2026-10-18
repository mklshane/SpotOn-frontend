import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CoachMarkOverlay, IntroCard, type CoachStep } from '@/components/tour/coach-mark';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from './auth';
import { t } from './i18n';
import { useProductTour } from './product-tour';
import { markScanTipsSeen, readSeenScanTips } from './product-tour-storage';

/**
 * First-visit tips for the screening flow. A camera flow can't be toured end to end the way the
 * tabs can - each screen needs a real photo from the one before - so each screen explains its own
 * key controls the first time it's reached, and the body picker opens with an overview of the
 * whole flow. Analysis (auto-advances) and Instructions (already a tutorial) have none.
 */
export type ScanTipsId =
  | 'body'
  | 'capture'
  | 'crop'
  | 'cropPick'
  | 'review'
  | 'quality'
  | 'questionnaire'
  | 'result'
  | 'report'
  | 'lesion';

const TIP_SETS: Record<ScanTipsId, CoachStep[]> = {
  body: [
    {
      target: null, intro: true, icon: 'sparkles',
      title: 'How a screening works',
      body: 'Four short steps. We will point out what matters as you go.',
    },
    {
      target: 'scanBodyViewer', shape: 'card', icon: 'figure.stand',
      title: 'Mark where the spot is',
      body: 'Turn the body with one finger and pinch to zoom, then tap the place where your spot is.',
    },
    {
      target: 'scanBodyFooter', shape: 'card', icon: 'arrow.right.circle.fill',
      title: 'Then choose your photo',
      body: "Tap Next, then take a new photo or upload one you already have. Not sure where the spot is? Tap Skip.",
    },
  ],
  capture: [
    {
      target: 'captureShutter', shape: 'circle', icon: 'camera.fill',
      title: 'Get close, then tap',
      body: 'Fill the frame with the spot, in good light. If the phone is moving, SpotOn waits a moment for it to steady.',
    },
    {
      target: 'captureUpload', shape: 'circle', optional: true, icon: 'photo.on.rectangle',
      title: 'Or upload one',
      body: 'Already have a photo of the spot? Tap here to use it instead.',
    },
    {
      target: 'captureGuide', shape: 'card', optional: true, icon: 'camera.viewfinder',
      title: 'Spot guide',
      body: 'Turn this on to see a box around the spot SpotOn finds.',
    },
    {
      target: 'captureInstructions', shape: 'pill', optional: true, icon: 'book',
      title: 'Photo tips',
      body: 'Open these anytime for a quick refresher on taking a clear photo.',
    },
  ],
  crop: [
    {
      target: 'cropRing', shape: 'circle', icon: 'plus.viewfinder',
      title: 'Fill the circle',
      body: 'Pinch and drag the photo until the spot fills the circle. That is the size the check reads best.',
    },
    {
      target: 'cropUse', shape: 'pill', icon: 'checkmark.circle.fill',
      title: 'Happy with it?',
      body: 'Tap Use photo to continue, or take another if it looks blurry.',
    },
  ],
  cropPick: [
    {
      target: 'cropPickPhoto', shape: 'card', icon: 'camera.viewfinder',
      title: 'We found more than one spot',
      body: 'Each numbered ring is a spot in your photo. Tap the one you want to check.',
    },
    {
      target: 'cropPickThumbs', shape: 'card', optional: true, icon: 'plus.viewfinder',
      title: 'Compare up close',
      body: 'These close-ups help you tell the spots apart before you choose.',
    },
    {
      target: 'cropPickCheck', shape: 'pill', icon: 'arrow.right.circle.fill',
      title: 'Check the one you chose',
      body: 'Tap to continue with the selected spot.',
    },
    {
      target: 'cropPickMyself', shape: 'card', optional: true, icon: 'photo.on.rectangle',
      title: 'Not the right spot?',
      body: 'Position it yourself, or choose another photo.',
    },
  ],
  review: [
    {
      target: 'reviewAddAngle', shape: 'pill', optional: true, icon: 'photo.on.rectangle',
      title: 'Add another angle',
      body: 'One photo is enough. A second from a different angle can make the check more reliable.',
    },
  ],
  quality: [
    {
      target: 'qualityChecklist', shape: 'card', icon: 'checkmark.circle.fill',
      title: 'We check the photo first',
      body: 'Focus, lighting and framing are checked so your result is reliable. If something is off, you can retake.',
    },
  ],
  questionnaire: [
    {
      target: 'questionProgress', shape: 'card', icon: 'list.bullet',
      title: 'A few quick questions',
      body: "Itching, bleeding or recent changes add context a photo can't show.",
    },
    {
      target: 'questionSkip', shape: 'pill', optional: true, icon: 'chevron.right',
      title: 'Not sure? You can skip',
      body: 'Skipping is fine. Your photo is still checked.',
    },
  ],
  result: [
    {
      target: 'resultConfidence', shape: 'card', icon: 'chart.bar.fill',
      title: 'How closely it matched',
      body: 'This shows how strongly your photo matched a known pattern. A doctor always has the final say.',
    },
    {
      target: 'resultPriority', shape: 'card', icon: 'arrow.right.circle.fill',
      title: 'Your next step',
      body: "This is what we suggest you do, and how soon. It's guidance, not a diagnosis.",
    },
    {
      target: 'resultSummary', shape: 'pill', optional: true, icon: 'doc.text.fill',
      title: 'Your screening summary',
      body: 'A one-page report of this result to save, share, or show your doctor.',
    },
    {
      target: 'resultDerms', shape: 'card', optional: true, icon: 'building.2',
      title: 'Dermatologists near you',
      body: 'Places nearby that can check this spot. With location on, you can call or get directions from here.',
    },
    {
      target: 'resultMore', shape: 'card', optional: true, icon: 'book.fill',
      title: 'More you can do',
      body: 'Read about this type of spot, and follow how it changes over time.',
    },
  ],
  report: [
    {
      target: 'reportShare', shape: 'pill', icon: 'square.and.arrow.up',
      title: 'Bring this to your doctor',
      body: 'Save, share or print this one-page summary for your appointment.',
    },
  ],
  lesion: [
    {
      target: 'lesionTimeline', shape: 'card', optional: true, icon: 'clock.arrow.circlepath',
      title: 'Watch it over time',
      body: 'Every check of this spot is added here, so you and your doctor can see what changed.',
    },
    {
      target: 'lesionRescan', shape: 'pill', icon: 'camera.fill',
      title: 'Check it again later',
      body: 'Take a new photo of the same spot in a few weeks to compare.',
    },
  ],
};

const ALL_TIPS = Object.keys(TIP_SETS) as ScanTipsId[];

/** The four stops in the body screen's overview. */
const FLOW_STEPS = [
  'Mark where the spot is',
  'Take a clear photo',
  'Answer a few questions',
  'See your result and next steps',
];

/** `shown` stays false until a card is actually seen, so a set whose targets never appear isn't spent. */
type TipsSession = { userId: string; id: ScanTipsId; step: number; dir: 1 | -1; skipped: number[]; shown: boolean };

/** Scrolls the focused screen's content by `dy`; returns false if it can't. */
type Scroller = (dy: number) => boolean;

type ScanTipsContextValue = {
  session: TipsSession | null;
  start: (userId: string, id: ScanTipsId) => void;
  release: (id: ScanTipsId) => void;
  /** Returns the unregister function. */
  registerScroller: (scroller: Scroller) => () => void;
};

const ScanTipsContext = createContext<ScanTipsContextValue | null>(null);

function remember(userId: string, ids: ScanTipsId[]) {
  void markScanTipsSeen(userId, ids).catch((e) => console.warn('[scan-tips] could not save:', e));
}

/** Wraps the scan stack and draws the tips over it. Mount it full-screen, around the `<Stack>`. */
export function ScanTipsProvider({ children }: { children: React.ReactNode }) {
  const { getTargets, targetEpoch } = useProductTour();
  const [session, setSession] = useState<TipsSession | null>(null);
  const scroller = useRef<Scroller | null>(null);
  const registerScroller = useCallback((next: Scroller) => {
    scroller.current = next;
    return () => { if (scroller.current === next) scroller.current = null; };
  }, []);
  const scrollBy = useCallback((dy: number) => scroller.current?.(dy) ?? false, []);

  const start = useCallback((userId: string, id: ScanTipsId) => {
    setSession((current) => current ?? { userId, id, step: 0, dir: 1, skipped: [], shown: false });
  }, []);
  // Leaving a screen hides its tips without spending them; they show again on the next visit.
  const release = useCallback((id: ScanTipsId) => {
    setSession((current) => (current?.id === id ? null : current));
  }, []);

  const steps = session ? TIP_SETS[session.id] : [];
  const finish = useCallback((spend: boolean) => {
    if (!session) return;
    if (spend) remember(session.userId, [session.id]);
    setSession(null);
  }, [session]);
  const move = useCallback((direction: 1 | -1, skip = false) => {
    if (!session) return;
    const nextStep = session.step + direction;
    if (nextStep < 0 || nextStep >= steps.length) { finish(session.shown || !skip); return; }
    setSession({
      ...session,
      step: nextStep,
      dir: direction,
      skipped: skip ? [...session.skipped, session.step] : session.skipped,
      shown: session.shown || !skip,
    });
  }, [finish, session, steps.length]);
  const next = useCallback(() => move(1), [move]);
  const back = useCallback(() => move(-1), [move]);
  const skipMissing = useCallback(() => move(session?.dir ?? 1, true), [move, session?.dir]);
  const dismiss = useCallback(() => finish(true), [finish]);
  // "Not now" on the overview turns off the whole flow's tips, not just this screen's.
  const dismissAll = useCallback(() => {
    if (!session) return;
    remember(session.userId, ALL_TIPS);
    setSession(null);
  }, [session]);

  const value = useMemo(() => ({ session, start, release, registerScroller }), [session, start, release, registerScroller]);
  const step = session ? steps[session.step] : null;
  const counted = session
    ? steps.flatMap((s, i) =>
      s.intro || session.skipped.includes(i) || (s.optional && s.target && !getTargets(s.target).length) ? [] : [i])
    : [];

  return (
    <ScanTipsContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        {session && step ? (
          <CoachMarkOverlay
            step={step}
            stepKey={`${session.userId}:${session.id}:${session.step}`}
            progress={{ index: Math.max(0, counted.indexOf(session.step)), count: counted.length }}
            canGoBack={session.step > 0 && !steps[session.step - 1].intro}
            isLast={session.step === steps.length - 1}
            doneLabel="Got it"
            getTargets={getTargets}
            targetEpoch={targetEpoch}
            onNext={next}
            onBack={back}
            onDismiss={dismiss}
            onSkipMissing={skipMissing}
            onOffscreen={scrollBy}
            renderIntro={(layout) => (
              <IntroCard
                {...layout}
                art={require('@/assets/images/tour/screening-steps.svg')}
                artRatio={1.8}
                title={step.title}
                body={step.body}
                startLabel="Show me"
                skipLabel="I know how it works"
                skipAccessibilityLabel="Skip screening tips"
                onStart={next}
                onSkip={dismissAll}>
                <FlowSteps />
              </IntroCard>
            )}
          />
        ) : null}
      </View>
    </ScanTipsContext.Provider>
  );
}

function FlowSteps() {
  const theme = useTheme();
  return (
    <View style={styles.flow} accessibilityRole="list">
      {FLOW_STEPS.map((label, i) => (
        <View key={label} style={styles.flowRow} accessibilityRole="text">
          <View style={[styles.flowNumber, { backgroundColor: theme.brandTint }]}>
            <ThemedText type="caption" themeColor="brand" style={styles.flowNumberText}>{i + 1}</ThemedText>
          </View>
          <ThemedText type="subhead" style={styles.flowLabel}>{t(label)}</ThemedText>
        </View>
      ))}
    </View>
  );
}

/**
 * Shows this screen's tips the first time the account reaches it. `enabled: false` waits (e.g.
 * until a photo has loaded). `blocking` is true while tips may still appear or are on screen, so
 * a screen that advances on its own can hold off.
 */
export function useScanTips(id: ScanTipsId, { enabled = true }: { enabled?: boolean } = {}) {
  const context = useContext(ScanTipsContext);
  const userId = useAuth().user?.id;
  const [checking, setChecking] = useState(true);
  const start = context?.start;
  const release = context?.release;

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !userId || !start || !release) { setChecking(false); return; }
      let cancelled = false;
      setChecking(true);
      readSeenScanTips(userId)
        .then((seen) => { if (!cancelled && !seen.includes(id)) start(userId, id); })
        .catch((e) => console.warn('[scan-tips] could not read:', e))
        .finally(() => { if (!cancelled) setChecking(false); });
      return () => { cancelled = true; release(id); };
    }, [enabled, userId, start, release, id]),
  );

  return { blocking: (enabled && checking) || context?.session?.id === id };
}

/**
 * Lets the tips scroll this screen's ScrollView to a target below the fold. Spread the result
 * onto the ScrollView: `<ScrollView {...useScanTipsScroller()}>`.
 */
export function useScanTipsScroller() {
  const register = useContext(ScanTipsContext)?.registerScroller;
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  useFocusEffect(
    useCallback(() => register?.((dy) => {
      if (!ref.current) return false;
      ref.current.scrollTo({ y: Math.max(0, offset.current + dy), animated: true });
      return true;
    }), [register]),
  );
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  return { ref, onScroll, scrollEventThrottle: 32 };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flow: { alignSelf: 'stretch', gap: Space.sm, marginTop: Space.xs },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  flowNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flowNumberText: { fontWeight: '700' },
  flowLabel: { flex: 1 },
});

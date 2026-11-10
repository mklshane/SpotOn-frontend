import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Gradients, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, useLocale } from '@/lib/i18n';

/** `card` / `pill` / `circle` set the spotlight's corner radius to match the target. */
export type SpotShape = 'card' | 'pill' | 'circle';

/** One coach-mark. Copy is English source text; the overlay translates it. */
export type CoachStep = {
  /** A `TourTarget` id, or null for a centered card. */
  target: string | null;
  shape?: SpotShape;
  /** Skipped silently when the target isn't on screen. */
  optional?: boolean;
  /** Rendered by `renderIntro` instead of the coach-mark card, and not counted as a stop. */
  intro?: boolean;
  /** The target may sit in the reserved bottom band (e.g. the tab bar's scan button). */
  inBottomBand?: boolean;
  title: string;
  body: string;
  icon: IconName;
};

type Rect = { x: number; y: number; width: number; height: number };
/** `inside`: the target is too tall for the card above or below it, so the card sits in its lower part. */
type Placement = 'below' | 'above' | 'inside' | 'center';

export type IntroLayout = { width: number; top: number; left: number; onLayout: (e: LayoutChangeEvent) => void };

type CoachMarkOverlayProps = {
  step: CoachStep;
  /** Changes whenever the step does; measurement and entrance animations key off it. */
  stepKey: string;
  /** Where this stop sits among the stops that will show; null hides the counter and dots. */
  progress: { index: number; count: number } | null;
  canGoBack: boolean;
  isLast: boolean;
  /** Label on the last step's primary button. */
  doneLabel: string;
  /** Height kept clear at the bottom, above the safe area (the tab bar). */
  bottomBand?: number;
  getTargets: (id: string) => View[];
  /** Bumps when any target lays out, so the overlay re-measures. */
  targetEpoch: number;
  onNext: () => void;
  onBack: () => void;
  onDismiss: () => void;
  /** Called once when an optional step's target never shows up. */
  onSkipMissing: () => void;
  /**
   * A target measured off screen: scroll it into view (by `dy`, positive = content moves up) and
   * return true, or return false if nothing can scroll. Asked once per step.
   */
  onOffscreen?: (dy: number) => boolean;
  renderIntro?: (layout: IntroLayout) => ReactNode;
};

const DIM = 'rgba(33, 26, 21, 0.62)';
const HALO = 'rgba(255, 164, 104, 0.35)';
const CARD_MAX_WIDTH = 340;
const CARET = 12;
const PAD = Space.sm;
const POLL_MS = 90;
const GIVE_UP_MS = 1200;
const SCROLL_SETTLE_MS = 450;
const FADE = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

function radiusFor(shape: SpotShape | undefined, rect: Rect) {
  if (shape === 'circle' || shape === 'pill') return Math.min(rect.width, rect.height) / 2;
  // Follow the target's own corner out by the padding, so the ring sits concentric with it.
  return Radius.lg + PAD;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || Boolean(a && b && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)
    && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height));

/**
 * The dim layer as one even-odd SVG path: the screen minus a rounded hole. It is drawn once per
 * step and never animated. A huge bordered View looks equivalent, but iOS can't rasterise a
 * layer that large: it drew nothing and stalled the UI thread for seconds.
 */
function veilPath(width: number, height: number, hole: Rect | null, radius: number) {
  const outer = `M0 0H${width}V${height}H0Z`;
  if (!hole) return outer;
  const { x, y, width: w, height: h } = hole;
  const r = Math.min(radius, w / 2, h / 2);
  return `${outer}M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}`
    + `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`
    + `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/**
 * Full-screen spotlight + coach-mark card for one step. Mount it as the last child of a
 * full-screen container; it measures its target against itself.
 */
export function CoachMarkOverlay({
  step, stepKey, progress, canGoBack, isLast, doneLabel, bottomBand = 0, getTargets, targetEpoch,
  onNext, onBack, onDismiss, onSkipMissing, onOffscreen, renderIntro,
}: CoachMarkOverlayProps) {
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const overlayRef = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [measurement, setMeasurement] = useState<{ key: string; rect: Rect | null; fallback: boolean } | null>(null);
  const [cardHeight, setCardHeight] = useState(170);
  const rect = measurement?.key === stepKey ? measurement.rect : null;
  const gaveUp = measurement?.key === stepKey ? measurement.fallback : false;

  const visibleBottom = size.height - (step.inBottomBand ? 0 : bottomBand + insets.bottom);
  const isVisible = useCallback((r: Rect | null) => Boolean(r && r.width > 0 && r.height > 0
    && r.y >= 0 && r.y + r.height <= visibleBottom
    && r.x >= 0 && r.x + r.width <= size.width), [visibleBottom, size.width]);
  const visible = isVisible(rect);
  // Padded around the target, but kept on screen so a target at an edge keeps its whole ring.
  const spot: Rect | null = rect && visible
    ? (() => {
      const x = Math.max(HALO_WIDTH, rect.x - PAD);
      const y = Math.max(HALO_WIDTH, rect.y - PAD);
      const right = Math.min(size.width - HALO_WIDTH, rect.x + rect.width + PAD);
      const bottom = Math.min(size.height - HALO_WIDTH, rect.y + rect.height + PAD);
      return { x, y, width: right - x, height: bottom - y };
    })()
    : null;
  // A target that never shows up, or is still off screen once the screen settles, gets a
  // centered card - or, for an optional step, no step at all.
  const missing = Boolean(step.target && !spot && gaveUp);
  const measuring = Boolean(step.target && !spot && !missing);
  const skipping = missing && Boolean(step.optional);

  useEffect(() => {
    if (!measuring && !skipping) AccessibilityInfo.announceForAccessibility(`${t(step.title)}. ${t(step.body)}`);
  }, [stepKey, locale, step, measuring, skipping]);

  useEffect(() => {
    if (skipping) onSkipMissing();
  }, [skipping, onSkipMissing]);

  useEffect(() => {
    const handler = () => { onBack(); return true; };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onBack(); }
    };
    if (Platform.OS === 'web') document.addEventListener('keydown', onKeyDown);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('keydown', onKeyDown);
    };
  }, [onBack]);

  const stepStart = useRef({ key: '', at: 0 });
  const scrolledFor = useRef('');
  const measureOnce = useCallback((done: (rect: Rect | null) => void) => {
    const overlay = overlayRef.current;
    const views = step.target ? getTargets(step.target) : [];
    if (!overlay || !views.length) { done(null); return; }
    overlay.measureInWindow((overlayX, overlayY) => {
      // Hidden copies measure as zero-sized, so whichever copy is on screen wins.
      let pending = views.length;
      let found: Rect | null = null;
      for (const view of views) {
        view.measureInWindow((x, y, width, height) => {
          if (width > 0 && height > 0) found = { x: x - overlayX, y: y - overlayY, width, height };
          if (--pending === 0) done(found);
        });
      }
    });
  }, [getTargets, step.target]);

  // Poll until two readings agree: screens slide in with entrance animations that onLayout
  // doesn't report, and a reading taken mid-slide puts the spotlight on the wrong element.
  // Re-runs on layout changes; a busy screen can't hold the step back past GIVE_UP_MS.
  useEffect(() => {
    if (!step.target) return;
    let cancelled = false;
    let last: Rect | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (stepStart.current.key !== stepKey) stepStart.current = { key: stepKey, at: Date.now() };
    const startedAt = stepStart.current.at;
    const poll = () => measureOnce((next) => {
      if (cancelled) return;
      if (next && sameRect(next, last) && !isVisible(next) && onOffscreen && scrolledFor.current !== stepKey) {
        // Below the fold (or above it, going back): bring it to about a quarter of the way down,
        // which leaves room for the card under it, then measure again once the scroll lands.
        scrolledFor.current = stepKey;
        if (onOffscreen(next.y - size.height * 0.25)) {
          stepStart.current = { key: stepKey, at: Date.now() };
          last = null;
          timer = setTimeout(poll, SCROLL_SETTLE_MS);
          return;
        }
      }
      if (next && sameRect(next, last)) {
        setMeasurement((current) => current?.key === stepKey && sameRect(current.rect, next)
          ? current : { key: stepKey, rect: next, fallback: false });
        return;
      }
      last = next;
      if (Date.now() - startedAt >= GIVE_UP_MS) {
        setMeasurement((current) => ({
          key: stepKey, rect: current?.key === stepKey ? current.rect : null, fallback: true,
        }));
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    });
    const frame = requestAnimationFrame(poll);
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [stepKey, step.target, measureOnce, targetEpoch, size.width, size.height, isVisible, onOffscreen]);

  const gap = Space.md + CARET / 2;
  const topLimit = insets.top + Space.md;
  const bottomLimit = size.height - bottomBand - insets.bottom - Space.sm;
  const centered = Math.max(topLimit, (size.height - cardHeight) / 2);
  let placement: Placement = 'center';
  let cardTop = centered;
  if (spot) {
    const below = spot.y + spot.height + gap;
    const above = spot.y - cardHeight - gap;
    if (!step.inBottomBand && below + cardHeight <= bottomLimit) { placement = 'below'; cardTop = below; }
    else if (above >= topLimit) { placement = 'above'; cardTop = above; }
    else if (spot.height >= cardHeight * 1.6) {
      placement = 'inside';
      cardTop = Math.max(topLimit, Math.min(bottomLimit - cardHeight, spot.y + spot.height - cardHeight - Space.base));
    }
  }
  const cardWidth = Math.min(CARD_MAX_WIDTH, Math.max(0, size.width - Space.base * 2));
  const cardLeft = (size.width - cardWidth) / 2;
  const caretLeft = spot
    ? Math.min(cardWidth - Space.xl, Math.max(Space.xl, spot.x + spot.width / 2 - cardLeft)) - CARET / 2
    : 0;
  const showCard = !measuring && !skipping;
  const holeRadius = spot ? radiusFor(step.shape, spot) : 0;
  // Nothing is drawn, and touches pass through, until the first card is ready. A dim with no card
  // reads as a frozen screen (and lands on the outgoing screen during a transition). Once shown,
  // the dim stays up between steps so moving on doesn't flicker.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { if (showCard) setRevealed(true); }, [showCard]);
  const active = showCard || revealed;
  const onCardLayout = (e: LayoutChangeEvent) => setCardHeight(e.nativeEvent.layout.height);

  return (
    <View
      ref={overlayRef}
      style={[StyleSheet.absoluteFill, styles.clip]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityViewIsModal={active}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}>
      {size.width > 0 && active ? (
        <Animated.View entering={FADE} pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width={size.width} height={size.height}>
            <Path d={veilPath(size.width, size.height, showCard ? spot : null, holeRadius)} fill={DIM} fillRule="evenodd" />
          </Svg>
        </Animated.View>
      ) : null}
      {showCard && spot ? (
        <Animated.View
          key={`ring:${stepKey}`}
          entering={FADE}
          pointerEvents="none"
          style={[styles.ring, { left: spot.x, top: spot.y, width: spot.width, height: spot.height, borderRadius: holeRadius, borderColor: theme.brandBright }]}>
          <View style={[styles.halo, { borderRadius: holeRadius + HALO_WIDTH }]} />
        </Animated.View>
      ) : null}
      {/* Catches taps everywhere, including on the spotlight, so the tour can't be left mid-step. */}
      {active ? <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={() => {}} /> : null}
      {showCard && step.intro && renderIntro ? (
        <View key={stepKey} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {renderIntro({ width: cardWidth, top: centered, left: cardLeft, onLayout: onCardLayout })}
        </View>
      ) : showCard ? (
        <Animated.View
          key={stepKey}
          entering={FADE}
          onLayout={onCardLayout}
          style={[styles.card, Elevation.lg, { left: cardLeft, top: cardTop, width: cardWidth, backgroundColor: theme.surface }]}
          accessibilityLiveRegion="polite">
          {placement === 'below' || placement === 'above' ? (
            <View
              style={[
                styles.caret,
                { left: caretLeft, backgroundColor: theme.surface },
                placement === 'below' ? { top: -CARET / 2 } : { bottom: -CARET / 2 },
              ]}
            />
          ) : null}
          <View style={styles.header}>
            <View style={[styles.iconChip, { backgroundColor: theme.brandTint }]}>
              <Icon name={step.icon} tintColor={theme.brand} size={15} />
            </View>
            <ThemedText type="caption" themeColor="muted" style={styles.counter}>
              {progress && progress.count > 1 ? t('{{n}} of {{total}}', { n: progress.index + 1, total: progress.count }) : ''}
            </ThemedText>
            {!isLast ? (
              <Pressable onPress={onDismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Skip tour')}>
                <ThemedText type="footnote" themeColor="brand" style={styles.strong}>{t('Skip')}</ThemedText>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.copy}>
            <ThemedText type="headline" accessibilityRole="header">{t(step.title)}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">{t(step.body)}</ThemedText>
          </View>
          <View style={styles.footer}>
            <View style={styles.progress} accessible={false}>
              {progress && progress.count > 1
                ? Array.from({ length: progress.count }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      i === progress.index
                        ? { width: Space.base, backgroundColor: theme.brand }
                        : { backgroundColor: theme.hairline },
                    ]}
                  />
                ))
                : null}
            </View>
            <View style={styles.actions}>
              {canGoBack ? (
                <Pressable
                  onPress={onBack}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t('Back')}
                  style={({ pressed }) => [styles.backButton, { borderColor: theme.hairline }, pressed && styles.pressed]}>
                  <Icon name="chevron.left" tintColor={theme.text} size={16} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={onNext}
                hitSlop={4}
                accessibilityRole="button"
                style={({ pressed }) => [styles.nextButton, { backgroundColor: theme.brand }, pressed && styles.pressed]}>
                <ThemedText type="subhead" themeColor="onBrand" style={styles.strong}>
                  {isLast ? t(doneLabel) : t('Next')}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

type IntroCardProps = IntroLayout & {
  art: ImageSource | number;
  /** The art's width / height. */
  artRatio: number;
  title: string;
  body: string;
  startLabel: string;
  skipLabel: string;
  skipAccessibilityLabel: string;
  onStart: () => void;
  onSkip: () => void;
  /** Extra content between the copy and the buttons. */
  children?: ReactNode;
};

/** An illustrated opening sheet: what's coming, with one clear way in. Copy is translated here. */
export function IntroCard({
  width, top, left, onLayout, art, artRatio, title, body, startLabel, skipLabel, skipAccessibilityLabel,
  onStart, onSkip, children,
}: IntroCardProps) {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(280).reduceMotion(ReduceMotion.System)}
      onLayout={onLayout}
      style={[styles.intro, Elevation.lg, { left, top, width, backgroundColor: theme.surface }]}
      accessibilityLiveRegion="polite">
      <LinearGradient
        colors={Gradients.sunsetSoft.colors as unknown as [string, string, ...string[]]}
        locations={Gradients.sunsetSoft.locations as unknown as [number, number, ...number[]]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.introArt, { height: Math.round(width / INTRO_ART_RATIO) }]}>
        <Image
          source={art}
          contentFit="contain"
          style={[styles.introImage, { aspectRatio: artRatio }]}
          accessible={false}
        />
      </LinearGradient>
      <View style={styles.introBody}>
        <ThemedText type="title2" accessibilityRole="header" style={styles.center}>{t(title)}</ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary" style={[styles.center, styles.regular]}>
          {t(body)}
        </ThemedText>
        {children}
        <View style={styles.introActions}>
          <Pressable
            onPress={onStart}
            accessibilityRole="button"
            style={({ pressed }) => [styles.startButton, { backgroundColor: theme.brand }, pressed && styles.pressed]}>
            <ThemedText type="headline" themeColor="onBrand">{t(startLabel)}</ThemedText>
            <Icon name="arrow.right" tintColor={theme.onBrand} size={16} />
          </Pressable>
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel={t(skipAccessibilityLabel)}
            style={({ pressed }) => [styles.laterButton, pressed && styles.pressed]}>
            <ThemedText type="subhead" themeColor="textSecondary">{t(skipLabel)}</ThemedText>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

/** The header band is always 1.8:1; art keeps its own ratio inside it. */
const INTRO_ART_RATIO = 1.8;
const BUTTON = 36;
const HALO_WIDTH = Space.xs + 2;

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 2 },
  halo: {
    position: 'absolute',
    top: -HALO_WIDTH,
    left: -HALO_WIDTH,
    right: -HALO_WIDTH,
    bottom: -HALO_WIDTH,
    borderWidth: Space.xs,
    borderColor: HALO,
  },
  card: { position: 'absolute', borderRadius: Radius.lg, padding: Space.base, gap: Space.md },
  caret: { position: 'absolute', width: CARET, height: CARET, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  iconChip: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  counter: { flex: 1 },
  strong: { fontWeight: '600' },
  copy: { gap: Space.xs },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: Radius.pill },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  backButton: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButton: {
    height: BUTTON,
    minWidth: 76,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  intro: { position: 'absolute', borderRadius: Radius.xl, overflow: 'hidden' },
  introArt: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  introImage: { height: '100%', maxWidth: '100%' },
  introBody: { paddingHorizontal: Space.lg, paddingTop: Space.lg, paddingBottom: Space.sm, gap: Space.sm, alignItems: 'center' },
  center: { textAlign: 'center' },
  regular: { fontWeight: '400' },
  introActions: { alignSelf: 'stretch', marginTop: Space.sm },
  startButton: {
    height: 48,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  laterButton: { height: 44, alignItems: 'center', justifyContent: 'center' },
});

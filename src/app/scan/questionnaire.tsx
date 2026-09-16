import { t, useLocale } from '@/lib/i18n';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  type LayoutChangeEvent,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, ConfirmDialog, Screen, SelectCard } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useAndroidBack } from '@/hooks/use-android-back';
import { useSurfaceWidth } from '@/hooks/use-surface-width';
import { useTheme } from '@/hooks/use-theme';
import { useScreeningSession } from '@/lib/screening-session';
import { ANSWER_OPTIONS, QUESTIONS, type QuestionDef } from '@/lib/triage/questions';
import { REFERENCE_CAPTIONS, REFERENCE_IMAGES } from '@/lib/triage/reference-images';
import type { Answer, QuestionId } from '@/lib/triage/types';

/**
 * The 8-item symptom questionnaire. One question per page (progressive disclosure);
 * swiping is disabled so every question gets an explicit answer. Classification runs
 * in the background the whole time - by the last answer the result is usually ready.
 *
 * Tapping a choice NEVER advances the page on its own. Only "Next" moves forward. The screen used
 * to auto-advance ~260ms after a tap, which meant a mistap was already on the next question before
 * the user could see what they had picked - and on the answers that matter (this feeds the symptom
 * score) the correction cost is a back-tap plus a re-read. The button is disabled until the current
 * question is answered, so the explicit step costs nothing on a deliberate pass.
 */
export default function QuestionnaireScreen() {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const width = useSurfaceWidth();
  // Short viewports (small phones, and any phone whose browser chrome eats the bottom of the
  // window) cannot fit question + photo + three choices at full spacing. `compact` tightens the
  // page and shrinks the reference photo; whatever still does not fit scrolls - see `page`.
  const { height: windowHeight } = useWindowDimensions();
  const compact = windowHeight < CompactHeight;
  // The photo is the one element that can give up room without costing the user an answer, so it
  // is what shrinks as the window gets shorter - the choices keep their full tap targets.
  const photoMinHeight =
    windowHeight < ShortHeight ? 80 : windowHeight < CompactHeight ? 96 : 120;
  const {
    answers,
    setAnswer,
    skipRemaining,
    questionnaireComplete,
    reset,
    followUp,
    questionsToReask,
    images,
    imageUri,
  } = useScreeningSession();

  /**
   * A complete questionnaire is not enough to analyse - there has to be a PHOTO.
   *
   * The follow-up screen's "Update these answers" enters this screen directly, with no capture
   * step before it. `carryForwardAnswers` guarantees the carried answers plus the re-asked ones
   * cover all 8 questions, so `questionnaireComplete` turns true here on a session that has never
   * held an image. Sending that to /scan/analysis produced an unrecoverable dead end: the
   * classifier throws 'classification never started', "Try again" is a permanent no-op because
   * `retryClassification` bails on an empty URI list, and back is blocked on that screen - the only
   * exit discarded the whole follow-up.
   */
  const hasPhoto = images.length > 0 || imageUri != null;

  // A follow-up only asks what the carry-forward policy could not safely reuse (tps-core
  // `carryForwardAnswers`). `questionnaireComplete` still requires all 8 answers - the carried ones
  // are already in `answers`, so computeSymptomScore keeps scoring a complete questionnaire and the
  // TPS engine is untouched. Only the asked subset changes.
  const questions = useMemo(
    () => (followUp ? QUESTIONS.filter((q) => questionsToReask.includes(q.id)) : QUESTIONS),
    [followUp, questionsToReask],
  );

  const listRef = useRef<FlatList<QuestionDef>>(null);
  const [index, setIndex] = useState(0);
  /**
   * Height of the pager itself, measured rather than inherited.
   *
   * A horizontal FlatList stretches its cells to the list's height on native, so a `flex: 1` page
   * was bounded there - but react-native-web wraps each cell in an auto-height div, so the same
   * page grows to whatever its content needs and the list clips the excess. That is why the
   * choices could be cut off with nothing to scroll: the page's own scroll view was taller than
   * the window, so it had nothing to scroll either. An explicit height bounds it on both
   * platforms; 0 until the first layout, which renders the page unbounded for one frame.
   */
  const [listHeight, setListHeight] = useState(0);
  const [skipOpen, setSkipOpen] = useState(false);

  const isLast = index === questions.length - 1;
  const current = questions[index];
  const currentAnswered = answers[current.id] !== undefined;

  // Counted over all 8 items, not just the asked subset: a follow-up carries answers forward, and
  // those are already answered - only what is genuinely blank becomes "I’m not sure".
  const unanswered = useMemo(
    () => QUESTIONS.filter((q) => answers[q.id] === undefined).length,
    [answers],
  );

  const goTo = useCallback((i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  }, []);

  /**
   * Re-assert the scroll offset whenever `index` or the viewport width changes.
   *
   * `index` drives the header, the progress bar and `currentAnswered`, and it updates the instant
   * Next is pressed - but the list is moved by an *animated* scroll that is never awaited. Anything
   * that re-lays the list out mid-flight leaves the two disagreeing, and the symptom is nasty: the
   * user answers the card they can see (so the radio fills in), while `currentAnswered` is still
   * testing the question `index` points at, so Next stays dead.
   *
   * iOS Safari hits this reliably, because collapsing the URL bar resizes the viewport - `width`
   * comes from useWindowDimensions() and is baked into getItemLayout and the page style, so the
   * relayout drops the offset while `index` survives in state. Reported 2026-09-08: the header
   * read "Question 3" while question 2 was on screen.
   *
   * Snapping without animation is deliberate: this runs *after* the animated scroll from goTo, so
   * it is a correction, not the transition.
   */
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: index * width, animated: false });
  }, [index, width]);

  /** Record the answer and stay put - the user moves on with "Next". */
  function select(q: QuestionDef, value: Answer) {
    setAnswer(q.id, value);
  }

  /**
   * Where a finished questionnaire goes. With a photo, on to analysis; without one, back to the
   * screen that offers the camera - answers intact, so the user resumes rather than restarts.
   */
  function finish() {
    if (hasPhoto) {
      router.replace('/scan/analysis');
      return;
    }
    // Entered from follow-up confirm via router.push, so back lands there with the updated answers
    // already shown. The fallback covers a session that reached here some other way.
    if (router.canGoBack()) router.back();
    else router.replace('/scan/followup-confirm');
  }

  function next() {
    if (isLast) {
      if (questionnaireComplete) finish();
    } else if (currentAnswered) {
      goTo(index + 1);
    }
  }

  /** Skip: every blank answer becomes "I’m not sure", then straight on to the result. */
  function confirmSkip() {
    setSkipOpen(false);
    skipRemaining();
    finish();
  }

  function confirmExit() {
    Alert.alert('Leave this check?', 'Your photo and answers will be discarded.', [
      { text: t("Keep going"), style: 'cancel' },
      {
        text: t("Leave"),
        style: 'destructive',
        onPress: () => {
          reset();
          router.replace('/(tabs)/home');
        },
      },
    ]);
  }

  // Android's back button mirrors the header: step back through the questions, and on the first one
  // ask before discarding the run. Without this it would pop to the capture screen mid-questionnaire
  // - which is exactly what `gestureEnabled: false` already forbids on iOS.
  useAndroidBack(() => (index > 0 ? goTo(index - 1) : confirmExit()));

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      {/* Header: back through questions · progress · exit */}
      <View style={styles.header}>
        {index > 0 ? (
          <Pressable hitSlop={12} onPress={() => goTo(index - 1)} accessibilityRole="button" accessibilityLabel={t("Previous question")}>
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <ThemedText type="headline" themeColor="textSecondary">
          {t('Question {{n}} of {{total}}', { n: index + 1, total: questions.length })}
        </ThemedText>
        <Pressable hitSlop={12} onPress={confirmExit} accessibilityRole="button" accessibilityLabel={t("Exit questionnaire")}>
          <Icon name="xmark" tintColor={theme.muted} size={18} />
        </Pressable>
      </View>

      {/* Progress: thin brand bar under the header, filled to the current question */}
      <ProgressBar progress={(index + 1) / questions.length} />

      <FlatList
        ref={listRef}
        onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
        data={questions as QuestionDef[]}
        keyExtractor={(q) => q.id}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        // Without this a failed scroll is swallowed and the list stays behind `index`.
        onScrollToIndexFailed={({ index: i }) =>
          listRef.current?.scrollToOffset({ offset: i * width, animated: false })
        }
        renderItem={({ item }) => (
          <QuestionPage
            question={item}
            width={width}
            height={listHeight}
            compact={compact}
            photoMinHeight={photoMinHeight}
            selected={answers[item.id]}
            onSelect={(value) => select(item, value)}
          />
        )}
      />

      <View
        style={[
          styles.footer,
          compact && styles.footerCompact,
          { paddingBottom: insets.bottom + (compact ? Space.sm : Space.md) },
        ]}>
        {index === 0 ? (
          <Animated.View entering={FadeIn}>
            <ThemedText type="footnote" themeColor="muted" style={styles.reassure}>
              {t("There are no wrong answers - answer as best you can.")}</ThemedText>
          </Animated.View>
        ) : null}
        <Button
          label={isLast ? t('See my results') : t('Next')}
          variant="brand"
          disabled={isLast ? !questionnaireComplete : !currentAnswered}
          onPress={next}
          style={styles.cta}
        />
        {unanswered > 0 ? (
          <Pressable
            hitSlop={10}
            onPress={() => setSkipOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("Skip the remaining questions")}>
            {({ pressed }) => (
              <ThemedText
                type="subhead"
                themeColor="textSecondary"
                style={[styles.skip, pressed && styles.skipPressed]}>
                {t("Skip these questions")}</ThemedText>
            )}
          </Pressable>
        ) : null}
      </View>

      <ConfirmDialog
        visible={skipOpen}
        icon="questionmark.circle.fill"
        title={t("Skip the questions?")}
        message={`We’ll record your ${unanswered} remaining ${
          unanswered === 1 ? 'answer' : 'answers'
        } as “I’m not sure.” That’s okay - but the more you can answer, the more accurate your result.`}
        confirmLabel="Skip anyway"
        cancelLabel="Keep answering"
        onConfirm={confirmSkip}
        onCancel={() => setSkipOpen(false)}
      />
    </Screen>
  );
}

/**
 * One question: the prompt, its reference photo and the three choices, as a single vertically
 * scrollable page.
 *
 * The page used to be a plain flex column sized to the space between the progress bar and the
 * footer, on the assumption that a question, a photo and three cards always fit. They do not: on a
 * 375x600 web viewport only "Yes" was reachable, with "No" and "I’m not sure" clipped at the
 * list’s edge and no way to scroll to them (reported on the web build 2026-09-16). Small phones
 * hit it natively too, and mobile Safari makes any phone short whenever the URL bar is showing.
 *
 * `flexGrow: 1` on the content preserves the old layout wherever it fits - the photo still absorbs
 * the leftover space and the choices still sit just above the footer - and turns the excess into
 * scroll where it does not. The three cards scroll with the question and photo rather than in
 * their own pane, so the reading order is unchanged.
 */
function QuestionPage({
  question,
  width,
  height,
  compact,
  photoMinHeight,
  selected,
  onSelect,
}: {
  question: QuestionDef;
  width: number;
  /** Measured pager height; 0 before the pager's first layout. */
  height: number;
  compact: boolean;
  photoMinHeight: number;
  selected: Answer | undefined;
  onSelect: (value: Answer) => void;
}) {
  const theme = useTheme();
  // Content clipped at the bottom of a scroll view reads as a layout bug, not as "there is more" -
  // which is precisely how the original clipping was reported. `more` drives the affordance below
  // the scroll view, so a page whose choices all fit looks exactly as it did before.
  const [more, setMore] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const viewport = useRef(0);
  const content = useRef(0);
  const offset = useRef(0);

  const sync = useCallback(() => {
    setMore(content.current - viewport.current - offset.current > ScrollHintSlop);
  }, []);

  /**
   * `onContentSizeChange` cannot answer "is anything cut off?" here. react-native-web renders the
   * content container as a flex child, so `flexGrow: 1` plus the default `flex-shrink: 1` pins it
   * to the viewport height and the choices simply overflow it - the reported content size is the
   * viewport, whatever is hanging out the bottom. (Forcing `flexShrink: 0` fixes the number and
   * breaks the layout: the scroll view then sizes itself to its content inside the horizontal
   * pager, so the page stops being clipped to the list at all.) The bottom of the choices, from
   * their own onLayout, is the measurement that means what it says on both platforms.
   */
  const onOptionsLayout = useCallback(
    (e: LayoutChangeEvent) => {
      content.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
      sync();
    },
    [sync],
  );

  return (
    <Animated.View entering={FadeIn} style={[styles.page, { width, height: height || undefined }]}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.pageContent, compact && styles.pageContentCompact]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.height;
          sync();
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          sync();
        }}>
        {/* Header block - natural height */}
        <View style={styles.questionBlock}>
          <ThemedText type="title2">{question.question}</ThemedText>
          {question.helper ? (
            <ThemedText type="subhead" themeColor="textSecondary">
              {question.helper}
            </ThemedText>
          ) : null}
        </View>
        {/* Reference photo - flexes to fill the space between question and choices */}
        <ReferenceImage id={question.id} compact={compact} minHeight={photoMinHeight} />
        {/* Choices - natural height, pinned above the footer */}
        <View
          style={[styles.options, compact && styles.optionsCompact]}
          onLayout={onOptionsLayout}>
          {ANSWER_OPTIONS.map((opt, i) => (
            <Animated.View key={opt.value} entering={FadeInDown.delay(60 * i)}>
              <SelectCard
                title={opt.title}
                subtitle={opt.subtitle}
                selected={selected === opt.value}
                onPress={() => onSelect(opt.value)}
                style={compact ? styles.optionCompact : undefined}
              />
            </Animated.View>
          ))}
        </View>
      </ScrollView>
      {more ? (
        <>
          <LinearGradient pointerEvents="none" colors={ScrollHintFade} style={styles.scrollHint} />
          {/*
            The fade alone is not enough when the last choice falls entirely below the fold - there
            is then no half-cut card to notice, just background. This is the explicit cue, and it
            is tappable rather than decorative so the cut-off choices are one tap away.
          */}
          <Pressable
            onPress={() => scroller.current?.scrollToEnd({ animated: true })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("Show the rest of this question")}
            style={({ pressed }) => [
              styles.scrollCue,
              { backgroundColor: theme.brand },
              Elevation.sm,
              pressed && styles.scrollCuePressed,
            ]}>
            <Icon name="chevron.down" tintColor={theme.onBrand} size={14} weight="semibold" />
          </Pressable>
        </>
      ) : null}
    </Animated.View>
  );
}

/**
 * Clinical reference photo for a question: a rounded, captioned image so users can see what
 * the feature (crusty, ragged edge, ugly duckling…) actually looks like. Openly-licensed
 * source images live in assets/reference/ (see reference-images.ts for attribution).
 */
function ReferenceImage({
  id,
  compact,
  minHeight,
}: {
  id: QuestionId;
  compact: boolean;
  minHeight: number;
}) {
  useLocale();
  const theme = useTheme();
  const source = REFERENCE_IMAGES[id];
  if (!source) return null;
  return (
    <View style={[styles.refWrap, compact && styles.refWrapCompact]}>
      <View style={[styles.refFrame, { minHeight, borderColor: theme.hairline }]}>
        <Image source={source} style={styles.refImage} contentFit="cover" transition={200} />
      </View>
      {REFERENCE_CAPTIONS[id] ? (
        <ThemedText type="caption" themeColor="muted" style={styles.refCaption}>
          {REFERENCE_CAPTIONS[id]}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Thin linear progress bar: brand fill springing over a hairline track. */
function ProgressBar({ progress }: { progress: number }) {
  useLocale();
  const theme = useTheme();
  const p = useSharedValue(progress);
  useEffect(() => {
    p.value = withSpring(progress, { damping: 20, stiffness: 180 });
  }, [progress, p]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View
      style={[styles.track, { backgroundColor: theme.hairline }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 1, now: progress }}>
      <Animated.View style={[styles.fill, { backgroundColor: theme.brand }, fillStyle]} />
    </View>
  );
}

/**
 * Below this window height the page is laid out compactly. 720 is deliberately generous: an
 * iPhone 13/14 in Safari has roughly 660-700 CSS px of visible viewport once the URL bar is
 * showing, and that is exactly the case that was clipping the choices.
 */
const CompactHeight = 720;

/** Shorter still - a small phone, where the photo gives up more room again. */
const ShortHeight = 620;

/**
 * How much of the choices may sit below the fold before the page admits there is more. The hint is
 * about a cut-off *choice*, so the measurement stops at the last card and this absorbs the page's
 * bottom padding plus any rounding - a page whose cards all fit shows no hint.
 */
const ScrollHintSlop = 8;

/**
 * Bottom fade for a page with more content below. The colour is the `dawn` screen gradient where
 * the scroll area ends (just above the footer, roughly three quarters down): the stop either side
 * of that point differs by a couple of RGB units, so one constant reads as the background at every
 * phone size rather than as a band.
 */
const ScrollHintFade = ['rgba(250,226,206,0)', 'rgba(250,226,206,0.92)'] as const;

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  track: {
    height: 4,
    borderRadius: Radius.pill,
    marginHorizontal: Space.xl,
    marginTop: Space.xs,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: Radius.pill },
  // Each page owns the space between the progress bar and the footer. Its scroll view's content
  // is a flex column that fills that space when it fits, and scrolls when it does not.
  page: { flex: 1 },
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: Space.xl,
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  pageContentCompact: { paddingTop: Space.md },
  questionBlock: { gap: Space.sm },
  // The photo absorbs the leftover vertical space; minHeight keeps it usable on small phones.
  refWrap: { flex: 1, marginTop: Space.base, marginBottom: Space.base, gap: Space.sm },
  refWrapCompact: { marginTop: Space.sm, marginBottom: Space.sm, gap: Space.xs },
  refFrame: {
    flex: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    width: '100%',
  },
  refImage: { width: '100%', height: '100%' },
  refCaption: { textAlign: 'center' },
  options: { gap: Space.md },
  optionsCompact: { gap: Space.sm },
  optionCompact: { minHeight: 56, paddingVertical: Space.md },
  scrollHint: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 32 },
  scrollCue: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollCuePressed: { opacity: 0.7 },
  footer: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    gap: Space.md,
    alignItems: 'center',
  },
  footerCompact: { paddingTop: Space.sm, gap: Space.sm },
  reassure: { textAlign: 'center' },
  cta: { alignSelf: 'stretch' },
  skip: { textAlign: 'center', textDecorationLine: 'underline' },
  skipPressed: { opacity: 0.6 },
});

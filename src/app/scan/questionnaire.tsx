import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen, SelectCard } from '@/components/ui';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScreeningSession } from '@/lib/screening-session';
import { ANSWER_OPTIONS, QUESTIONS, type QuestionDef } from '@/lib/triage/questions';
import { REFERENCE_CAPTIONS, REFERENCE_IMAGES } from '@/lib/triage/reference-images';
import type { Answer, QuestionId } from '@/lib/triage/types';

const ADVANCE_MS = 260; // beat after a tap before sliding to the next question

/**
 * The 8-item symptom questionnaire. One question per page (progressive disclosure);
 * swiping is disabled so every question gets an explicit answer. Classification runs
 * in the background the whole time — by the last answer the result is usually ready.
 */
export default function QuestionnaireScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { answers, setAnswer, questionnaireComplete, reset, followUp, questionsToReask } =
    useScreeningSession();

  // A follow-up only asks what the carry-forward policy could not safely reuse (tps-core
  // `carryForwardAnswers`). `questionnaireComplete` still requires all 8 answers — the carried ones
  // are already in `answers`, so computeSymptomScore keeps scoring a complete questionnaire and the
  // TPS engine is untouched. Only the asked subset changes.
  const questions = useMemo(
    () => (followUp ? QUESTIONS.filter((q) => questionsToReask.includes(q.id)) : QUESTIONS),
    [followUp, questionsToReask],
  );

  const listRef = useRef<FlatList<QuestionDef>>(null);
  const [index, setIndex] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLast = index === questions.length - 1;
  const current = questions[index];
  const currentAnswered = answers[current.id] !== undefined;

  const goTo = useCallback((i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  }, []);

  function select(q: QuestionDef, value: Answer) {
    setAnswer(q.id, value);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const i = questions.indexOf(q);
    if (i < questions.length - 1) {
      advanceTimer.current = setTimeout(() => goTo(i + 1), ADVANCE_MS);
    }
  }

  function next() {
    if (isLast) {
      if (questionnaireComplete) router.replace('/scan/analysis');
    } else if (currentAnswered) {
      goTo(index + 1);
    }
  }

  function confirmExit() {
    Alert.alert('Leave this check?', 'Your photo and answers will be discarded.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          reset();
          router.replace('/(tabs)/home');
        },
      },
    ]);
  }

  return (
    <Screen variant="gradient" gradient="dawn" padded={false} edges={['top']}>
      {/* Header: back through questions · progress · exit */}
      <View style={styles.header}>
        {index > 0 ? (
          <Pressable hitSlop={12} onPress={() => goTo(index - 1)} accessibilityRole="button" accessibilityLabel="Previous question">
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <ThemedText type="headline" themeColor="textSecondary">
          Question {index + 1} of {questions.length}
        </ThemedText>
        <Pressable hitSlop={12} onPress={confirmExit} accessibilityRole="button" accessibilityLabel="Exit questionnaire">
          <Icon name="xmark" tintColor={theme.muted} size={18} />
        </Pressable>
      </View>

      {/* Progress: thin brand bar under the header, filled to the current question */}
      <ProgressBar progress={(index + 1) / questions.length} />

      <FlatList
        ref={listRef}
        data={questions as QuestionDef[]}
        keyExtractor={(q) => q.id}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <Animated.View entering={FadeIn} style={[styles.page, { width }]}>
            {/* Header block — natural height */}
            <View style={styles.questionBlock}>
              <ThemedText type="title2">{item.question}</ThemedText>
              {item.helper ? (
                <ThemedText type="subhead" themeColor="textSecondary">
                  {item.helper}
                </ThemedText>
              ) : null}
            </View>
            {/* Reference photo — flexes to fill the space between question and choices */}
            <ReferenceImage id={item.id} />
            {/* Choices — natural height, pinned above the footer */}
            <View style={styles.options}>
              {ANSWER_OPTIONS.map((opt, i) => (
                <Animated.View key={opt.value} entering={FadeInDown.delay(60 * i)}>
                  <SelectCard
                    title={opt.title}
                    subtitle={opt.subtitle}
                    selected={answers[item.id] === opt.value}
                    onPress={() => select(item, opt.value)}
                  />
                </Animated.View>
              ))}
            </View>
          </Animated.View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
        {index === 0 ? (
          <Animated.View entering={FadeIn}>
            <ThemedText type="footnote" themeColor="muted" style={styles.reassure}>
              There are no wrong answers — answer as best you can.
            </ThemedText>
          </Animated.View>
        ) : null}
        <Button
          label={isLast ? 'See my results' : 'Next'}
          variant="brand"
          disabled={isLast ? !questionnaireComplete : !currentAnswered}
          onPress={next}
          style={styles.cta}
        />
      </View>
    </Screen>
  );
}

/**
 * Clinical reference photo for a question: a rounded, captioned image so users can see what
 * the feature (crusty, ragged edge, ugly duckling…) actually looks like. Openly-licensed
 * source images live in assets/reference/ (see reference-images.ts for attribution).
 */
function ReferenceImage({ id }: { id: QuestionId }) {
  const theme = useTheme();
  const source = REFERENCE_IMAGES[id];
  if (!source) return null;
  return (
    <View style={styles.refWrap}>
      <View style={[styles.refFrame, { borderColor: theme.hairline }]}>
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
  // Each page is a flex column filling the space between the progress bar and the footer,
  // so the question, reference photo, and all three choices stay on-screen at any phone size.
  page: {
    flex: 1,
    paddingHorizontal: Space.xl,
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  questionBlock: { gap: Space.sm },
  // The photo absorbs the leftover vertical space; minHeight keeps it usable on small phones.
  refWrap: { flex: 1, marginTop: Space.base, marginBottom: Space.base, gap: Space.sm },
  refFrame: {
    flex: 1,
    minHeight: 120,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    width: '100%',
  },
  refImage: { width: '100%', height: '100%' },
  refCaption: { textAlign: 'center' },
  options: { gap: Space.md },
  footer: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    gap: Space.md,
    alignItems: 'center',
  },
  reassure: { textAlign: 'center' },
  cta: { alignSelf: 'stretch' },
});

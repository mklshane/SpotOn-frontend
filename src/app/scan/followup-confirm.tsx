import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lesionTitle } from '@/components/scan/lesion-row';
import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { ActionSheet, type ActionSheetOption } from '@/components/ui/action-sheet';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScreeningSession } from '@/lib/screening-session';
import { QUESTIONS } from '@/lib/triage/questions';
import type { Answer, QuestionId } from '@/lib/triage/types';
import { useState } from 'react';

const ANSWER_LABEL: Record<Answer, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure' };

/**
 * The one screen a follow-up adds. It exists because the questionnaire measures symptoms that
 * change: silently reusing a months-old symptom profile would make the app assert an observation
 * the user never made, on their behalf, in a cancer-triage context.
 *
 * So the split is explicit — morphology answers (border, texture, size, ugly-duckling) are carried
 * and shown here for one-tap confirmation; the time-window items (has it changed, is it bleeding,
 * how long has it been there) are re-asked. See tps-core `carryForwardAnswers` for the reasoning
 * behind which item lands in which bucket.
 */
export default function FollowUpConfirmScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useScreeningSession();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  const followUp = session.followUp;
  if (!followUp) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <ThemedText type="body" themeColor="muted">
            Nothing to re-check.
          </ThemedText>
          <Button label="Back" variant="outline" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const { lesion, priorScreening: prior } = followUp;
  const title = lesionTitle(lesion);
  const { fg, bg } = tierColor(theme, prior.triage.tier);
  // Read the clock once, at mount: "3 days ago" must not shift because the screen re-rendered.
  const days = Math.max(0, Math.floor((mountedAt - Date.parse(prior.createdAt)) / 86_400_000));
  const priorDate = new Date(prior.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const carried = QUESTIONS.filter((q) => session.answers[q.id] !== undefined);
  const reask = session.questionsToReask;

  function goToCapture(source: 'camera' | 'gallery') {
    session.setSource(source);
    if (source === 'camera') {
      router.push('/scan/capture');
      return;
    }
    ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 }).then((result) => {
      if (!result.canceled && result.assets[0]) {
        router.push({ pathname: '/scan/crop', params: { uri: result.assets[0].uri, source: 'gallery' } });
      }
    });
  }

  const sourceOptions: ActionSheetOption[] = [
    { key: 'camera', label: 'Camera', icon: 'camera.fill', onPress: () => goToCapture('camera') },
    {
      key: 'gallery',
      label: 'Photo gallery',
      icon: 'photo.on.rectangle',
      onPress: () => goToCapture('gallery'),
    },
  ];

  return (
    <Screen padded={false} edges={['top']}>
      <View style={styles.header}>
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.giant }]}
        showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown} style={styles.intro}>
          <ThemedText type="title1">Re-checking {title}</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            Last checked {priorDate} · {days} {days === 1 ? 'day' : 'days'} ago
          </ThemedText>
        </Animated.View>

        {/* The previous photo — the reference the new one will be compared against. */}
        <Card padded={false} style={styles.priorCard}>
          <Image source={{ uri: prior.imageUri }} style={styles.priorPhoto} contentFit="cover" />
          <View style={styles.priorText}>
            <View style={[styles.tierPill, { backgroundColor: bg }]}>
              <ThemedText type="caption" style={{ color: fg }}>
                {prior.triage.tier === 'critical' ? 'Priority' : prior.triage.tier}
              </ThemedText>
            </View>
            <ThemedText type="footnote" themeColor="textSecondary">
              {lesion.mark?.region ?? 'Location not marked'}
            </ThemedText>
          </View>
        </Card>

        {carried.length ? (
          <View style={styles.section}>
            <ThemedText type="headline">Carried over from last time</ThemedText>
            <Card style={styles.answers}>
              {carried.map((q) => (
                <View key={q.id} style={styles.answerRow}>
                  <ThemedText type="subhead" themeColor="textSecondary" style={styles.answerLabel}>
                    {q.finding}
                  </ThemedText>
                  <ThemedText type="subhead">{ANSWER_LABEL[session.answers[q.id]!]}</ThemedText>
                </View>
              ))}
            </Card>
            <ThemedText type="footnote" themeColor="muted">
              These describe how the spot looks, which changes slowly. Tap “Update these answers” if
              any are no longer right.
            </ThemedText>
          </View>
        ) : null}

        {reask.length ? (
          <View style={styles.section}>
            <ThemedText type="headline">We’ll ask about what’s changed</ThemedText>
            <Card style={styles.answers}>
              {reask.map((id: QuestionId) => {
                const q = QUESTIONS.find((x) => x.id === id);
                if (!q) return null;
                return (
                  <View key={id} style={styles.reaskRow}>
                    <Icon name="arrow.clockwise" tintColor={theme.brand} size={15} />
                    <ThemedText type="subhead" themeColor="textSecondary" style={styles.answerLabel}>
                      {q.finding}
                    </ThemedText>
                  </View>
                );
              })}
            </Card>
            <ThemedText type="footnote" themeColor="muted">
              {reask.length} {reask.length === 1 ? 'question' : 'questions'} — these depend on time,
              so an old answer wouldn’t be accurate today.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
        <Button label="Take a new photo" variant="brand" onPress={() => setSheetOpen(true)} style={styles.cta} />
        <Button
          label="Update these answers"
          variant="ghost"
          onPress={() => router.push('/scan/questionnaire')}
        />
      </View>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Photo of this spot"
        options={sourceOptions}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base },
  header: { paddingHorizontal: Space.base, paddingTop: Space.xs, alignItems: 'flex-start' },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.sm, gap: Space.xl },
  intro: { gap: Space.xs },
  priorCard: { flexDirection: 'row', alignItems: 'center', gap: Space.base, padding: Space.md },
  priorPhoto: { width: 72, height: 72, borderRadius: Radius.md },
  priorText: { flex: 1, gap: Space.sm, alignItems: 'flex-start' },
  tierPill: { paddingHorizontal: Space.md, paddingVertical: 3, borderRadius: Radius.pill },
  section: { gap: Space.sm },
  answers: { gap: Space.md },
  answerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.base },
  reaskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  answerLabel: { flex: 1 },
  footer: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.xs, alignItems: 'center' },
  cta: { alignSelf: 'stretch' },
});

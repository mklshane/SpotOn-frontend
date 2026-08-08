import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { StepsBlock } from '@/components/learn/article-blocks';
import { EducationCard } from '@/components/learn/EducationCard';
import { LearnDetailHeader } from '@/components/learn/LearnDetailHeader';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { getTopic, getTopicReadMinutes, type ArticleBlock } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

/**
 * What the guided questionnaire will walk through once it ships. Shown as the
 * same numbered layout the Self-Check guide uses, so the preview reads as a
 * genuine explanation of the feature rather than a placeholder card.
 */
const PREVIEW: Extract<ArticleBlock, { kind: 'steps' }> = {
  kind: 'steps',
  heading: 'What it will ask you',
  intro: 'Short questions, answered in a couple of minutes.',
  steps: [
    {
      title: 'About your skin',
      detail: 'How easily you burn, how many moles you have, and how your skin usually reacts to sun.',
    },
    {
      title: 'Your sun history',
      detail: 'Time spent outdoors, past sunburns, and the protection you normally use.',
    },
    {
      title: 'Family and medical background',
      detail: 'Whether skin cancer runs in your family, and anything relevant in your own history.',
    },
    {
      title: 'Your personalised summary',
      detail: 'A plain-language read on how often to check your skin, and when it is worth seeing a dermatologist.',
    },
  ],
};

export default function LearnQuestionnaireScreen() {
  const theme = useTheme();
  const selfCheck = getTopic('self-check');

  return (
    <Screen padded={false}>
      <LearnDetailHeader title="Self-Check" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.body}>
          <Card padded={false} style={[styles.hero, { borderColor: theme.hairline }]}>
            <View style={[styles.heroArt, { backgroundColor: theme.brandTint }]} accessible={false}>
              <IconCircle icon="doc.text.fill" variant="gradient" size={92} />
            </View>
            <View style={styles.heroText}>
              <View style={styles.eyebrowRow}>
                <ThemedText type="caption" style={[styles.eyebrow, { color: theme.brandPressed }]}>
                  SELF-CHECK
                </ThemedText>
                <View style={[styles.badge, { backgroundColor: theme.elementBg }]}>
                  <ThemedText type="caption" themeColor="textSecondary" style={styles.badgeText}>
                    COMING SOON
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="title1">SpotOn Questionnaire</ThemedText>
              <ThemedText type="callout" themeColor="textSecondary">
                A guided set of questions that turns what you know about your own skin into a clear sense of how
                closely to watch it.
              </ThemedText>
            </View>
          </Card>

          <StepsBlock block={PREVIEW} />

          {selfCheck ? (
            <>
              <ThemedText type="headline" style={styles.meanwhile}>
                In the meantime
              </ThemedText>
              <EducationCard
                icon={selfCheck.icon}
                tag={`Self-Check · ${getTopicReadMinutes(selfCheck)} min read`}
                title={selfCheck.title}
                description={selfCheck.subtitle}
                onPress={() => router.push({ pathname: '/learn/article', params: { topicId: selfCheck.id } })}
              />
            </>
          ) : null}

          <View style={[styles.note, { backgroundColor: theme.brandTint }]}>
            <Icon name="info.circle.fill" size={18} tintColor={theme.brandPressed} />
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.noteText}>
              The questionnaire will estimate how much attention your skin needs. It will not diagnose anything, and
              it does not replace advice from a dermatologist.
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  body: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Space.base },
  hero: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  heroArt: { height: 168, alignItems: 'center', justifyContent: 'center' },
  heroText: { padding: Space.lg, gap: Space.xs },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  eyebrow: { fontWeight: '700', letterSpacing: 0.55 },
  badge: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontWeight: '700', letterSpacing: 0.5 },
  meanwhile: { marginTop: Space.md },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    borderRadius: Radius.md,
    padding: Space.base,
    marginTop: Space.xs,
  },
  noteText: { flex: 1 },
});

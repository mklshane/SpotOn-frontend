import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CancerTypeCard } from '@/components/learn/CancerTypeCard';
import { LearnHeroBanner } from '@/components/learn/LearnHeroBanner';
import { LearnRecommendationCard } from '@/components/learn/LearnRecommendationCard';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { Space } from '@/constants/theme';
import { getDailyLearnRecommendation, LEARN_TOPICS, type Topic } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

// The three cancer-type articles live under the 'types-of-skin-cancer' topic;
// each card deep-links straight to its article. Ordered most-serious first,
// with the accent mapped to the risk-tier palette so the section reads as a
// severity scale.
const TYPES_TOPIC_ID = 'types-of-skin-cancer';
const CANCER_TYPES = [
  {
    articleId: 'melanoma',
    kind: 'melanoma',
    title: 'Melanoma',
    color: 'riskCritical',
    tint: 'riskCriticalBg',
  },
  {
    articleId: 'scc',
    kind: 'scc',
    title: 'Squamous Cell Carcinoma',
    color: 'riskHigh',
    tint: 'riskHighBg',
  },
  {
    articleId: 'bcc',
    kind: 'bcc',
    title: 'Basal Cell Carcinoma',
    color: 'riskModerate',
    tint: 'riskModerateBg',
  },
] as const;

function onSelect(topic: Topic) {
  switch (topic.kind) {
    case 'article':
      router.push({ pathname: '/learn/article', params: { topicId: topic.id } });
      return;
    case 'subtopics':
      router.push({ pathname: '/learn/topic', params: { topicId: topic.id } });
      return;
    case 'comingSoon':
      router.push('/learn/questionnaire');
      return;
    default:
      // Exhaustiveness check: a compile error here means a new Topic kind was
      // added without teaching onSelect where it should navigate.
      topic satisfies never;
  }
}

function badgeFor(topic: Topic): string | undefined {
  if (topic.kind === 'subtopics') return `${topic.subtopics.length} topics`;
  if (topic.kind === 'comingSoon') return 'Coming soon';
  return undefined;
}

export default function LearnScreen() {
  const theme = useTheme();
  const warningSigns = LEARN_TOPICS.find((t) => t.id === 'warning-signs');
  const recommendation = getDailyLearnRecommendation();
  // The types topic is covered by the dedicated horizontal section above the topic list.
  const allTopics = LEARN_TOPICS.filter((t) => t.id !== TYPES_TOPIC_ID);

  return (
    <Screen padded={false}>
      {/* overScrollMode="never" — Android's default overscroll edge-glow uses the
          app's accent color, showing as an orange flash over content near the
          bottom tab bar when scrolling past the end. */}
      <ScrollView contentContainerStyle={styles.body} overScrollMode="never">
        <ThemedText type="largeTitle">Learn</ThemedText>

        {warningSigns ? (
          <LearnHeroBanner
            icon="exclamationmark.triangle.fill"
            title="Know the Warning Signs"
            subtitle="The ABCDE rule — a quick read that could matter."
            onPress={() => onSelect(warningSigns)}
          />
        ) : null}

        <View style={styles.section}>
          <ThemedText type="title2">Recommended for you</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            One practical skin-health reminder, refreshed daily.
          </ThemedText>
        </View>
        <LearnRecommendationCard
          image={require('@/assets/images/learn/recommended-sun-protection.jpg')}
          title={recommendation.title}
          summary={recommendation.summary}
          onPress={() => router.push({ pathname: '/learn/article', params: { topicId: recommendation.topicId } })}
        />

        <View style={styles.section}>
          <ThemedText type="title2">Skin Cancer Types</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            The three most common types — tap one to learn what to look for.
          </ThemedText>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.typeRow}
          style={styles.typeScroll}>
          {CANCER_TYPES.map((t) => (
            <CancerTypeCard
              key={t.articleId}
              kind={t.kind}
              title={t.title}
              color={theme[t.color]}
              tint={theme[t.tint]}
              onPress={() =>
                router.push({
                  pathname: '/learn/article',
                  params: { topicId: TYPES_TOPIC_ID, articleId: t.articleId },
                })
              }
            />
          ))}
        </ScrollView>

        <View style={styles.section}>
          <ThemedText type="title2">All Topics</ThemedText>
        </View>
        <Card padded={false} style={[styles.topicList, { borderColor: theme.hairline }]}>
          {allTopics.map((topic, index) => {
            const badge = badgeFor(topic);

            return (
              <View key={topic.id}>
                {index > 0 ? <View style={[styles.topicDivider, { backgroundColor: theme.hairline }]} /> : null}
                <View style={styles.topicRow}>
                  <SettingsRow
                    icon={topic.icon}
                    label={topic.title}
                    sublabel={topic.subtitle}
                    onPress={() => onSelect(topic)}
                    accessory={
                      <View style={styles.topicAccessory}>
                        {badge ? <Badge label={badge} /> : null}
                        <Icon name="chevron.right" tintColor={theme.muted} size={18} />
                      </View>
                    }
                  />
                </View>
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.base,
    // Clears the floating Scan button, which protrudes ~30px above the tab
    // bar's own top edge via a negative margin (a sibling view this screen's
    // layout doesn't otherwise know to leave room for).
    paddingBottom: 20,
    gap: Space.lg,
  },
  section: { gap: 2, marginBottom: -Space.sm },
  // Bleed the horizontal rail to the screen edges so cards scroll under the
  // body padding instead of clipping at it.
  typeScroll: { marginHorizontal: -Space.xl },
  typeRow: { gap: Space.md, paddingHorizontal: Space.xl },
  topicList: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  topicRow: { paddingHorizontal: Space.base },
  topicDivider: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  topicAccessory: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});

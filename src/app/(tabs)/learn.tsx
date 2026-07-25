import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CancerTypeCard } from '@/components/learn/CancerTypeCard';
import { LearnHeroBanner } from '@/components/learn/LearnHeroBanner';
import { TopicCard } from '@/components/learn/TopicCard';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { LEARN_TOPICS, type Topic } from '@/data/learn-content';
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

/** Chunks topics into rows of 2 so each row's two cards can stretch to match
 * each other's height, instead of the taller card in a wrapped flex grid
 * leaving mismatched blank space in shorter neighbors. */
function pairUp(topics: Topic[]): Topic[][] {
  const rows: Topic[][] = [];
  for (let i = 0; i < topics.length; i += 2) {
    rows.push(topics.slice(i, i + 2));
  }
  return rows;
}

export default function LearnScreen() {
  const theme = useTheme();
  const warningSigns = LEARN_TOPICS.find((t) => t.id === 'warning-signs');
  // The types topic is covered by the dedicated section above the grid.
  const gridTopics = LEARN_TOPICS.filter((t) => t.id !== TYPES_TOPIC_ID);

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
        <View style={styles.grid}>
          {pairUp(gridTopics).map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((topic) => (
                <TopicCard
                  key={topic.id}
                  icon={topic.icon}
                  title={topic.title}
                  subtitle={topic.subtitle}
                  badge={badgeFor(topic)}
                  onPress={() => onSelect(topic)}
                />
              ))}
              {row.length === 1 ? <View style={styles.spacer} /> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.base,
    paddingBottom: Space.xxxl,
    gap: Space.lg,
  },
  section: { gap: 2, marginBottom: -Space.sm },
  // Bleed the horizontal rail to the screen edges so cards scroll under the
  // body padding instead of clipping at it.
  typeScroll: { marginHorizontal: -Space.xl },
  typeRow: { gap: Space.md, paddingHorizontal: Space.xl },
  grid: { gap: Space.base },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: Space.base },
  spacer: { flex: 1 },
});

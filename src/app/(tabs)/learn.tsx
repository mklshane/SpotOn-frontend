import { t, localizedCopy, useLocale } from '@/lib/i18n';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CancerTypeCard } from '@/components/learn/CancerTypeCard';
import { ConditionsCard } from '@/components/learn/ConditionsCard';
import { EducationCard } from '@/components/learn/EducationCard';
import { FeaturedEducationCard } from '@/components/learn/FeaturedEducationCard';
import { ThemedText } from '@/components/themed-text';
import { Entrance, EntranceProvider } from '@/components/ui/entrance';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { TabContentInset } from '@/components/ui/tab-bar';
import { Space } from '@/constants/theme';
import {
  getCategoryLabel,
  getDailyLearnRecommendation,
  getTopicReadMinutes,
  LEARN_TOPICS,
  type LearnCategoryId,
  type Topic,
} from '@/data/learn-content';
import { useCurrentConditions } from '@/hooks/use-current-conditions';
import { useTheme } from '@/hooks/use-theme';

// Two topics are promoted into their own blocks above the list: the featured
// card and the horizontal types rail. The browse list skips them rather than
// repeating them.
const FEATURED_TOPIC_ID = 'warning-signs';
const TYPES_TOPIC_ID = 'types-of-skin-cancer';

const FEATURED_IMAGE = require('@/assets/images/learn/article-self-check.jpg');
const TIP_IMAGE = require('@/assets/images/learn/recommended-sun-protection.jpg');

// The three cancer-type articles live under the 'types-of-skin-cancer' topic;
// each card deep-links straight to its article. Ordered most-serious first,
// with the accent mapped to the risk-tier palette so the section reads as a
// severity scale.
const CANCER_TYPES = localizedCopy([
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
] as const);

/** A single browsable topic row. */
type Entry = {
  key: string;
  title: string;
  description: string;
  /** Category + length, rendered as the card's uppercase eyebrow. */
  tag: string;
  icon: Topic['icon'];
  category: LearnCategoryId;
  onPress: () => void;
};

function openTopic(topic: Topic) {
  switch (topic.kind) {
    case 'article':
      router.push({
        pathname: '/learn/article',
        params: { topicId: topic.id },
      });
      return;
    case 'subtopics':
      router.push({ pathname: '/learn/topic', params: { topicId: topic.id } });
      return;
    case 'comingSoon':
      router.push('/learn/questionnaire');
      return;
    default:
      // Exhaustiveness check: a compile error here means a new Topic kind was
      // added without teaching openTopic where it should navigate.
      topic satisfies never;
  }
}

function lengthLabel(topic: Topic): string {
  if (topic.kind === 'subtopics') return `${topic.subtopics.length} guides`;
  if (topic.kind === 'comingSoon') return 'Coming soon';
  return `${getTopicReadMinutes(topic)} min read`;
}

function topicEntry(topic: Topic): Entry {
  const tag = `${getCategoryLabel(topic.category)} · ${lengthLabel(topic)}`;

  return {
    key: topic.id,
    title: topic.title,
    description: topic.subtitle,
    tag,
    icon: topic.icon,
    category: topic.category,
    onPress: () => openTopic(topic),
  };
}

export default function LearnScreen() {
  useLocale();
  const theme = useTheme();

  const featured = LEARN_TOPICS.find((t) => t.id === FEATURED_TOPIC_ID);
  const recommendation = getDailyLearnRecommendation();
  // Live temp + UV: online-only. 'hidden' leaves the screen exactly as it is offline.
  const conditions = useCurrentConditions();
  // Indices after the conditions card shift by one only when it is shown.
  const o = conditions.status === 'hidden' ? 0 : 1;
  const results = LEARN_TOPICS.filter(
    (t) => t.id !== FEATURED_TOPIC_ID && t.id !== TYPES_TOPIC_ID
  ).map(topicEntry);

  return (
    <Screen padded={false} edges={['top']}>
      {/* overScrollMode="never" - Android's default overscroll edge-glow uses the
          app's accent color, showing as an orange flash over content near the
          bottom tab bar when scrolling past the end. */}
      <ScrollView
        contentContainerStyle={styles.body}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}>
        <EntranceProvider screen="learn">
          <Entrance index={0} style={styles.header}>
            <ThemedText type="largeTitle">{t('Learn')}</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              {t('Short, practical guides on caring for your skin.')}
            </ThemedText>
          </Entrance>

          {featured ? (
            <Entrance index={1}>
              <FeaturedEducationCard
                image={FEATURED_IMAGE}
                imageLabel="A woman checking the skin on her forearm"
                category={getCategoryLabel(featured.category)}
                title={t('Know the warning signs')}
                description={t(
                  'The ABCDE rule, and five things to look for in a mole, in one quick read.'
                )}
                meta={lengthLabel(featured)}
                onPress={() => openTopic(featured)}
              />
            </Entrance>
          ) : null}

          {conditions.status !== 'hidden' ? (
            <Entrance index={2}>
              <ConditionsCard
                data={conditions.data}
                placeName={conditions.placeName}
                usingDefault={conditions.usingDefault}
                onRequestLocation={() => void conditions.requestLocation()}
                onPress={() =>
                  router.push({
                    pathname: '/learn/article',
                    params: { topicId: recommendation.topicId },
                  })
                }
              />
            </Entrance>
          ) : null}

          <Entrance index={2 + o}>
            <EducationCard
              image={TIP_IMAGE}
              imageLabel="A woman applying sunscreen outdoors"
              tag="Today's tip"
              title={recommendation.title}
              description={recommendation.summary}
              onPress={() =>
                router.push({
                  pathname: '/learn/article',
                  params: { topicId: recommendation.topicId },
                })
              }
            />
          </Entrance>

          <>
            <Entrance index={3 + o} style={styles.sectionHeader}>
              <SectionHeader
                title={t('Skin cancer types')}
                subtitle={t('The three most common types. Tap one to see what to look for.')}
              />
            </Entrance>
            <Entrance index={4 + o}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.rail}
                contentContainerStyle={styles.typeRow}>
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
                        params: {
                          topicId: TYPES_TOPIC_ID,
                          articleId: t.articleId,
                        },
                      })
                    }
                  />
                ))}
              </ScrollView>
            </Entrance>
          </>

          <Entrance index={5 + o} style={styles.sectionHeader}>
            <SectionHeader
              title={t('More topics')}
              subtitle={t('Short guides you can read anytime, even offline.')}
            />
          </Entrance>

          <View style={styles.list}>
            {results.map((entry, i) => (
              <Entrance key={entry.key} index={6 + o + i}>
                <EducationCard
                  icon={entry.icon}
                  tag={entry.tag}
                  title={entry.title}
                  description={entry.description}
                  onPress={entry.onPress}
                />
              </Entrance>
            ))}
          </View>
        </EntranceProvider>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    // Clears the floating Scan button, which protrudes ~30px above the tab
    // bar's own top edge via a negative margin (a sibling view this screen's
    // layout doesn't otherwise know to leave room for).
    paddingBottom: TabContentInset,
    gap: Space.base,
  },
  header: { gap: Space.xs, marginBottom: Space.xs },
  // Section headers add to the container's 16 gap for a 28pt section break.
  sectionHeader: { marginTop: Space.md },
  // Bleed the horizontal rails to the screen edges so their contents scroll
  // under the body padding instead of clipping at it.
  rail: { marginHorizontal: -Space.xl },
  typeRow: { gap: Space.md, paddingHorizontal: Space.xl },
  list: { gap: Space.md },
});

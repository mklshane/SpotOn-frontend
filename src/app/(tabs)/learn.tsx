import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CancerTypeCard } from '@/components/learn/CancerTypeCard';
import { EducationCard } from '@/components/learn/EducationCard';
import { FeaturedEducationCard } from '@/components/learn/FeaturedEducationCard';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { Entrance, EntranceProvider } from '@/components/ui/entrance';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { SearchBar } from '@/components/ui/search-bar';
import { SectionHeader } from '@/components/ui/section-header';
import { Motion, Space } from '@/constants/theme';
import {
  getCategoryLabel,
  getDailyLearnRecommendation,
  getArticleReadMinutes,
  getTopicReadMinutes,
  LEARN_CATEGORIES,
  LEARN_TOPICS,
  type LearnCategoryId,
  type Topic,
} from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

// Two topics are promoted into their own blocks above the list — the featured
// card and the horizontal types rail — so the browse list below skips them
// rather than repeating them. Filtering or searching still reaches both.
const FEATURED_TOPIC_ID = 'warning-signs';
const TYPES_TOPIC_ID = 'types-of-skin-cancer';

// The chip rail lands just after the search field and runs tighter than the
// page's own stagger, so the row reads as one sweep instead of seven arrivals.
const CHIP_ENTRANCE_DELAY = 2 * Motion.entrance.stagger;
const CHIP_ENTRANCE_STAGGER = 18;

const FEATURED_IMAGE = require('@/assets/images/learn/article-self-check.jpg');
const TIP_IMAGE = require('@/assets/images/learn/recommended-sun-protection.jpg');

// The three cancer-type articles live under the 'types-of-skin-cancer' topic;
// each card deep-links straight to its article. Ordered most-serious first,
// with the accent mapped to the risk-tier palette so the section reads as a
// severity scale.
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

type FilterId = LearnCategoryId | 'all';

const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  ...LEARN_CATEGORIES,
];

/** A single browsable row — either a topic, or an article nested inside one. */
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
  return {
    key: topic.id,
    title: topic.title,
    description: topic.subtitle,
    tag: `${getCategoryLabel(topic.category)} · ${lengthLabel(topic)}`,
    icon: topic.icon,
    category: topic.category,
    onPress: () => openTopic(topic),
  };
}

/**
 * Every topic, plus the articles nested under a `subtopics` topic. The nested
 * articles are only ever surfaced by search — in the browsed list they would
 * duplicate their parent — so someone typing "melanoma" lands on the article
 * instead of an empty result.
 */
function buildEntries(): { topics: Entry[]; nested: Entry[] } {
  const topics = LEARN_TOPICS.map(topicEntry);

  const nested = LEARN_TOPICS.flatMap((topic) =>
    topic.kind === 'subtopics'
      ? topic.subtopics.map<Entry>((article) => ({
          key: `${topic.id}/${article.id}`,
          title: article.title,
          description: article.summary,
          tag: `${topic.title} · ${getArticleReadMinutes(article)} min read`,
          icon: article.icon,
          category: topic.category,
          onPress: () =>
            router.push({
              pathname: '/learn/article',
              params: { topicId: topic.id, articleId: article.id },
            }),
        }))
      : []
  );

  return { topics, nested };
}

function matches(entry: Entry, query: string): boolean {
  const haystack = `${entry.title} ${entry.description} ${entry.tag}`.toLowerCase();
  return haystack.includes(query);
}

export default function LearnScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');

  const { topics, nested } = useMemo(() => buildEntries(), []);
  const featured = LEARN_TOPICS.find((t) => t.id === FEATURED_TOPIC_ID);
  const recommendation = getDailyLearnRecommendation();

  const trimmedQuery = query.trim().toLowerCase();
  const searching = trimmedQuery.length > 0;
  const filtering = filter !== 'all';
  // The curated blocks (featured, tip, types rail) only make sense when nothing
  // is narrowing the catalog; otherwise the screen is a single result list.
  const browsing = !searching && !filtering;

  const results = useMemo(() => {
    if (browsing) {
      return topics.filter((entry) => entry.key !== FEATURED_TOPIC_ID && entry.key !== TYPES_TOPIC_ID);
    }

    // Search widens the pool to nested articles; the chip, when set, still
    // narrows it — the two compose rather than one overriding the other.
    let pool = searching ? [...topics, ...nested] : topics;
    if (filtering) pool = pool.filter((entry) => entry.category === filter);
    if (searching) pool = pool.filter((entry) => matches(entry, trimmedQuery));

    return pool;
  }, [browsing, filter, filtering, nested, searching, topics, trimmedQuery]);

  let listTitle = 'More topics';
  let listSubtitle: string | undefined = 'Short guides you can read anytime, even offline.';
  if (searching) {
    listTitle = 'Results';
    listSubtitle = `${results.length} ${results.length === 1 ? 'guide' : 'guides'} for “${query.trim()}”`;
  } else if (filtering) {
    listTitle = getCategoryLabel(filter);
    listSubtitle = `${results.length} ${results.length === 1 ? 'guide' : 'guides'}`;
  }

  return (
    <Screen padded={false}>
      {/* overScrollMode="never" — Android's default overscroll edge-glow uses the
          app's accent color, showing as an orange flash over content near the
          bottom tab bar when scrolling past the end. */}
      <ScrollView
        contentContainerStyle={styles.body}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <EntranceProvider screen="learn">
          <Entrance index={0} style={styles.header}>
            <ThemedText type="largeTitle">Learn</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              Short, practical guides on caring for your skin.
            </ThemedText>
          </Entrance>

          <Entrance index={1}>
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Search guides and topics"
              shape="lg"
              elevation="sm"
            />
          </Entrance>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.rail}
            contentContainerStyle={styles.chipRailContent}>
            {FILTERS.map((option, i) => (
              // The rail runs on its own faster rhythm than the page sequence,
              // so seven chips read as one gesture rather than seven arrivals.
              <Entrance key={option.id} delay={CHIP_ENTRANCE_DELAY + i * CHIP_ENTRANCE_STAGGER}>
                <Chip
                  label={option.label}
                  variant="solid"
                  active={filter === option.id}
                  onPress={() => setFilter(option.id)}
                />
              </Entrance>
            ))}
          </ScrollView>

          {browsing && featured ? (
            <Entrance index={3}>
              <FeaturedEducationCard
                image={FEATURED_IMAGE}
                imageLabel="A woman checking the skin on her forearm"
                category={getCategoryLabel(featured.category)}
                title="Know the warning signs"
                description="The ABCDE rule, and five things to look for in a mole, in one quick read."
                meta={lengthLabel(featured)}
                onPress={() => openTopic(featured)}
              />
            </Entrance>
          ) : null}

          {browsing ? (
            <Entrance index={4}>
              <EducationCard
                image={TIP_IMAGE}
                imageLabel="A woman applying sunscreen outdoors"
                tag="Today's tip"
                title={recommendation.title}
                description={recommendation.summary}
                onPress={() =>
                  router.push({ pathname: '/learn/article', params: { topicId: recommendation.topicId } })
                }
              />
            </Entrance>
          ) : null}

          {browsing ? (
            <>
              <Entrance index={5} style={styles.sectionHeader}>
                <SectionHeader
                  title="Skin cancer types"
                  subtitle="The three most common types. Tap one to see what to look for."
                />
              </Entrance>
              <Entrance index={6}>
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
                          params: { topicId: TYPES_TOPIC_ID, articleId: t.articleId },
                        })
                      }
                    />
                  ))}
                </ScrollView>
              </Entrance>
            </>
          ) : null}

          <Entrance index={7} style={styles.sectionHeader}>
            <SectionHeader title={listTitle} subtitle={listSubtitle} />
          </Entrance>

          {results.length === 0 ? (
            <ListState
              kind="empty"
              title="Nothing here yet"
              subtitle="Try a different word, or switch back to All."
            />
          ) : (
            <View style={styles.list}>
              {results.map((entry, i) => (
                <Entrance key={entry.key} index={8 + i}>
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
          )}
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
    paddingBottom: Space.lg,
    gap: Space.base,
  },
  header: { gap: Space.xs, marginBottom: Space.xs },
  // Section headers add to the container's 16 gap for a 28pt section break.
  sectionHeader: { marginTop: Space.md },
  // Bleed the horizontal rails to the screen edges so their contents scroll
  // under the body padding instead of clipping at it.
  rail: { marginHorizontal: -Space.xl },
  // A horizontal ScrollView clips to its bounds, and those bounds are exactly
  // the content's height. Without vertical padding the filter chips' shadow
  // (Elevation.sm reaches 6pt above and 10pt below a chip) is drawn outside the
  // scroll view and cut off, flattening the pills' bottom edge. This padding is
  // the shadow's room, not decoration: it lands the surrounding gaps on 24 and
  // 28, both section-gap values on the scale.
  chipRailContent: {
    gap: Space.sm,
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    paddingBottom: Space.md,
  },
  typeRow: { gap: Space.md, paddingHorizontal: Space.xl },
  list: { gap: Space.md },
});

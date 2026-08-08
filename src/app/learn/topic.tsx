import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CancerTypeArtwork, type CancerTypeKind } from '@/components/learn/CancerTypeCard';
import { EducationCard } from '@/components/learn/EducationCard';
import { LearnDetailHeader, learnDetailContent } from '@/components/learn/LearnDetailHeader';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { getArticleReadMinutes, getTopic } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

// The three artworks, ordered least to most serious, so the intro reads as a
// scale left to right and matches the order of the cards beneath it.
const INTRO_ARTWORK: CancerTypeKind[] = ['bcc', 'scc', 'melanoma'];

export default function LearnTopicScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 375;
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const topic = topicId ? getTopic(topicId) : undefined;

  return (
    <Screen padded={false}>
      <LearnDetailHeader title={topic?.title ?? 'Topic'} />

      {!topic || topic.kind !== 'subtopics' ? (
        <ListState kind="error" title="Topic not found" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}>
          <View style={styles.body}>
            <Card padded={false} style={[styles.introCard, { borderColor: theme.hairline }]}>
              <View
                style={[styles.artworkRow, { backgroundColor: theme.brandTint }, compact && styles.artworkRowCompact]}
                accessible={false}>
                {INTRO_ARTWORK.map((kind) => (
                  <View
                    key={kind}
                    style={[styles.medallion, { backgroundColor: theme.surface }, compact && styles.medallionCompact]}>
                    <CancerTypeArtwork kind={kind} size={compact ? 54 : 68} />
                  </View>
                ))}
              </View>
              <View style={styles.introText}>
                <ThemedText type="caption" style={[styles.eyebrow, { color: theme.brandPressed }]}>
                  BASICS
                </ThemedText>
                <ThemedText type="title2">Know the common types</ThemedText>
                <ThemedText type="callout" themeColor="textSecondary">
                  Three types account for almost every skin cancer. Compare what each one looks like, how serious it
                  is, and where it tends to appear.
                </ThemedText>
              </View>
            </Card>

            <View style={styles.list}>
              {topic.subtopics.map((article) => (
                <EducationCard
                  key={article.id}
                  icon={article.icon}
                  tag={`${getArticleReadMinutes(article)} min read`}
                  title={article.title}
                  description={article.summary}
                  onPress={() =>
                    router.push({ pathname: '/learn/article', params: { topicId: topic.id, articleId: article.id } })
                  }
                />
              ))}
            </View>

            <View style={[styles.note, { backgroundColor: theme.elementBg }]}>
              <Icon name="info.circle.fill" size={18} tintColor={theme.brandPressed} />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.noteText}>
                Ordered from least to most serious. All three are treatable, and all three are far simpler to treat
                when they are found early.
              </ThemedText>
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: learnDetailContent,
  body: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Space.base },
  introCard: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  artworkRow: {
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
  },
  artworkRowCompact: { minHeight: 112, paddingHorizontal: Space.sm },
  medallion: {
    width: 82,
    height: 82,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionCompact: { width: 66, height: 66 },
  introText: { padding: Space.lg, gap: Space.xs },
  eyebrow: { fontWeight: '700', letterSpacing: 0.55 },
  list: { gap: Space.md, marginTop: Space.xs },
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

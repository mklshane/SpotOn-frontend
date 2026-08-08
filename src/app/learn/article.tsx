import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  BodyAreasBlock,
  CompareBlock,
  ImageCreditsBlock,
  ListBlock,
  NoticeBlock,
  ProseGroup,
  SourcesBlock,
  StepsBlock,
  VisualBlock,
} from '@/components/learn/article-blocks';
import { LearnArticleHero } from '@/components/learn/LearnArticleHero';
import { LearnDetailHeader, learnDetailContent } from '@/components/learn/LearnDetailHeader';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Reveal, ScrollRevealProvider, useScrollReveal } from '@/components/ui/scroll-reveal';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import {
  getArticle,
  getArticleReadMinutes,
  getCategoryLabel,
  getTopic,
  type ArticleBlock,
} from '@/data/learn-content';
import type { ClinicalImageId } from '@/data/learn-images';
import { useTheme } from '@/hooks/use-theme';

type ProseBlock = Extract<ArticleBlock, { kind: 'prose' }>;

/** A run of consecutive prose blocks, or a single richer block. */
type RenderGroup = { kind: 'prose'; blocks: ProseBlock[] } | { kind: 'block'; block: ArticleBlock };

/**
 * Consecutive prose sections share one divided card, the way a normal article
 * body reads. Anything with its own layout (diagrams, steps, icon rows, body
 * artwork) stands on its own so the shape of the content is visible before it
 * is read.
 */
function groupBlocks(blocks: ArticleBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = [];

  for (const block of blocks) {
    if (block.kind !== 'prose') {
      groups.push({ kind: 'block', block });
      continue;
    }

    const last = groups[groups.length - 1];
    if (last?.kind === 'prose') last.blocks.push(block);
    else groups.push({ kind: 'prose', blocks: [block] });
  }

  return groups;
}

function renderBlock(block: ArticleBlock, key: number) {
  switch (block.kind) {
    case 'compare':
      return <CompareBlock key={key} block={block} />;
    case 'steps':
      return <StepsBlock key={key} block={block} />;
    case 'list':
      return <ListBlock key={key} block={block} />;
    case 'visual':
      return <VisualBlock key={key} block={block} />;
    case 'bodyAreas':
      return <BodyAreasBlock key={key} block={block} />;
    case 'notice':
      return <NoticeBlock key={key} block={block} />;
    case 'sources':
      return <SourcesBlock key={key} block={block} />;
    case 'prose':
      // Prose is grouped into shared cards before it reaches here.
      return null;
    default:
      return block satisfies never;
  }
}

export default function LearnArticleScreen() {
  const theme = useTheme();
  const { topicId, articleId } = useLocalSearchParams<{ topicId: string; articleId?: string }>();
  const article = topicId ? getArticle(topicId, articleId) : undefined;
  const topic = topicId ? getTopic(topicId) : undefined;

  const groups = useMemo(() => (article ? groupBlocks(article.blocks) : []), [article]);
  const { value: reveal, onScroll } = useScrollReveal();

  // A nested article belongs to its parent topic (a skin cancer type); a
  // top-level one is labelled by the category its browse chip uses.
  const eyebrow = !topic
    ? 'Education guide'
    : topic.kind === 'subtopics'
      ? 'Skin cancer type'
      : getCategoryLabel(topic.category);

  // Articles that end on their own notice already close with a takeaway, so the
  // standing disclaimer would only repeat the beat.
  const hasNotice = article?.blocks.some((block) => block.kind === 'notice') ?? false;

  // Every clinical image slot this article renders. Only the slots holding a
  // real, licensed photograph produce a credit; while they are all diagrams the
  // credits section renders nothing at all.
  const imageIds = useMemo<ClinicalImageId[]>(() => {
    if (!article) return [];

    return article.blocks.flatMap<ClinicalImageId>((block) => {
      if (block.kind === 'compare') {
        return block.items.flatMap((item) => [item.photos.typical, item.photos.concern]);
      }
      if (block.kind === 'visual' && block.photo) return [block.photo];
      return [];
    });
  }, [article]);

  return (
    <Screen padded={false}>
      <LearnDetailHeader title="Education" />

      {!article ? (
        <ListState kind="error" title="Article not found" />
      ) : (
        <ScrollRevealProvider value={reveal}>
          <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="automatic"
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scrollContent}>
            <View style={styles.body}>
              <LearnArticleHero
                articleId={article.id}
                icon={article.icon}
                eyebrow={eyebrow}
                title={article.title}
                meta={`${getArticleReadMinutes(article)} min read`}
              />

              {groups.map((group, index) => (
                <Reveal key={index}>
                  {group.kind === 'prose' ? (
                    <ProseGroup blocks={group.blocks} />
                  ) : (
                    renderBlock(group.block, index)
                  )}
                </Reveal>
              ))}

              <ImageCreditsBlock imageIds={imageIds} />

              {!hasNotice ? (
                <View style={[styles.educationNote, { backgroundColor: theme.brandTint }]}>
                  <Icon name="info.circle.fill" size={18} tintColor={theme.brandPressed} />
                  <ThemedText type="footnote" themeColor="textSecondary" style={styles.educationNoteText}>
                    This guide supports skin-health awareness and does not replace advice from a dermatologist.
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </Animated.ScrollView>
        </ScrollRevealProvider>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: learnDetailContent,
  body: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Space.base },
  educationNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    borderRadius: Radius.md,
    padding: Space.base,
    marginTop: Space.xs,
  },
  educationNoteText: { flex: 1 },
});

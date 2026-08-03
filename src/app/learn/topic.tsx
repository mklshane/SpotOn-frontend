import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CancerTypeArtwork, type CancerTypeKind } from '@/components/learn/CancerTypeCard';
import { TopicRow } from '@/components/learn/TopicRow';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { getTopic } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

export default function LearnTopicScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const topic = topicId ? getTopic(topicId) : undefined;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          {topic?.title ?? 'Topic'}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

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
                {(['bcc', 'scc', 'melanoma'] as CancerTypeKind[]).map((kind) => (
                  <View
                    key={kind}
                    style={[styles.medallion, { backgroundColor: theme.surface }, compact && styles.medallionCompact]}>
                    <CancerTypeArtwork kind={kind} size={compact ? 54 : 68} />
                  </View>
                ))}
              </View>
              <View style={styles.introText}>
                <ThemedText type="title2">Know the common types</ThemedText>
                <ThemedText type="callout" themeColor="textSecondary">
                  Compare their common signs, risk levels, and typical treatment options.
                </ThemedText>
              </View>
            </Card>

            <View>
              {topic.subtopics.map((sub) => (
                <TopicRow
                  key={sub.id}
                  icon={sub.icon}
                  title={sub.title}
                  subtitle={sub.sections[0]?.paragraphs[0] ?? ''}
                  onPress={() =>
                    router.push({ pathname: '/learn/article', params: { topicId: topic.id, articleId: sub.id } })
                  }
                />
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
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
  scrollContent: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  body: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Space.lg },
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
});

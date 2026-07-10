import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TopicRow } from '@/components/learn/TopicRow';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { getTopic } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

export default function LearnTopicScreen() {
  const theme = useTheme();
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
        <ScrollView contentContainerStyle={styles.body}>
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
  body: { paddingHorizontal: Space.xl, paddingTop: Space.base, paddingBottom: Space.xxxl },
});

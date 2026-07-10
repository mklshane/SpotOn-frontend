import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { TopicRow } from '@/components/learn/TopicRow';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { LEARN_TOPICS, type Topic } from '@/data/learn-content';

function onSelect(topic: Topic) {
  if (topic.kind === 'article') {
    router.push({ pathname: '/learn/article', params: { topicId: topic.id } });
  } else if (topic.kind === 'subtopics') {
    router.push({ pathname: '/learn/topic', params: { topicId: topic.id } });
  } else {
    router.push('/learn/questionnaire');
  }
}

export default function LearnScreen() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="largeTitle" style={styles.title}>
          Learn
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.subtitle}>
          Understand skin cancer signs, the ABCDEs, and when to see a doctor.
        </ThemedText>
        {LEARN_TOPICS.map((topic) => (
          <TopicRow
            key={topic.id}
            icon={topic.icon}
            title={topic.title}
            subtitle={topic.subtitle}
            onPress={() => onSelect(topic)}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Space.xl, paddingTop: Space.base, paddingBottom: Space.xxxl },
  title: { marginBottom: Space.xs },
  subtitle: { marginBottom: Space.xl },
});

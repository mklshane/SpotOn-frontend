import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SearchBar } from '@/components/directory/SearchBar';
import { LearnHeroBanner } from '@/components/learn/LearnHeroBanner';
import { TopicCard } from '@/components/learn/TopicCard';
import { ThemedText } from '@/components/themed-text';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { LEARN_TOPICS, type Topic } from '@/data/learn-content';
import { useAuth } from '@/lib/auth';

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
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LEARN_TOPICS;
    return LEARN_TOPICS.filter(
      (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
    );
  }, [query]);

  const warningSigns = LEARN_TOPICS.find((t) => t.id === 'warning-signs');

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <IconCircle icon="person.fill" variant="tint" size={48} />
          <View style={styles.greeting}>
            <ThemedText type="callout" themeColor="muted">
              Hello,
            </ThemedText>
            <ThemedText type="title2">{firstName}</ThemedText>
          </View>
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Search topics…" />

        {!query && warningSigns ? (
          <LearnHeroBanner
            icon="exclamationmark.triangle.fill"
            title="Know the Warning Signs"
            subtitle="The ABCDE rule — a quick read that could matter."
            onPress={() => onSelect(warningSigns)}
          />
        ) : null}

        <ThemedText type="title2">All Topics</ThemedText>

        <View style={styles.grid}>
          {pairUp(filtered).map((row, i) => (
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  greeting: { gap: 2 },
  grid: { gap: Space.md },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: Space.md },
  spacer: { flex: 1 },
});

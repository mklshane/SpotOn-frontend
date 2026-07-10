import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { getArticle } from '@/data/learn-content';
import { useTheme } from '@/hooks/use-theme';

export default function LearnArticleScreen() {
  const theme = useTheme();
  const { topicId, articleId } = useLocalSearchParams<{ topicId: string; articleId?: string }>();
  const article = topicId ? getArticle(topicId, articleId) : undefined;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          {article?.title ?? 'Article'}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {!article ? (
        <ListState kind="error" title="Article not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <IconCircle icon={article.icon} variant="gradient" size={88} style={styles.hero} />
          <ThemedText type="title1" style={styles.title}>
            {article.title}
          </ThemedText>
          {article.sections.map((section, i) => (
            <View key={i} style={styles.section}>
              {section.heading ? (
                <ThemedText type="headline">{section.heading}</ThemedText>
              ) : null}
              {section.paragraphs.map((p, j) => (
                <ThemedText key={j} type="body" themeColor="textSecondary">
                  {p}
                </ThemedText>
              ))}
            </View>
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
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, alignItems: 'center' },
  hero: { marginTop: Space.base, marginBottom: Space.base },
  title: { textAlign: 'center', marginBottom: Space.lg },
  section: { alignSelf: 'stretch', gap: Space.xs, marginBottom: Space.lg },
});

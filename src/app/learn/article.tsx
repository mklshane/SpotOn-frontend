import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Elevation, Radius, Space } from '@/constants/theme';
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
          <View style={[styles.identityCard, { backgroundColor: theme.surface }, Elevation.sm]}>
            <IconCircle icon={article.icon} variant="gradient" size={56} />
            <View style={styles.identityText}>
              <ThemedText type="title2">{article.title}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {article.sections.length} {article.sections.length === 1 ? 'section' : 'sections'}
              </ThemedText>
            </View>
          </View>

          {article.sections.map((section, i) => (
            <View key={i} style={[styles.sectionRow, { backgroundColor: theme.surface }, Elevation.sm]}>
              <View style={[styles.sectionIcon, { backgroundColor: theme.brandTint }]}>
                <Icon name="doc.text.fill" size={16} tintColor={theme.brand} />
              </View>
              <View style={styles.sectionText}>
                {section.heading ? <ThemedText type="headline">{section.heading}</ThemedText> : null}
                {section.paragraphs.map((p, j) => (
                  <ThemedText key={j} type="body" themeColor="textSecondary">
                    {p}
                  </ThemedText>
                ))}
              </View>
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
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    borderRadius: Radius.xl,
    padding: Space.lg,
  },
  identityText: { flex: 1, gap: 2 },
  sectionRow: { flexDirection: 'row', gap: Space.base, borderRadius: Radius.lg, padding: Space.base },
  sectionIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionText: { flex: 1, gap: Space.xs },
});

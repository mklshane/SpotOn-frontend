import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LearnArticleHero } from '@/components/learn/LearnArticleHero';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
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
          Education
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {!article ? (
        <ListState kind="error" title="Article not found" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}>
          <View style={styles.body}>
            <LearnArticleHero
              articleId={article.id}
              icon={article.icon}
              title={article.title}
              sectionCount={article.sections.length}
            />

            <Card padded={false} style={[styles.article, { borderColor: theme.hairline }]}>
              {article.sections.map((section, i) => (
                <View key={i}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: theme.hairline }]} /> : null}
                  <View style={styles.section}>
                    {section.heading ? (
                      <View style={styles.sectionHeading}>
                        <View style={[styles.headingAccent, { backgroundColor: theme.brand }]} />
                        <ThemedText type="headline" style={styles.headingText}>
                          {section.heading}
                        </ThemedText>
                      </View>
                    ) : null}
                    <View style={styles.paragraphs}>
                      {section.paragraphs.map((paragraph, j) => (
                        <ThemedText key={j} type="body" themeColor="textSecondary">
                          {paragraph}
                        </ThemedText>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </Card>

            <View style={[styles.educationNote, { backgroundColor: theme.brandTint }]}>
              <Icon name="info.circle.fill" size={18} tintColor={theme.brandPressed} />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.educationNoteText}>
                This guide supports skin-health awareness and does not replace advice from a dermatologist.
              </ThemedText>
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
  article: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Space.lg },
  section: { padding: Space.lg, gap: Space.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  headingAccent: { width: 4, height: 20, borderRadius: 2 },
  headingText: { flex: 1 },
  paragraphs: { gap: Space.sm },
  educationNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    borderRadius: Radius.md,
    padding: Space.base,
  },
  educationNoteText: { flex: 1 },
});

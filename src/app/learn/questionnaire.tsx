import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function LearnQuestionnaireScreen() {
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Questionnaire
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.center}>
        <IconCircle icon="doc.text.fill" variant="tint" size={88} />
        <ThemedText type="title1" style={styles.title}>
          SpotOn Questionnaire
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.subtitle}>
          A guided self-check to help assess your risk.
        </ThemedText>
        <View style={[styles.badge, { backgroundColor: theme.brandTint }]}>
          <ThemedText type="caption" themeColor="brand" style={styles.badgeText}>
            COMING SOON
          </ThemedText>
        </View>
      </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base, paddingHorizontal: Space.xl },
  title: { marginTop: Space.sm, textAlign: 'center' },
  subtitle: { textAlign: 'center', maxWidth: 300 },
  badge: { marginTop: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: Radius.pill },
  badgeText: { letterSpacing: 0.5, fontWeight: '600' },
});

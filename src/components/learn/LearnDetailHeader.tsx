import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type LearnDetailHeaderProps = {
  /** Centered label. Names the section, not the article, so it stays short. */
  title: string;
};

/**
 * The back bar shared by every Education detail screen. Extracted so the three
 * of them cannot drift apart in height, hit area, or tint, which is the first
 * thing that gives away a screen as belonging to a different design.
 */
export function LearnDetailHeader({ title }: LearnDetailHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.header}>
      <PressableScale
        hitSlop={12}
        scaleTo={0.88}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back">
        <Icon name="chevron.left" tintColor={theme.brand} size={20} />
      </PressableScale>
      <ThemedText type="headline" themeColor="textSecondary" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  title: { flex: 1, textAlign: 'center' },
  // Balances the back chevron so the title stays optically centered.
  spacer: { width: 20 },
});

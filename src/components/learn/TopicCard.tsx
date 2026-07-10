import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { type IconName } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TopicCardProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
};

/** 2-column grid tile for the Learn hub — icon + title + subtitle, no chevron. */
export function TopicCard({ icon, title, subtitle, onPress }: TopicCardProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: theme.surface }, Elevation.sm]}>
        <IconCircle icon={icon} variant="tint" size={44} />
        <ThemedText type="headline" numberOfLines={2} style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
          {subtitle}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '48%' },
  card: { borderRadius: Radius.lg, padding: Space.base, minHeight: 152, gap: Space.xs },
  title: { marginTop: Space.xs },
});

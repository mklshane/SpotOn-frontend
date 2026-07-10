import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { ThemedText } from '@/components/themed-text';
import { type IconName } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TopicCardProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Small pill under the subtitle, e.g. "3 topics" or "Coming soon". */
  badge?: string;
  onPress: () => void;
};

/** 2-column grid tile for the Learn hub. Title/subtitle/badge each get a fixed,
 * compact height (not just numberOfLines) so every card in the grid is the same
 * height and rows line up evenly, regardless of how long each topic's text is. */
export function TopicCard({ icon, title, subtitle, badge, onPress }: TopicCardProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: theme.surface }, Elevation.sm]}>
        <IconCircle icon={icon} variant="tint" size={36} />
        <ThemedText type="subhead" numberOfLines={2} style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </ThemedText>
        <View style={styles.badgeSlot}>{badge ? <Badge label={badge} /> : null}</View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '48%' },
  card: { borderRadius: Radius.lg, padding: Space.md },
  title: { marginTop: Space.xs, height: 40, fontWeight: '600' },
  subtitle: { height: 32 },
  badgeSlot: { height: 24, marginTop: Space.xs, justifyContent: 'center' },
});

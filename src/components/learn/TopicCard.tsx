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

const BADGE_SLOT_HEIGHT = 24;

/** 2-column grid tile for the Learn hub — icon + title + subtitle + optional badge, no chevron.
 * Every card renders at the same height (title/subtitle clamped to 2 lines, badge slot always
 * reserved) so grid rows line up evenly whether or not a given topic has a badge. */
export function TopicCard({ icon, title, subtitle, badge, onPress }: TopicCardProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: theme.surface }, Elevation.sm]}>
        <IconCircle icon={icon} variant="tint" size={44} />
        <ThemedText type="headline" numberOfLines={2} style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </ThemedText>
        <View style={styles.badgeSlot}>{badge ? <Badge label={badge} /> : null}</View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '48%' },
  card: { borderRadius: Radius.lg, padding: Space.base },
  title: { marginTop: Space.xs, height: 44 },
  subtitle: { marginTop: 2, height: 36 },
  badgeSlot: { height: BADGE_SLOT_HEIGHT, marginTop: Space.xs, justifyContent: 'center' },
});

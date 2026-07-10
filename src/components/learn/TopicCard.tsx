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

/** Grid tile for the Learn hub. Sized to its actual content (no reserved blank
 * space) — the parent row is responsible for making both cards in a row match
 * heights, via `flex: 1` + `alignItems: 'stretch'` on the row itself. */
export function TopicCard({ icon, title, subtitle, badge, onPress }: TopicCardProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: theme.surface }, Elevation.sm]}>
        <IconCircle icon={icon} variant="tint" size={36} />
        <ThemedText type="subhead" numberOfLines={2} style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
          {subtitle}
        </ThemedText>
        {badge ? <Badge label={badge} style={styles.badge} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: { flex: 1, borderRadius: Radius.lg, padding: Space.md, gap: 2 },
  title: { marginTop: Space.xs, fontWeight: '600' },
  badge: { marginTop: Space.xs, alignSelf: 'flex-start' },
});

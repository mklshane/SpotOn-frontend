import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TopicRowProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
};

/** Icon + title + subtitle + chevron row, shared by the Learn hub and its sub-list screens. */
export function TopicRow({ icon, title, subtitle, onPress }: TopicRowProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.row}>
          <IconCircle icon={icon} variant="tint" size={44} />
          <View style={styles.text}>
            <ThemedText type="headline">{title}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {subtitle}
            </ThemedText>
          </View>
          <Icon name="chevron.right" tintColor={theme.muted} size={18} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  text: { flex: 1, gap: 2 },
});

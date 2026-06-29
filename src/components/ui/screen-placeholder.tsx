import { type IconName } from '@/components/ui/icon';
import { StyleSheet, View } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { IconCircle } from './icon-circle';
import { Screen } from './screen';

export type ScreenPlaceholderProps = {
  icon: IconName;
  title: string;
  subtitle: string;
};

/** Centered placeholder for tabs whose full screens aren't built yet. */
export function ScreenPlaceholder({ icon, title, subtitle }: ScreenPlaceholderProps) {
  const theme = useTheme();
  return (
    <Screen>
      <View style={styles.center}>
        <IconCircle icon={icon} variant="tint" size={88} />
        <ThemedText type="title1" style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.subtitle}>
          {subtitle}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base },
  title: { marginTop: Space.sm },
  subtitle: { textAlign: 'center', maxWidth: 300 },
  badge: {
    marginTop: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  badgeText: { letterSpacing: 0.5, fontWeight: '600' },
});

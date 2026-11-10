import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Button } from './button';
import { Icon, type IconName } from './icon';

export type ListStateProps = {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Optional recovery action (e.g. Retry) - an error with no way forward is a dead end. */
  action?: { label: string; onPress: () => void };
};

const DEFAULT_ICON: Record<ListStateProps['kind'], IconName> = {
  loading: 'magnifyingglass',
  empty: 'magnifyingglass',
  error: 'exclamationmark.triangle.fill',
  offline: 'wifi.slash',
};

export function ListState({ kind, title, subtitle, icon, action }: ListStateProps) {
  const theme = useTheme();

  return (
    <View style={styles.center}>
      {kind === 'loading' ? (
        <ActivityIndicator color={theme.brand} />
      ) : (
        <Icon name={icon ?? DEFAULT_ICON[kind]} size={32} tintColor={theme.muted} />
      )}
      <ThemedText type="headline" style={styles.title}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText type="footnote" themeColor="muted" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
      {action ? (
        <Button label={action.label} variant="outline" onPress={action.onPress} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xxxl,
    gap: Space.sm,
    paddingHorizontal: Space.xl,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  action: { marginTop: Space.sm, alignSelf: 'center', paddingHorizontal: Space.xl },
});

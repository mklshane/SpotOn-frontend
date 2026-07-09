import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ListStateProps = {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  subtitle?: string;
  icon?: IconName;
};

const DEFAULT_ICON: Record<ListStateProps['kind'], IconName> = {
  loading: 'magnifyingglass',
  empty: 'magnifyingglass',
  error: 'exclamationmark.triangle.fill',
  offline: 'wifi.slash',
};

export function ListState({ kind, title, subtitle, icon }: ListStateProps) {
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
});

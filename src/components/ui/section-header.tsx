import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Space } from '@/constants/theme';

import { ThemedText } from '../themed-text';

export type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  /**
   * `title` (default) is a normal section heading. `label` is the small-caps document label
   * used by the Screening Summary Report, where the heading has to read as a form field
   * caption rather than compete with the content beneath it.
   */
  variant?: 'title' | 'label';
  style?: ViewStyle | ViewStyle[];
};

export function SectionHeader({ title, subtitle, variant = 'title', style }: SectionHeaderProps) {
  const isLabel = variant === 'label';

  return (
    <View style={[styles.wrap, style]}>
      <ThemedText
        type={isLabel ? 'caption' : 'title2'}
        themeColor={isLabel ? 'textSecondary' : 'text'}
        style={isLabel ? styles.label : undefined}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText type="footnote" themeColor="muted">
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.xs },
  label: { fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
});

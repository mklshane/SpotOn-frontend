import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Corner radius from the shared scale. `lg` reads softer — used on browse screens. */
  shape?: 'md' | 'lg';
  /** Soft warm shadow. `md` is for a bar floating over the map/list; `sm` lifts it off a page background. */
  elevation?: 'none' | 'sm' | 'md';
  accessibilityLabel?: string;
};

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  shape = 'md',
  elevation = 'none',
  accessibilityLabel,
}: SearchBarProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderRadius: Radius[shape] },
        elevation !== 'none' && Elevation[elevation],
      ]}>
      <Icon name="magnifyingglass" size={18} tintColor={theme.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        style={[styles.input, { color: theme.text }]}
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel ?? placeholder}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={13}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <Icon name="xmark.circle.fill" size={18} tintColor={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    height: 48,
    paddingHorizontal: Space.base,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
});

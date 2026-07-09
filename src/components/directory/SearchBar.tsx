import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Adds a soft warm shadow — used when the bar floats over the map/list instead of sitting on a card. */
  floating?: boolean;
};

export function SearchBar({ value, onChangeText, placeholder = 'Search', floating = false }: SearchBarProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: theme.surface }, floating && Elevation.md]}>
      <Icon name="magnifyingglass" size={18} tintColor={theme.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        style={[styles.input, { color: theme.text }]}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={13} accessibilityRole="button" accessibilityLabel="Clear search">
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
    borderRadius: Radius.md,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
});

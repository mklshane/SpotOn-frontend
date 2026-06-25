import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle | ViewStyle[];
};

export function Segmented<T extends string>({ options, value, onChange, style }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.elementBg }, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.item, active && { backgroundColor: theme.surface }]}>
            <ThemedText type="subhead" themeColor={active ? 'brand' : 'muted'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: Radius.md, padding: 4, gap: 4 },
  item: { flex: 1, height: 44, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});

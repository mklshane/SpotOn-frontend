import { Icon } from '@/components/ui/icon';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type SelectOption<T extends string> = { value: T; label: string };

export type SelectProps<T extends string> = {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  containerStyle?: ViewStyle | ViewStyle[];
};

export function Select<T extends string>({
  label,
  placeholder = 'Select',
  value,
  options,
  onChange,
  error,
  containerStyle,
}: SelectProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);
  const borderColor = error ? theme.riskCritical : open ? theme.brand : 'transparent';

  return (
    <View style={[containerStyle, open ? styles.raised : undefined]}>
      {label ? (
        <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      <View style={styles.anchor}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen((o) => !o)}
          style={[styles.field, { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 }]}>
          <ThemedText type="body" themeColor={selected ? 'text' : 'muted'}>
            {selected ? selected.label : placeholder}
          </ThemedText>
          <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.muted} size={16} />
        </Pressable>

        {open ? (
          <View
            style={[
              styles.menu,
              { backgroundColor: theme.surface, borderColor: theme.hairline },
              Elevation.md,
            ]}>
            {options.map((o, i) => {
              const isSel = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline },
                    pressed && { backgroundColor: theme.elementBg },
                  ]}>
                  <ThemedText type="body" themeColor={isSel ? 'brand' : 'text'}>
                    {o.label}
                  </ThemedText>
                  {isSel ? <Icon name="checkmark" tintColor={theme.brand} size={16} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {error ? (
        <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const FIELD_HEIGHT = 54;

const styles = StyleSheet.create({
  // Raise the whole field above following siblings so the menu overlays them.
  raised: { zIndex: 100, elevation: 24 },
  label: { marginBottom: Space.sm },
  anchor: { position: 'relative' },
  field: {
    height: FIELD_HEIGHT,
    borderRadius: Radius.md,
    paddingHorizontal: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menu: {
    position: 'absolute',
    top: FIELD_HEIGHT + Space.sm,
    left: 0,
    right: 0,
    zIndex: 100,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
  },
  error: { marginTop: Space.xs },
});

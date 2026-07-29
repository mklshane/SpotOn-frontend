import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';

export type AccordionOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

export type AccordionProps<T extends string> = {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: AccordionOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  containerStyle?: ViewStyle | ViewStyle[];
};

/** Per-option height budget for the open-state cap: a two-line (label + description)
 *  row renders at roughly 66px including padding; rounded up generously to
 *  comfortably survive font-scaling without clipping. */
const ROW_HEIGHT = 90;

export function Accordion<T extends string>({
  label,
  placeholder = 'Select',
  value,
  options,
  onChange,
  error,
  containerStyle,
}: AccordionProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);

  const selected = options.find((o) => o.value === value);
  const borderColor = error ? theme.riskCritical : open ? theme.brand : 'transparent';
  const maxHeight = options.length * ROW_HEIGHT + Space.base;

  function setOpenAnimated(next: boolean) {
    setOpen(next);
    progress.value = withTiming(next ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }

  const animatedStyle = useAnimatedStyle(() => ({
    maxHeight: progress.value * maxHeight,
    opacity: progress.value,
  }));

  return (
    <View style={containerStyle}>
      {label ? (
        <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpenAnimated(!open)}
        style={[styles.field, { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 }]}>
        <ThemedText type="body" themeColor={selected ? 'text' : 'muted'}>
          {selected ? selected.label : placeholder}
        </ThemedText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.muted} size={16} />
      </Pressable>

      <Animated.View style={[styles.optionsWrap, animatedStyle]}>
        <View style={[styles.options, { backgroundColor: theme.surface }, Elevation.sm]}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(option.value);
                  setOpenAnimated(false);
                }}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && {
                    backgroundColor: theme.brandTint,
                    borderRadius: Radius.sm,
                    marginHorizontal: Space.xs,
                  },
                  pressed && !isSelected && { backgroundColor: theme.elementBg },
                ]}>
                <View style={styles.rowText}>
                  <ThemedText
                    type="body"
                    themeColor="text"
                    style={isSelected && styles.rowLabelSelected}>
                    {option.label}
                  </ThemedText>
                  {option.description ? (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {option.description}
                    </ThemedText>
                  ) : null}
                </View>
                {isSelected ? <Icon name="checkmark" tintColor={theme.brand} size={16} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Animated.View>

      {error ? (
        <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: Space.sm },
  field: {
    height: 54,
    borderRadius: Radius.md,
    paddingHorizontal: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionsWrap: { overflow: 'hidden' },
  options: {
    marginTop: Space.sm,
    borderRadius: Radius.md,
    overflow: 'hidden',
    paddingVertical: Space.xs,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabelSelected: { fontWeight: '700' },
  error: { marginTop: Space.xs },
});

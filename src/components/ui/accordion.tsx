import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';
import { SelectCard } from './select-card';

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

/** Per-option height budget for the open-state cap: SelectCard's ~64px min-height
 *  plus its Space.sm gap, rounded up generously to survive font-scaling on
 *  two-line title+description rows without clipping. */
const ROW_HEIGHT = 100;

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
    progress.value = withTiming(next ? 1 : 0, { duration: 250 });
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

      <Animated.View style={[styles.options, animatedStyle]}>
        {options.map((option) => (
          <SelectCard
            key={option.value}
            title={option.label}
            subtitle={option.description}
            selected={option.value === value}
            onPress={() => {
              onChange(option.value);
              setOpenAnimated(false);
            }}
            style={styles.card}
          />
        ))}
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
  options: { overflow: 'hidden' },
  card: { marginTop: Space.sm },
  error: { marginTop: Space.xs },
});

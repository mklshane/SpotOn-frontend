import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Space } from '@/constants/theme';
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
  const [triggerHovered, setTriggerHovered] = useState(false);
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
        onHoverIn={() => setTriggerHovered(true)}
        onHoverOut={() => setTriggerHovered(false)}
        onPress={() => setOpenAnimated(!open)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: pressed || triggerHovered ? theme.hairline : theme.elementBg,
            borderColor,
            borderWidth: 1.5,
          },
        ]}>
        <ThemedText type="body" themeColor={selected ? 'text' : 'muted'}>
          {selected ? selected.label : placeholder}
        </ThemedText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.muted} size={16} />
      </Pressable>

      <Animated.View style={[styles.optionsWrap, animatedStyle]}>
        <View style={[styles.options, { backgroundColor: theme.surface }]}>
          {options.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              isSelected={option.value === value}
              onSelect={() => {
                onChange(option.value);
                setOpenAnimated(false);
              }}
            />
          ))}
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

type OptionRowProps<T extends string> = {
  option: AccordionOption<T>;
  isSelected: boolean;
  onSelect: () => void;
};

/** A single option row, split out so each gets its own animated highlight value
 *  (Reanimated shared values must come from a hook, so this can't live inline
 *  inside the parent's `.map()`). */
function OptionRow<T extends string>({ option, isSelected, onSelect }: OptionRowProps<T>) {
  const theme = useTheme();
  const hovered = useSharedValue(false);
  const highlight = useSharedValue(0);

  function setHighlighted(active: boolean) {
    if (isSelected) return;
    highlight.value = withTiming(active ? 1 : 0, { duration: 150 });
  }

  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.value }));

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      onHoverIn={() => {
        hovered.value = true;
        setHighlighted(true);
      }}
      onHoverOut={() => {
        hovered.value = false;
        setHighlighted(false);
      }}
      onPressIn={() => setHighlighted(true)}
      onPressOut={() => setHighlighted(hovered.value)}
      onPress={onSelect}
      style={styles.row}>
      {isSelected ? (
        <View style={[StyleSheet.absoluteFill, styles.rowInset, { backgroundColor: theme.brandTint }]} />
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.rowInset,
            { backgroundColor: theme.hairline },
            highlightStyle,
          ]}
        />
      )}

      <View style={styles.rowText}>
        <ThemedText type="body" themeColor="text" style={isSelected && styles.rowLabelSelected}>
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
    paddingVertical: Space.sm,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  rowInset: { borderRadius: Radius.sm, marginHorizontal: Space.sm, marginVertical: Space.xs },
  rowText: { flex: 1, gap: 2 },
  rowLabelSelected: { fontWeight: '700' },
  error: { marginTop: Space.xs },
});

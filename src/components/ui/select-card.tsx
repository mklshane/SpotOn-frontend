import { Icon } from '@/components/ui/icon';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type SelectCardProps = {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  style?: ViewStyle | ViewStyle[];
};

export function SelectCard({ title, subtitle, selected, onPress, style }: SelectCardProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      onPressIn={() => (scale.value = withSpring(0.98, { damping: 18, stiffness: 320 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 18, stiffness: 320 }))}
      style={[
        styles.base,
        {
          backgroundColor: selected ? theme.brandTint : theme.elementBg,
          borderColor: selected ? theme.brand : 'transparent',
        },
        animatedStyle,
        style,
      ]}>
      <View style={styles.text}>
        <ThemedText type="headline">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.check,
          selected
            ? { backgroundColor: theme.brand, borderColor: theme.brand }
            : { backgroundColor: 'transparent', borderColor: theme.hairline },
        ]}>
        {selected ? <Icon name="checkmark" tintColor={theme.onBrand} size={13} /> : null}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  text: { flex: 1, gap: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

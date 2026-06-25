import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DotsProps = {
  count: number;
  activeIndex: number;
};

export function Dots({ count, activeIndex }: DotsProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <Dot key={i} active={i === activeIndex} />
      ))}
    </View>
  );
}

function Dot({ active }: { active: boolean }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({
    width: withSpring(active ? 22 : 8, { damping: 16, stiffness: 200 }),
    backgroundColor: active ? theme.brand : theme.surface,
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dot: { height: 8, borderRadius: Radius.pill },
});

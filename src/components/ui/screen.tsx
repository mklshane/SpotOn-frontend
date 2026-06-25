import { StyleSheet, View, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { GradientBackground } from './gradient-background';

export type ScreenProps = {
  variant?: 'plain' | 'gradient';
  /** Horizontal page padding. Defaults to Space.xl. Pass 0 for full-bleed content. */
  padded?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

export function Screen({
  variant = 'plain',
  padded = true,
  edges = ['top', 'bottom'],
  style,
  children,
}: ScreenProps) {
  const theme = useTheme();

  return (
    <View style={styles.root}>
      {variant === 'gradient' ? (
        <GradientBackground variant="dawn" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} />
      )}
      <SafeAreaView
        edges={edges}
        style={[styles.safe, padded && styles.padded, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  padded: { paddingHorizontal: Space.xl },
});

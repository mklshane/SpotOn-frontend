import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type ViewStyle } from 'react-native';

import { Gradients } from '@/constants/theme';

type GradientName = keyof typeof Gradients;

export type GradientBackgroundProps = {
  variant?: GradientName;
  /** Gradient direction. Defaults to top → bottom (vertical), matching the mock. */
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

export function GradientBackground({
  variant = 'dawn',
  start = { x: 0, y: 0 },
  end = { x: 0, y: 1 },
  style,
  children,
}: GradientBackgroundProps) {
  const g = Gradients[variant];
  return (
    <LinearGradient
      colors={g.colors as unknown as [string, string, ...string[]]}
      locations={g.locations as unknown as [number, number, ...number[]]}
      start={start}
      end={end}
      style={[StyleSheet.absoluteFill, style]}>
      {children}
    </LinearGradient>
  );
}

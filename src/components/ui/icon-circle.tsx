import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Elevation, Gradients } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type IconCircleProps = {
  icon: SymbolViewProps['name'];
  size?: number;
  /** Soft tint circle, solid brand, or a warm sunset gradient fill. */
  variant?: 'tint' | 'brand' | 'gradient';
  iconColor?: string;
  style?: ViewStyle | ViewStyle[];
};

export function IconCircle({ icon, size = 72, variant = 'tint', iconColor, style }: IconCircleProps) {
  const theme = useTheme();
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const glyphColor = iconColor ?? (variant === 'tint' ? theme.brand : theme.onBrand);

  return (
    <View style={[styles.base, dim, Elevation.sm, style]}>
      {variant === 'gradient' ? (
        <LinearGradient
          colors={Gradients.sunsetVivid.colors as unknown as [string, string, ...string[]]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, dim]}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            dim,
            { backgroundColor: variant === 'brand' ? theme.brand : theme.brandTint },
          ]}
        />
      )}
      <SymbolView name={icon} tintColor={glyphColor} size={size * 0.46} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});

import { Image } from 'expo-image';
import { type SymbolViewProps } from 'expo-symbols';
import { type ImageSourcePropType, StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { IconCircle } from './icon-circle';

export type OnboardingHeroProps = {
  /** Drop a real illustration here later (assets/images/onboarding/*.png). */
  image?: ImageSourcePropType;
  /** Fallback glyph shown inside the placeholder until real art is added. */
  icon: SymbolViewProps['name'];
  size?: number;
};

/**
 * Onboarding illustration slot. Renders the provided PNG when present; otherwise
 * shows an on-brand placeholder (soft tint frame + brand IconCircle) that the user
 * can swap for real 3D art without any layout change.
 */
export function OnboardingHero({ image, icon, size = 260 }: OnboardingHeroProps) {
  const theme = useTheme();

  if (image) {
    return (
      <Image
        source={image}
        style={{ width: size, height: size }}
        contentFit="contain"
        transition={250}
      />
    );
  }

  return (
    <View style={[styles.frame, { width: size, height: size, backgroundColor: theme.brandTint }]}>
      <IconCircle icon={icon} variant="gradient" size={size * 0.42} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

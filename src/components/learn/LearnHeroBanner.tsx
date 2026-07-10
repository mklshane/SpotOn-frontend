import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Gradients, Radius, Space } from '@/constants/theme';

export type LearnHeroBannerProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
};

/** Featured-topic promo banner at the top of the Learn hub. */
export function LearnHeroBanner({ icon, title, subtitle, onPress }: LearnHeroBannerProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <LinearGradient
        colors={Gradients.sunsetVivid.colors as unknown as [string, string, ...string[]]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.card}>
        <View style={styles.text}>
          <ThemedText type="title2" themeColor="onBrand">
            {title}
          </ThemedText>
          <ThemedText type="footnote" themeColor="onBrand" style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        </View>
        <Icon name={icon} size={64} tintColor="rgba(255,255,255,0.3)" style={styles.icon} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    padding: Space.lg,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: { flex: 1, gap: Space.xs, paddingRight: Space.base },
  subtitle: { opacity: 0.9 },
  icon: { position: 'absolute', right: Space.base, bottom: -Space.sm },
});

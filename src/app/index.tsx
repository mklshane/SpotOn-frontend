import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/ui/gradient-background';
import { Logo } from '@/components/ui/logo';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { isProfileComplete } from '@/lib/profile';

const MIN_SPLASH_MS = 1100;

export default function SplashScreenRoute() {
  const theme = useTheme();
  const { user, loading } = useAuth();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);
  const glow = useSharedValue(0.4);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 600 });
    scale.value = withTiming(1, { duration: 700 });
    glow.value = withTiming(0.85, { duration: 1100 });
  }, [opacity, scale, glow]);

  useEffect(() => {
    if (loading) return; // wait for the initial token/session restore
    let cancelled = false;
    (async () => {
      const [seen] = await Promise.all([
        hasSeenOnboarding().catch(() => false),
        new Promise((r) => setTimeout(r, MIN_SPLASH_MS)),
      ]);
      if (cancelled) return;
      if (!seen) {
        router.replace('/(onboarding)');
      } else if (!user) {
        router.replace('/(auth)/login');
      } else {
        router.replace(isProfileComplete(user) ? '/home' : '/(auth)/complete-profile');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  return (
    <View style={styles.root}>
      <GradientBackground variant="sunsetVivid" start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} />

      {/* Subtle decorative faint-white orbs & rings for depth. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.orb, styles.orb1]} />
        <View style={[styles.orb, styles.orb2]} />
        <View style={[styles.orb, styles.orb3]} />
        <View style={[styles.ring, styles.ring1]} />
        <View style={[styles.ring, styles.ring2]} />
      </View>

      {/* Soft light halo for depth (blue source PNG tinted warm-light). */}
      <Animated.View style={[styles.glowWrap, glowStyle]} pointerEvents="none">
        <Image
          source={require('@/assets/images/logo-glow.png')}
          style={styles.glow}
          tintColor={theme.brandTint}
          contentFit="contain"
        />
      </Animated.View>

      <Animated.View style={[styles.center, contentStyle]}>
        <Logo variant="wordmark" width={250} tint="#FFFFFF" />
        <ThemedText type="callout" themeColor="onBrand" style={styles.tagline}>
          Spot it early. Stop it early.
        </ThemedText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: Space.base },
  tagline: { opacity: 0.9, fontWeight: '600' },
  glowWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: { width: 520, height: 520 },
  orb: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.10)' },
  orb1: { width: 200, height: 200, borderRadius: 100, top: -50, left: -40 },
  orb2: { width: 260, height: 260, borderRadius: 130, bottom: 60, right: -70 },
  orb3: { width: 90, height: 90, borderRadius: 45, top: 150, right: 36, backgroundColor: 'rgba(255,255,255,0.13)' },
  ring: { position: 'absolute', borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'transparent' },
  ring1: { width: 230, height: 230, borderRadius: 115, borderWidth: 1.5, bottom: -50, left: 24 },
  ring2: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, top: 80, left: 44 },
});

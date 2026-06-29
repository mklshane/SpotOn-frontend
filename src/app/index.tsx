import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
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

function LoadingDots() {
  const dots = [0, 1, 2];
  return (
    <View style={styles.dotsRow}>
      {dots.map((i) => (
        <LoadingDot key={i} delay={i * 180} />
      ))}
    </View>
  );
}

function LoadingDot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 480, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.3, { duration: 480, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [v, delay]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.7 + v.value * 0.3 }] }));
  return <Animated.View style={[styles.dot, style]} />;
}

export default function SplashScreenRoute() {
  const theme = useTheme();
  const { user, loading } = useAuth();

  const markOpacity = useSharedValue(0);
  const markScale = useSharedValue(0.82);
  const textOpacity = useSharedValue(0);
  const textShift = useSharedValue(12);
  const glow = useSharedValue(0.45);
  const glowScale = useSharedValue(0.92);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textShift.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: glowScale.value }],
  }));

  useEffect(() => {
    // Hero mark drops in first.
    markOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    markScale.value = withTiming(1, { duration: 640, easing: Easing.out(Easing.back(1.4)) });
    // Wordmark + tagline rise in just behind it.
    textOpacity.value = withDelay(260, withTiming(1, { duration: 560 }));
    textShift.value = withDelay(260, withTiming(0, { duration: 560, easing: Easing.out(Easing.cubic) }));
    // Glow breathes continuously.
    glow.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    glowScale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.94, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [markOpacity, markScale, textOpacity, textShift, glow, glowScale]);

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

      <View style={styles.center}>
        {/* Hero: frosted-glass badge holding the SpotOn mark. */}
        <Animated.View style={[styles.badge, markStyle]}>
          <Logo variant="mark" size={68} tint="#FFFFFF" />
        </Animated.View>

        <Animated.View style={[styles.lockup, textStyle]}>
          <Logo variant="wordmark" width={232} tint="#FFFFFF" />
          <ThemedText type="callout" themeColor="onBrand" style={styles.tagline}>
            Spot it early. Stop it early.
          </ThemedText>
        </Animated.View>
      </View>

      {/* Bottom: gentle loader + provenance. */}
      <View style={styles.footer} pointerEvents="none">
        <LoadingDots />
        <ThemedText type="caption" themeColor="onBrand" style={styles.provenance}>
          Made for the Philippines
        </ThemedText>
      </View>

      {/* Edge vignette for focus & depth. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(180,70,20,0.22)', 'rgba(180,70,20,0)', 'rgba(180,70,20,0.26)']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: Space.xl, zIndex: 2 },
  badge: {
    width: 116,
    height: 116,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#7A2E08',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  lockup: { alignItems: 'center', gap: Space.base },
  tagline: { opacity: 0.92, fontWeight: '600' },
  glowWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: { width: 540, height: 540 },
  footer: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Space.base,
    zIndex: 2,
  },
  dotsRow: { flexDirection: 'row', gap: Space.sm },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.9)' },
  provenance: { opacity: 0.7, letterSpacing: 0.3 },
  orb: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.10)' },
  orb1: { width: 200, height: 200, borderRadius: 100, top: -50, left: -40 },
  orb2: { width: 260, height: 260, borderRadius: 130, bottom: 60, right: -70 },
  orb3: { width: 90, height: 90, borderRadius: 45, top: 150, right: 36, backgroundColor: 'rgba(255,255,255,0.13)' },
  ring: { position: 'absolute', borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'transparent' },
  ring1: { width: 230, height: 230, borderRadius: 115, borderWidth: 1.5, bottom: -50, left: 24 },
  ring2: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, top: 80, left: 44 },
});

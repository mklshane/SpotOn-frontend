import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScreeningRow } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Elevation, Gradients, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useScanHistory } from '@/lib/scan-history';

/** "Good morning" / "Good afternoon" / "Good evening" based on the device clock. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export default function HomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { entries, loading } = useScanHistory();
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || 'there';
  const recent = entries.slice(0, 3);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={[styles.headerGlow, { backgroundColor: theme.brandTint }]} pointerEvents="none" />

        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <ThemedText type="largeTitle">
              {getGreeting()}, {firstName}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {TODAY_LABEL}
            </ThemedText>
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/scan/body')}
        accessibilityRole="button"
        accessibilityLabel="Start a new screening"
        style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.cta}>
          <LinearGradient
            colors={Gradients.sunsetVivid.colors as unknown as [string, string, ...string[]]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.ctaOrb} pointerEvents="none" />
          <View style={styles.ctaOrbSmall} pointerEvents="none" />

          <IconCircle
            icon="camera.viewfinder"
            variant="tint"
            tintBg="rgba(255,255,255,0.22)"
            iconColor={theme.onBrand}
            size={56}
          />
          <View style={styles.ctaText}>
            <ThemedText type="headline" themeColor="onBrand">
              New screening
            </ThemedText>
            <ThemedText type="footnote" themeColor="onBrand" style={styles.ctaSubtitle}>
              Snap a photo of a spot for an instant, on-device triage.
            </ThemedText>
          </View>
          <Icon name="chevron.right" tintColor={theme.onBrand} size={18} />
        </View>
      </Pressable>

      <View style={styles.sectionHead}>
        <ThemedText type="title2">Recent screenings</ThemedText>
        {entries.length > recent.length ? (
          <Pressable
            hitSlop={8}
            onPress={() => router.push('/scan/all')}
            accessibilityRole="button"
            accessibilityLabel="See all screenings"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="subhead" themeColor="brand">
              See all
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {recent.length === 0 ? (
        <ThemedText type="body" themeColor="muted">
          {loading ? 'Loading your screenings…' : 'Your past screenings will appear here.'}
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {recent.map((item) => (
            <ScreeningRow key={item.id} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.xxl, gap: Space.sm },
  headerGlow: {
    position: 'absolute',
    top: -36,
    left: -44,
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.6,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  headerText: { flex: 1, gap: 2 },
  cta: {
    marginTop: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    borderRadius: Radius.xl,
    padding: Space.xl,
    overflow: 'hidden',
    ...Elevation.lg,
  },
  ctaOrb: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -50,
    right: -35,
  },
  ctaOrbSmall: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.10)',
    bottom: -20,
    right: 60,
  },
  ctaText: { flex: 1, gap: 2 },
  ctaSubtitle: { opacity: 0.9 },
  sectionHead: {
    marginTop: Space.xxl,
    marginBottom: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.85 },
  list: { gap: Space.md },
});

import { Icon } from '@/components/ui/icon';
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resetOnboarding } from '@/lib/onboarding';

import { ThemedText } from '../themed-text';

type Jump = { label: string; href: Href };

const JUMPS: Jump[] = [
  { label: 'Splash', href: '/' },
  { label: 'Onboarding', href: '/(onboarding)' },
  { label: 'Register', href: '/(auth)/register' },
  { label: 'Login', href: '/(auth)/login' },
  { label: 'Profile', href: '/(auth)/complete-profile' },
  { label: 'App (Tabs)', href: '/home' },
];

/** __DEV__-only floating panel to jump between flow screens and reset flags. */
export function DevTools() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (!__DEV__) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { bottom: insets.bottom + 80, right: Space.base }]}>
      {open ? (
        <View style={[styles.panel, { backgroundColor: theme.surface }, Elevation.md]}>
          <ThemedText type="caption" themeColor="muted" style={styles.heading}>
            DEV — JUMP TO
          </ThemedText>
          {JUMPS.map((j) => (
            <Pressable
              key={j.label}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => {
                router.replace(j.href);
                setOpen(false);
              }}>
              <ThemedText type="subhead">{j.label}</ThemedText>
            </Pressable>
          ))}
          <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={async () => {
              await resetOnboarding().catch(() => {});
              router.replace('/');
              setOpen(false);
            }}>
            <ThemedText type="subhead" themeColor="brand">
              Reset onboarding flag
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.fab, { backgroundColor: theme.text }, Elevation.md]}
        accessibilityLabel="Developer tools">
        <Icon name={open ? 'xmark' : 'hammer.fill'} tintColor={theme.background} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', alignItems: 'flex-end', gap: Space.sm },
  fab: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderRadius: Radius.lg,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xs,
    minWidth: 180,
  },
  heading: { paddingHorizontal: Space.md, paddingVertical: Space.xs, letterSpacing: 0.5 },
  row: { paddingHorizontal: Space.md, paddingVertical: Space.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space.xs },
});

import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScreeningRow } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useScanHistory } from '@/lib/scan-history';

export default function HomeScreen() {
  const { user } = useAuth();
  const { entries, loading } = useScanHistory();
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || 'there';
  const recent = entries.slice(0, 3);

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="largeTitle">Hi, {firstName}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">
          Tap the camera to start a skin check.
        </ThemedText>
      </View>

      <Card style={styles.cta}>
        <IconCircle icon="camera.viewfinder" variant="gradient" size={56} />
        <View style={styles.ctaText}>
          <ThemedText type="headline">New screening</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Snap a photo of a spot for an instant, on-device triage.
          </ThemedText>
        </View>
      </Card>

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
  header: { paddingTop: Space.lg, gap: Space.xs },
  cta: { marginTop: Space.xl, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  ctaText: { flex: 1, gap: 2 },
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

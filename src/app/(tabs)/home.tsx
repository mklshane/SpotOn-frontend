import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { user } = useAuth();
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || 'there';

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

      <ThemedText type="title2" style={styles.section}>
        Recent screenings
      </ThemedText>
      <ThemedText type="body" themeColor="muted">
        Your past screenings will appear here.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.lg, gap: Space.xs },
  cta: { marginTop: Space.xl, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  ctaText: { flex: 1, gap: 2 },
  section: { marginTop: Space.xxl, marginBottom: Space.sm },
});

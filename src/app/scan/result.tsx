import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';

/**
 * Placeholder for the analysis result screen. Real triage UI (risk tier, pathology,
 * "Location on the body" row, etc.) is a later phase — this only confirms the
 * body-lesions → result redirect works.
 */
export default function ResultScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById } = useScanHistory();
  const entry = id ? getById(id) : undefined;

  const date = entry ? new Date(entry.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Analysis
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <IconCircle icon="camera.viewfinder" variant="gradient" size={84} />
        <ThemedText type="title1" style={styles.center}>
          {entry?.mark.region ?? 'Analysis'}
        </ThemedText>
        {date ? (
          <ThemedText type="subhead" themeColor="textSecondary">
            {date}
          </ThemedText>
        ) : null}
        <ThemedText type="body" themeColor="muted" style={styles.center}>
          The full screening result will live here. (Coming soon.)
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.base, paddingBottom: Space.giant },
  center: { textAlign: 'center' },
});

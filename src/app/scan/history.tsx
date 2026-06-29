import { router } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { BodyHistoryViewer } from '@/components/scan/body-history-viewer';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';

export default function BodyLesionsScreen() {
  const theme = useTheme();
  const { entries } = useScanHistory();

  const markers = entries.map((e) => ({ id: e.id, point: e.mark.point }));

  const onSelect = useCallback((id: string) => {
    router.push({ pathname: '/scan/result', params: { id } });
  }, []);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Body lesions
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.viewer}>
        <BodyHistoryViewer markers={markers} onSelect={onSelect} />
      </View>

      <View style={styles.copy}>
        <ThemedText type="title2" style={styles.center}>
          {entries.length} {entries.length === 1 ? 'lesion' : 'lesions'} tracked
        </ThemedText>
        <ThemedText type="footnote" themeColor="muted" style={styles.center}>
          Drag to rotate · pinch to zoom · tap a spot to open its analysis
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  viewer: { flex: 1 },
  copy: { paddingHorizontal: Space.xl, paddingBottom: Space.xl, gap: Space.xs },
  center: { textAlign: 'center' },
});

import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { BodyHistoryViewer, type HistoryMarker } from '@/components/scan/body-history-viewer';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';

/**
 * The body model, one marker per TRACKED LESION rather than per screening — so three re-checks of
 * one mole are one dot with a history, not three dots stacked on each other. Markers are tinted by
 * the lesion's latest tier, which makes the model read as a risk map at a glance.
 *
 * Screenings whose lesion has been archived, or that were never linked, are not shown; they remain
 * reachable from the "All scans" list.
 */
export default function BodyLesionsScreen() {
  const theme = useTheme();
  const { lesions, entries } = useScanHistory();

  const tracked = useMemo(() => lesions.filter((l) => !l.archived), [lesions]);

  // A lesion with no mark (the user skipped the body step) can't be placed on the model.
  const markers = useMemo<HistoryMarker[]>(
    () =>
      tracked
        .filter((l) => l.mark != null)
        .map((l) => ({
          id: l.id,
          point: l.mark!.point,
          color: tierColor(theme, l.lastTier ?? 'low').fg,
        })),
    [tracked, theme],
  );

  const unplaced = tracked.length - markers.length;

  const onSelect = useCallback((id: string) => {
    router.push({ pathname: '/scan/lesion', params: { id } });
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
        <Pressable
          hitSlop={12}
          onPress={() => router.push('/scan/all')}
          accessibilityRole="button"
          accessibilityLabel="See all screenings as a list">
          <Icon name="list.bullet" tintColor={theme.brand} size={20} />
        </Pressable>
      </View>

      <View style={styles.viewer}>
        <BodyHistoryViewer markers={markers} onSelect={onSelect} />
      </View>

      <View style={styles.copy}>
        <ThemedText type="title2" style={styles.center}>
          {tracked.length} {tracked.length === 1 ? 'spot' : 'spots'} tracked
        </ThemedText>
        <ThemedText type="footnote" themeColor="muted" style={styles.center}>
          {tracked.length === 0
            ? entries.length > 0
              ? 'Your screenings aren’t placed on the body yet — mark a location when you scan.'
              : 'Scan a spot to start tracking it here.'
            : `Drag to rotate · pinch to zoom · tap a spot to see how it has changed${
                unplaced > 0 ? ` · ${unplaced} without a marked location` : ''
              }`}
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
  viewer: { flex: 1 },
  copy: { paddingHorizontal: Space.xl, paddingBottom: Space.xl, gap: Space.xs },
  center: { textAlign: 'center' },
});

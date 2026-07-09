import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { DirectorySegments, type DirectorySegment } from '@/components/directory/DirectorySegments';
import { SearchBar } from '@/components/directory/SearchBar';
import { ClinicsView } from '@/components/directory/ClinicsView';
import { DoctorsView } from '@/components/directory/DoctorsView';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { needsInitialSync, runSync } from '@/data/sync';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';

export default function DirectoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useConnectivity();

  const [segment, setSegment] = useState<DirectorySegment>('clinics');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [overlayH, setOverlayH] = useState(0);

  useEffect(() => {
    (async () => {
      if (await needsInitialSync()) {
        await runSync({ full: true }).catch(() => {});
      } else {
        runSync().catch(() => {});
      }
    })();
  }, []);

  const onOverlayLayout = (e: LayoutChangeEvent) => setOverlayH(e.nativeEvent.layout.height);

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {segment === 'clinics' ? (
        <ClinicsView query={debouncedQuery} topInset={overlayH} />
      ) : (
        <DoctorsView query={debouncedQuery} topInset={overlayH} />
      )}

      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top }]} onLayout={onOverlayLayout}>
        <DirectorySegments
          value={segment}
          onChange={(next) => {
            setSegment(next);
            setQuery('');
          }}
        />
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={segment === 'clinics' ? 'Search clinics or area…' : 'Search doctors…'}
          floating
        />
        {!isOnline ? (
          <View style={[styles.offlineChip, { backgroundColor: theme.brandTint }]}>
            <Icon name="wifi.slash" size={12} tintColor={theme.brand} />
            <ThemedText type="caption" themeColor="brand" style={styles.offlineLabel}>
              Offline — showing cached results
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Space.xl,
    gap: Space.md,
    paddingBottom: Space.md,
  },
  offlineChip: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  offlineLabel: { fontWeight: '600' },
});

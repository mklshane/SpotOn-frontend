import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Space } from '@/constants/theme';
import { listFacilities, nearbyFacilities, type FacilityWithDistance } from '@/data/repositories';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useLocation } from '@/hooks/use-location';
import { humanizeTag } from '@/lib/format';
import { isOpenNow } from '@/lib/hours';
import { downloadAreaPack } from '@/lib/map-offline';
import { useTheme } from '@/hooks/use-theme';

import { ClinicCard } from './ClinicCard';
import { ClinicMap } from './ClinicMap';

export type ClinicsViewProps = { query: string; topInset: number };

type SortMode = 'distance' | 'rating' | 'name';
type Facility = FacilitySync | FacilityWithDistance;

const SNAP_POINTS = ['32%', '64%', '92%'];
const SCREEN_H = Dimensions.get('window').height;
const COLLAPSED_BOTTOM_INSET = SCREEN_H * 0.32 + 12;
const ALL_CHIP = 'All Clinics';
const OPEN_CHIP = 'Open Now';
const PHILHEALTH_CHIP = 'PhilHealth';

export function ClinicsView({ query, topInset }: ClinicsViewProps) {
  const theme = useTheme();
  const { coords } = useLocation();
  const { isOnline } = useConnectivity();

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState(false);
  const [service, setService] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [philhealthOnly, setPhilhealthOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serviceFacets, setServiceFacets] = useState<string[]>([]);

  // Facet chips — one-time broad fetch.
  useEffect(() => {
    listFacilities({ limit: 1000 })
      .then((all) => setServiceFacets(Array.from(new Set(all.flatMap((f) => f.services))).sort()))
      .catch(() => {});
  }, []);

  // Main data fetch — stale-while-loading (no spinner flash on refilter).
  useEffect(() => {
    let cancelled = false;
    const params = { q: query || undefined, service: service ?? undefined, limit: 200 };
    const fetcher = coords ? nearbyFacilities(coords.latitude, coords.longitude, params) : listFacilities(params);
    fetcher
      .then((rows) => !cancelled && setFacilities(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, service, coords]);

  // Default sort to distance once location is known.
  useEffect(() => {
    if (coords) setSort((s) => (s === 'name' ? 'distance' : s));
  }, [coords]);

  // Cache map tiles for the area once we have a fix and a connection.
  useEffect(() => {
    if (coords && isOnline) downloadAreaPack(coords).catch(() => {});
  }, [coords, isOnline]);

  const filtered = useMemo(() => {
    if (!facilities) return [];
    let rows = facilities;
    if (openOnly) rows = rows.filter((f) => isOpenNow(f.weekday_hours, f.weekend_hours) === true);
    if (philhealthOnly) rows = rows.filter((f) => f.has_philhealth);

    const sorted = [...rows];
    if (sort === 'distance' && coords) {
      sorted.sort((a, b) => ('distance_m' in a ? a.distance_m : Infinity) - ('distance_m' in b ? b.distance_m : Infinity));
    } else if (sort === 'rating') {
      sorted.sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [facilities, openOnly, philhealthOnly, sort, coords]);

  const cycleSort = useCallback(() => {
    setSort((s) => {
      if (s === 'distance') return 'rating';
      if (s === 'rating') return 'name';
      return coords ? 'distance' : 'rating';
    });
  }, [coords]);

  const sortLabel = sort === 'distance' ? 'distance' : sort === 'rating' ? 'rating' : 'name';
  const chips = [ALL_CHIP, OPEN_CHIP, PHILHEALTH_CHIP, ...serviceFacets];

  return (
    <View style={styles.fill}>
      <ClinicMap
        facilities={filtered}
        coords={coords}
        selectedId={selectedId}
        onSelectFacility={setSelectedId}
        bottomInset={COLLAPSED_BOTTOM_INSET}
      />

      <BottomSheet
        index={0}
        snapPoints={SNAP_POINTS}
        topInset={topInset}
        enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: theme.surface }}
        handleIndicatorStyle={{ backgroundColor: theme.hairline }}>
        <View style={styles.header}>
          <View style={styles.resultsRow}>
            <ThemedText type="subhead" themeColor="textSecondary">
              {filtered.length} {filtered.length === 1 ? 'clinic' : 'clinics'} · by {sortLabel}
            </ThemedText>
            <Pressable onPress={cycleSort} accessibilityRole="button" accessibilityLabel="Change sort order" hitSlop={8}>
              <Icon name="arrow.up.arrow.down" size={16} tintColor={theme.brand} />
            </Pressable>
          </View>

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={chips}
            keyExtractor={(s) => s}
            contentContainerStyle={styles.chips}
            renderItem={({ item }) => {
              if (item === ALL_CHIP) {
                return (
                  <Chip
                    label={item}
                    active={!service && !openOnly && !philhealthOnly}
                    onPress={() => {
                      setService(null);
                      setOpenOnly(false);
                      setPhilhealthOnly(false);
                    }}
                  />
                );
              }
              if (item === OPEN_CHIP) {
                return <Chip label={item} active={openOnly} onPress={() => setOpenOnly((v) => !v)} />;
              }
              if (item === PHILHEALTH_CHIP) {
                return <Chip label={item} active={philhealthOnly} onPress={() => setPhilhealthOnly((v) => !v)} />;
              }
              return (
                <Chip
                  label={humanizeTag(item)}
                  active={service === item}
                  onPress={() => setService((v) => (v === item ? null : item))}
                />
              );
            }}
          />
        </View>

        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => (
            <ClinicCard
              facility={item}
              onPress={() => router.push({ pathname: '/directory/clinic', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isOnline && facilities === null ? (
              <ListState kind="offline" title="You're offline" subtitle="Showing cached clinics only." />
            ) : facilities === null ? (
              error ? (
                <ListState kind="error" title="Couldn't load clinics" subtitle="Check your connection and try again." />
              ) : (
                <ListState kind="loading" title="Finding clinics…" />
              )
            ) : (
              <ListState kind="empty" title="No clinics found" subtitle="Try a different search or filter." />
            )
          }
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Space.xl, paddingBottom: Space.sm, gap: Space.sm },
  resultsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { gap: Space.sm },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
});

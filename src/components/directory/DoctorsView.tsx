import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { Chip } from '@/components/ui/chip';
import { ListState } from '@/components/ui/list-state';
import { Space } from '@/constants/theme';
import { listDoctors, type DoctorQuery } from '@/data/repositories';

import { DoctorCard } from './DoctorCard';

export type DoctorsViewProps = { query: string; topInset: number };

const PDS_CHIP = 'PDS certified';

export function DoctorsView({ query, topInset }: DoctorsViewProps) {
  const [pdsOnly, setPdsOnly] = useState(false);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<DoctorSync[] | null>(null);
  const [error, setError] = useState(false);

  // One-time broad fetch to derive the specialty facet chips.
  useEffect(() => {
    let cancelled = false;
    listDoctors({ limit: 500 })
      .then((all) => {
        if (cancelled) return;
        setSpecialties(Array.from(new Set(all.flatMap((d) => d.specialties))).sort());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q: DoctorQuery = {
      q: query || undefined,
      pdsCertified: pdsOnly || undefined,
      specialty: specialty ?? undefined,
      limit: 100,
    };
    listDoctors(q)
      .then((rows) => !cancelled && setDoctors(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, pdsOnly, specialty]);

  const onSelect = (id: string) => router.push({ pathname: '/directory/doctor', params: { id } });

  return (
    <View style={[styles.fill, { paddingTop: topInset }]}>
      <FlatList
        data={doctors ?? []}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DoctorCard doctor={item} onPress={() => onSelect(item.id)} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[PDS_CHIP, ...specialties]}
            keyExtractor={(s) => s}
            contentContainerStyle={styles.chips}
            renderItem={({ item }) =>
              item === PDS_CHIP ? (
                <Chip label={item} active={pdsOnly} onPress={() => setPdsOnly((v) => !v)} />
              ) : (
                <Chip
                  label={item}
                  active={specialty === item}
                  onPress={() => setSpecialty((v) => (v === item ? null : item))}
                />
              )
            }
            style={styles.chipRow}
          />
        }
        ListEmptyComponent={
          doctors === null ? (
            error ? (
              <ListState kind="error" title="Couldn't load doctors" subtitle="Check your connection and try again." />
            ) : (
              <ListState kind="loading" title="Loading doctors…" />
            )
          ) : (
            <ListState kind="empty" title="No doctors found" subtitle="Try a different search or filter." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  chipRow: { marginBottom: Space.base },
  chips: { gap: Space.sm },
});

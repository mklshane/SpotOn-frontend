import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { DoctorSync, FacilitySync } from '@/api/types';
import { Chip } from '@/components/ui/chip';
import { ListState } from '@/components/ui/list-state';
import { Space } from '@/constants/theme';
import { listDoctors, listFacilities } from '@/data/repositories';

import { ClinicCard } from './ClinicCard';
import { DoctorCard } from './DoctorCard';

export type DoctorsViewProps = { query: string; topInset: number };

type BookingMode = 'doctors' | 'clinics';

/**
 * The "Online Booking" tab: ONLY entries that can be booked online.
 * A Doctors/Clinics toggle switches between doctors with an active booking
 * link and clinics with their own online-booking page (facilities.booking_url).
 */
export function DoctorsView({ query, topInset }: DoctorsViewProps) {
  const [mode, setMode] = useState<BookingMode>('doctors');
  const [doctors, setDoctors] = useState<DoctorSync[] | null>(null);
  const [clinics, setClinics] = useState<FacilitySync[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (mode === 'doctors') {
      listDoctors({ q: query || undefined, hasBookingLink: true, limit: 100 })
        .then((rows) => !cancelled && setDoctors(rows))
        .catch(() => !cancelled && setError(true));
    } else {
      listFacilities({ q: query || undefined, hasBookingUrl: true, limit: 100 })
        .then((rows) => !cancelled && setClinics(rows))
        .catch(() => !cancelled && setError(true));
    }
    return () => {
      cancelled = true;
    };
  }, [mode, query]);

  const loading = mode === 'doctors' ? doctors === null : clinics === null;
  const empty = mode === 'doctors' ? doctors?.length === 0 : clinics?.length === 0;

  const header = (
    <View style={styles.modeRow}>
      <Chip label="Doctors" active={mode === 'doctors'} onPress={() => setMode('doctors')} />
      <Chip label="Clinics" active={mode === 'clinics'} onPress={() => setMode('clinics')} />
    </View>
  );

  const emptyState = loading ? (
    error ? (
      <ListState kind="error" title="Couldn't load" subtitle="Check your connection and try again." />
    ) : (
      <ListState kind="loading" title="Loading…" />
    )
  ) : (
    <ListState kind="empty" title="No online booking found" subtitle="Try a different search." />
  );

  return (
    <View style={[styles.fill, { paddingTop: topInset }]}>
      {mode === 'doctors' ? (
        <FlatList
          data={doctors ?? []}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DoctorCard
              doctor={item}
              onPress={() => router.push({ pathname: '/directory/doctor', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={empty || loading ? emptyState : null}
        />
      ) : (
        <FlatList
          data={clinics ?? []}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => (
            <ClinicCard
              facility={item}
              onPress={() => router.push({ pathname: '/directory/clinic', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={empty || loading ? emptyState : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  modeRow: { flexDirection: 'row', gap: Space.sm, marginBottom: Space.base },
});

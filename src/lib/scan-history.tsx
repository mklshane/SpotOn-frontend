import * as FileSystem from 'expo-file-system/legacy';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { insertScreening, listScreenings } from '@/data/screening-repo';
import type { ScreeningRecord } from '@/lib/triage/types';

/**
 * Screening history — SQLite-backed with a write-through in-memory cache.
 * Records load once on mount; addEntry persists (copying the photo out of the
 * evictable cache directory first) and prepends. The hook surface is unchanged
 * from the earlier in-memory version so existing consumers keep working.
 */
type ScanHistoryContextValue = {
  entries: ScreeningRecord[];
  /** True until the initial SQLite load settles. */
  loading: boolean;
  getById: (id: string) => ScreeningRecord | undefined;
  addEntry: (record: Omit<ScreeningRecord, 'id' | 'createdAt'>) => Promise<ScreeningRecord>;
};

const ScanHistoryContext = createContext<ScanHistoryContextValue | undefined>(undefined);

const SCREENINGS_DIR = `${FileSystem.documentDirectory ?? ''}screenings/`;

/** Copy the (cache-dir) capture into permanent storage so history thumbnails survive. */
async function persistImage(id: string, uri: string): Promise<string> {
  try {
    await FileSystem.makeDirectoryAsync(SCREENINGS_DIR, { intermediates: true }).catch(() => {});
    const dest = `${SCREENINGS_DIR}${id}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    console.warn('[history] image copy failed, keeping original uri', e);
    return uri;
  }
}

export function ScanHistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ScreeningRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listScreenings()
      .then((records) => {
        if (alive) setEntries(records);
      })
      .catch((e) => console.warn('[history] load failed', e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const addEntry = useCallback<ScanHistoryContextValue['addEntry']>(async (record) => {
    const id = `scan-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const imageUri = await persistImage(id, record.imageUri);
    const full: ScreeningRecord = { ...record, id, createdAt, imageUri };
    await insertScreening(full);
    setEntries((prev) => [full, ...prev]);
    return full;
  }, []);

  const value = useMemo<ScanHistoryContextValue>(
    () => ({
      entries,
      loading,
      addEntry,
      getById: (id) => entries.find((e) => e.id === id),
    }),
    [entries, loading, addEntry],
  );

  return <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>;
}

export function useScanHistory(): ScanHistoryContextValue {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx) throw new Error('useScanHistory must be used within a ScanHistoryProvider');
  return ctx;
}

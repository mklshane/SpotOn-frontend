import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { BodyMark } from './scan-draft';

/** One completed screening in the user's history. (Full result fields come in a later phase.) */
export type AnalysisEntry = {
  id: string;
  mark: BodyMark;
  imageUri?: string;
  /** ISO timestamp. */
  createdAt: string;
};

// Seed data so the body-lesions map is populated before the real capture→history
// pipeline has any entries. Points are in the fitted body model's local space
// (same space `BodyViewer` produces when a user marks a spot).
const SEED: AnalysisEntry[] = [
  { id: 'seed-1', createdAt: '2026-06-20T09:12:00Z', mark: { point: [0.2, 0.72, 0.34], region: 'Chest', view: 'front' } },
  { id: 'seed-2', createdAt: '2026-05-28T16:40:00Z', mark: { point: [0.74, 0.04, 0.2], region: 'Left forearm', view: 'front' } },
  { id: 'seed-3', createdAt: '2026-04-15T11:05:00Z', mark: { point: [-0.26, -0.95, 0.3], region: 'Right thigh', view: 'front' } },
];

type ScanHistoryContextValue = {
  entries: AnalysisEntry[];
  getById: (id: string) => AnalysisEntry | undefined;
  addEntry: (entry: Omit<AnalysisEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => AnalysisEntry;
};

const ScanHistoryContext = createContext<ScanHistoryContextValue | undefined>(undefined);

export function ScanHistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<AnalysisEntry[]>(SEED);

  const addEntry = useCallback<ScanHistoryContextValue['addEntry']>((entry) => {
    const full: AnalysisEntry = {
      id: entry.id ?? `scan-${Date.now()}`,
      createdAt: entry.createdAt ?? new Date().toISOString(),
      mark: entry.mark,
      imageUri: entry.imageUri,
    };
    setEntries((prev) => [full, ...prev]);
    return full;
  }, []);

  const value = useMemo<ScanHistoryContextValue>(
    () => ({
      entries,
      addEntry,
      getById: (id) => entries.find((e) => e.id === id),
    }),
    [entries, addEntry],
  );

  return <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>;
}

export function useScanHistory(): ScanHistoryContextValue {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx) throw new Error('useScanHistory must be used within a ScanHistoryProvider');
  return ctx;
}

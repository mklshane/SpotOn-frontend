import * as FileSystem from 'expo-file-system/legacy';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  deleteLesion as deleteLesionRow,
  listLesions,
  setLesionArchived,
  updateLesionLabel,
} from '@/data/lesion-repo';
import {
  insertScreeningLinked,
  listScreenings,
  setScreeningLesion,
} from '@/data/screening-repo';
import type { BodyMark, Lesion, ScreeningImage, ScreeningRecord } from '@/lib/triage/types';

/**
 * Screening + lesion history — SQLite-backed with a write-through in-memory cache.
 * Records load once on mount; addEntry persists (copying the photo out of the
 * evictable cache directory first) and prepends. The hook surface is a superset of
 * the earlier version, so existing consumers keep working.
 *
 * Every screening belongs to a lesion: addEntry mints one when the caller doesn't
 * supply an id, so "tracking" is the default rather than an opt-in the user has to
 * remember at scan time.
 */
type NewScreening = Omit<ScreeningRecord, 'id' | 'createdAt' | 'lesionId' | 'images'> & {
  /** Existing lesion to link to. Omitted/null mints a new one. */
  lesionId?: string | null;
  /** Label for a newly minted lesion. Ignored when linking to an existing one. */
  lesionLabel?: string | null;
  /** 1–3 photos. Omitted means a single-photo screening, derived from `imageUri`. */
  images?: ScreeningImage[];
};

type ScanHistoryContextValue = {
  entries: ScreeningRecord[];
  lesions: Lesion[];
  /** True until the initial SQLite load settles. */
  loading: boolean;
  getById: (id: string) => ScreeningRecord | undefined;
  getLesionById: (id: string) => Lesion | undefined;
  /** A lesion's screenings, oldest first — the order the timeline reads them in. */
  screeningsForLesion: (lesionId: string) => ScreeningRecord[];
  addEntry: (record: NewScreening) => Promise<ScreeningRecord>;
  renameLesion: (id: string, label: string | null) => Promise<void>;
  archiveLesion: (id: string, archived: boolean) => Promise<void>;
  /** Attach an existing screening to a lesion (retroactive "track this"), or detach with null. */
  linkScreening: (screeningId: string, lesionId: string | null) => Promise<void>;
  /** Mint a lesion from an already-saved screening and link it. Returns the new lesion. */
  trackScreening: (screeningId: string, label?: string | null) => Promise<Lesion | undefined>;
  deleteLesion: (id: string) => Promise<void>;
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
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([listScreenings(), listLesions({ includeArchived: true })])
      .then(([records, ls]) => {
        if (!alive) return;
        setEntries(records);
        setLesions(ls);
      })
      .catch((e) => console.warn('[history] load failed', e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  /** Replace one lesion in the cache (or append it if it's new). */
  const mergeLesion = useCallback((lesion: Lesion) => {
    setLesions((prev) => {
      const i = prev.findIndex((l) => l.id === lesion.id);
      if (i === -1) return [lesion, ...prev];
      const next = [...prev];
      next[i] = lesion;
      return next;
    });
  }, []);

  const addEntry = useCallback<ScanHistoryContextValue['addEntry']>(
    async ({ lesionId, lesionLabel, images, ...record }) => {
      const id = `scan-${Date.now()}`;
      const createdAt = new Date().toISOString();

      // Photos are copied out of the evictable cache dir in capture order. Index 0 keeps the
      // historical `${id}.jpg` name, so single-photo screenings are byte-identical on disk to
      // before multi-image existed.
      const captured: ScreeningImage[] =
        images?.length
          ? images
          : [{ uri: record.imageUri, index: 0, source: record.source, qualityPassed: true }];
      const persisted: ScreeningImage[] = [];
      for (const img of captured) {
        const uri = await persistImage(img.index === 0 ? id : `${id}-${img.index}`, img.uri);
        persisted.push({ ...img, uri });
      }
      const imageUri = persisted[0].uri;

      // A follow-up links to its lesion; a fresh scan mints one, so every screening is trackable
      // without the user having to opt in at scan time.
      const targetLesionId = lesionId ?? `lesion-${Date.now()}`;
      const full: ScreeningRecord = {
        ...record,
        id,
        createdAt,
        imageUri,
        images: persisted,
        lesionId: targetLesionId,
      };
      const lesion = await insertScreeningLinked(full, {
        id: targetLesionId,
        mark: record.mark,
        label: lesionId ? undefined : (lesionLabel ?? null),
        userId: record.userId ?? null,
      });
      setEntries((prev) => [full, ...prev]);
      mergeLesion(lesion);
      return full;
    },
    [mergeLesion],
  );

  const renameLesion = useCallback<ScanHistoryContextValue['renameLesion']>(async (id, label) => {
    await updateLesionLabel(id, label);
    setLesions((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));
  }, []);

  const archiveLesion = useCallback<ScanHistoryContextValue['archiveLesion']>(
    async (id, archived) => {
      await setLesionArchived(id, archived);
      setLesions((prev) => prev.map((l) => (l.id === id ? { ...l, archived } : l)));
    },
    [],
  );

  const linkScreening = useCallback<ScanHistoryContextValue['linkScreening']>(
    async (screeningId, lesionId) => {
      await setScreeningLesion(screeningId, lesionId);
      setEntries((prev) => prev.map((e) => (e.id === screeningId ? { ...e, lesionId } : e)));
      // Rollups on both sides moved; re-read rather than trying to patch them in place.
      setLesions(await listLesions({ includeArchived: true }));
    },
    [],
  );

  const trackScreening = useCallback<ScanHistoryContextValue['trackScreening']>(
    async (screeningId, label) => {
      const screening = entries.find((e) => e.id === screeningId);
      if (!screening) return undefined;
      const lesionId = screening.lesionId ?? `lesion-${Date.now()}`;
      const created: Lesion = {
        id: lesionId,
        createdAt: screening.createdAt,
        updatedAt: new Date().toISOString(),
        label: label ?? null,
        mark: screening.mark,
        screeningCount: 0,
        firstScreenedAt: null,
        lastScreenedAt: null,
        lastScreeningId: null,
        lastTier: null,
        archived: false,
        userId: screening.userId ?? null,
      };
      const { insertLesion, refreshLesionRollup } = await import('@/data/lesion-repo');
      await insertLesion(created);
      await setScreeningLesion(screeningId, lesionId);
      const fresh = await refreshLesionRollup(lesionId);
      setEntries((prev) => prev.map((e) => (e.id === screeningId ? { ...e, lesionId } : e)));
      if (fresh) mergeLesion(fresh);
      return fresh ?? created;
    },
    [entries, mergeLesion],
  );

  const deleteLesion = useCallback<ScanHistoryContextValue['deleteLesion']>(async (id) => {
    await deleteLesionRow(id);
    setLesions((prev) => prev.filter((l) => l.id !== id));
    setEntries((prev) => prev.map((e) => (e.lesionId === id ? { ...e, lesionId: null } : e)));
  }, []);

  const value = useMemo<ScanHistoryContextValue>(
    () => ({
      entries,
      lesions,
      loading,
      addEntry,
      renameLesion,
      archiveLesion,
      linkScreening,
      trackScreening,
      deleteLesion,
      getById: (id) => entries.find((e) => e.id === id),
      getLesionById: (id) => lesions.find((l) => l.id === id),
      screeningsForLesion: (lesionId) =>
        entries
          .filter((e) => e.lesionId === lesionId)
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }),
    [
      entries,
      lesions,
      loading,
      addEntry,
      renameLesion,
      archiveLesion,
      linkScreening,
      trackScreening,
      deleteLesion,
    ],
  );

  return <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>;
}

export function useScanHistory(): ScanHistoryContextValue {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx) throw new Error('useScanHistory must be used within a ScanHistoryProvider');
  return ctx;
}

export type { BodyMark };

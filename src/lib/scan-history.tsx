import * as FileSystem from '@/lib/fs';
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
import { claimLegacyHistory, isDatabaseEphemeral } from '@/data/db';
import { useAuth } from '@/lib/auth';
import { syncSelfCheckReminder } from '@/lib/notifications';
import type { BodyMark, Lesion, ScreeningImage, ScreeningRecord } from '@/lib/triage/types';

/**
 * Screening + lesion history - SQLite-backed with a write-through in-memory cache.
 * Records load once on mount; addEntry persists (copying the photo out of the
 * evictable cache directory first) and prepends. The hook surface is a superset of
 * the earlier version, so existing consumers keep working.
 *
 * Every screening belongs to a lesion: addEntry mints one when the caller doesn't
 * supply an id, so "tracking" is the default rather than an opt-in the user has to
 * remember at scan time.
 */
type NewScreening = Omit<ScreeningRecord, 'id' | 'createdAt' | 'lesionId' | 'images' | 'userId'> & {
  /**
   * Reuse a specific screening id. The scan flow passes one so that retrying a failed save
   * re-writes the SAME row (insertScreening is INSERT OR REPLACE) instead of minting a second
   * screening from the same photo and answers. Omitted means "mint a new one".
   */
  id?: string;
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
  /**
   * The initial read failed. Distinct from `loading: false` with an empty list, which means "you
   * genuinely have no screenings" - the two used to be indistinguishable, so a failed SQLite read
   * told a user their entire history was empty. In a longitudinal tracking app that reads as data
   * loss, which is the one impression this screen must never give by accident.
   */
  loadError: boolean;
  getById: (id: string) => ScreeningRecord | undefined;
  getLesionById: (id: string) => Lesion | undefined;
  /** A lesion's screenings, oldest first - the order the timeline reads them in. */
  screeningsForLesion: (lesionId: string) => ScreeningRecord[];
  addEntry: (record: NewScreening) => Promise<ScreeningRecord>;
  /** True when the database itself is a throwaway - nothing written this session will survive. */
  storageIsEphemeral: boolean;
  renameLesion: (id: string, label: string | null) => Promise<void>;
  archiveLesion: (id: string, archived: boolean) => Promise<void>;
  /** Attach an existing screening to a lesion (retroactive "track this"), or detach with null. */
  linkScreening: (screeningId: string, lesionId: string | null) => Promise<void>;
  /** Mint a lesion from an already-saved screening and link it. Returns the new lesion. */
  trackScreening: (screeningId: string, label?: string | null) => Promise<Lesion | undefined>;
  deleteLesion: (id: string) => Promise<void>;
};

const ScanHistoryContext = createContext<ScanHistoryContextValue | undefined>(undefined);

function screeningsDir(userId: string): string {
  return `${FileSystem.documentDirectory ?? ''}screenings/${encodeURIComponent(userId)}/`;
}

/**
 * A URI that stops resolving the moment this page goes away.
 *
 * On web the capture pipeline hands us `blob:` URLs (image-ops.web.ts revokes nothing, but the
 * browser drops them on unload) and occasionally `data:` ones. Keeping one of those as a
 * screening's photo path writes a row that is already broken: the thumbnail, the result hero and
 * the PDF all render blank forever, with no error anyone saw.
 */
function isEphemeral(uri: string): boolean {
  return uri.startsWith('blob:') || uri.startsWith('data:');
}

/**
 * Copy the (cache-dir) capture into permanent storage so history thumbnails survive.
 *
 * Retries once: the common web failure is a transient OPFS/service-worker hiccup, and a second
 * attempt costs a few milliseconds against losing the photo.
 *
 * If the copy still fails, the fallback is the ORIGINAL uri - which is fine on device (a real
 * file in the cache directory, at worst evicted later) and useless on web. So an ephemeral
 * fallback throws instead: a visible "we couldn't save this" the user can act on beats a saved
 * record whose photo is already dead. That asymmetry is the whole point of the check - see
 * isEphemeral above.
 */
async function persistImage(userId: string, id: string, uri: string): Promise<string> {
  const dir = screeningsDir(userId);
  const dest = `${dir}${id}.jpg`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    } catch (e) {
      lastError = e;
    }
  }
  if (isEphemeral(uri)) {
    throw new Error(`could not store screening photo: ${String(lastError)}`, { cause: lastError });
  }
  console.warn('[history] image copy failed, keeping original uri', lastError);
  return uri;
}

export function ScanHistoryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [entries, setEntries] = useState<ScreeningRecord[]>([]);
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [ephemeral, setEphemeral] = useState(false);
  const [loadState, setLoadState] = useState<{
    accountId: string | null;
    error: boolean;
  }>({ accountId: null, error: false });
  const loading = accountId != null && loadState.accountId !== accountId;
  const loadError = loadState.accountId === accountId && loadState.error;

  useEffect(() => {
    let alive = true;
    if (!accountId) return () => { alive = false; };

    claimLegacyHistory(accountId)
      .then(() => {
        void syncSelfCheckReminder().catch((e) => console.warn('[notifications] account sync failed', e));
        return Promise.all([
          listScreenings(accountId),
          listLesions(accountId, { includeArchived: true }),
        ]);
      })
      .then(([records, ls]) => {
        if (!alive) return;
        setEntries(records);
        setLesions(ls);
        setEphemeral(isDatabaseEphemeral());
        setLoadState({ accountId, error: false });
      })
      .catch((e) => {
        console.warn('[history] load failed', e);
        if (alive) setLoadState({ accountId, error: true });
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const scopedEntries = useMemo(
    () => accountId ? entries.filter((entry) => entry.userId === accountId) : [],
    [accountId, entries],
  );
  const scopedLesions = useMemo(
    () => accountId ? lesions.filter((lesion) => lesion.userId === accountId) : [],
    [accountId, lesions],
  );

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
    async ({ id: reuseId, lesionId, lesionLabel, images, ...record }) => {
      if (!accountId) throw new Error('Cannot save screening history while signed out');
      const id = reuseId ?? `scan-${Date.now()}`;
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
        const uri = await persistImage(accountId, img.index === 0 ? id : `${id}-${img.index}`, img.uri);
        persisted.push({ ...img, uri });
      }
      const imageUri = persisted[0].uri;

      // A follow-up links to its lesion; a fresh scan mints one, so every screening is trackable
      // without the user having to opt in at scan time.
      // Derived from the screening id, not the clock: a retry of a failed save must land on the
      // same lesion rather than minting a second one for the same spot.
      const targetLesionId = lesionId ?? `lesion-${id}`;
      const full: ScreeningRecord = {
        ...record,
        id,
        createdAt,
        imageUri,
        images: persisted,
        lesionId: targetLesionId,
        userId: accountId,
      };
      const lesion = await insertScreeningLinked(full, {
        id: targetLesionId,
        mark: record.mark,
        label: lesionId ? undefined : (lesionLabel ?? null),
        userId: accountId,
      });
      setEntries((prev) => [full, ...prev]);
      mergeLesion(lesion);
      return full;
    },
    [accountId, mergeLesion],
  );

  const renameLesion = useCallback<ScanHistoryContextValue['renameLesion']>(async (id, label) => {
    if (!accountId) return;
    await updateLesionLabel(id, label, accountId);
    setLesions((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));
  }, [accountId]);

  const archiveLesion = useCallback<ScanHistoryContextValue['archiveLesion']>(
    async (id, archived) => {
      if (!accountId) return;
      await setLesionArchived(id, archived, accountId);
      setLesions((prev) => prev.map((l) => (l.id === id ? { ...l, archived } : l)));
    },
    [accountId],
  );

  const linkScreening = useCallback<ScanHistoryContextValue['linkScreening']>(
    async (screeningId, lesionId) => {
      if (!accountId) return;
      await setScreeningLesion(screeningId, lesionId, accountId);
      setEntries((prev) => prev.map((e) => (e.id === screeningId ? { ...e, lesionId } : e)));
      // Rollups on both sides moved; re-read rather than trying to patch them in place.
      setLesions(await listLesions(accountId, { includeArchived: true }));
    },
    [accountId],
  );

  const trackScreening = useCallback<ScanHistoryContextValue['trackScreening']>(
    async (screeningId, label) => {
      if (!accountId) return undefined;
      const screening = scopedEntries.find((e) => e.id === screeningId);
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
        userId: accountId,
      };
      const { insertLesion, refreshLesionRollup } = await import('@/data/lesion-repo');
      await insertLesion(created);
      await setScreeningLesion(screeningId, lesionId, accountId);
      const fresh = await refreshLesionRollup(lesionId, accountId);
      setEntries((prev) => prev.map((e) => (e.id === screeningId ? { ...e, lesionId } : e)));
      if (fresh) mergeLesion(fresh);
      return fresh ?? created;
    },
    [accountId, scopedEntries, mergeLesion],
  );

  const deleteLesion = useCallback<ScanHistoryContextValue['deleteLesion']>(async (id) => {
    if (!accountId) return;
    await deleteLesionRow(id, accountId);
    setLesions((prev) => prev.filter((l) => l.id !== id));
    setEntries((prev) => prev.map((e) => (e.lesionId === id ? { ...e, lesionId: null } : e)));
  }, [accountId]);

  const value = useMemo<ScanHistoryContextValue>(
    () => ({
      entries: scopedEntries,
      lesions: scopedLesions,
      loading,
      loadError,
      addEntry,
      storageIsEphemeral: ephemeral,
      renameLesion,
      archiveLesion,
      linkScreening,
      trackScreening,
      deleteLesion,
      getById: (id) => scopedEntries.find((e) => e.id === id),
      getLesionById: (id) => scopedLesions.find((l) => l.id === id),
      screeningsForLesion: (lesionId) =>
        scopedEntries
          .filter((e) => e.lesionId === lesionId)
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }),
    [
      scopedEntries,
      scopedLesions,
      loading,
      loadError,
      ephemeral,
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

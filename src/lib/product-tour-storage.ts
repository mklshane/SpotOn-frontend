import { getMeta, setMeta } from '@/data/db';

import { accountStorageKey } from './account-scope';
import { STORAGE_KEYS } from './storage-keys';

type TourStatus = 'pending' | 'seen' | null;

// A failed SQLite write must not make registration fail or restart a dismissed tour in this session.
const sessionStatus = new Map<string, TourStatus>();

function key(userId: string) {
  return accountStorageKey(userId, STORAGE_KEYS.productTourStatus);
}

export async function readProductTourStatus(userId: string): Promise<TourStatus> {
  if (sessionStatus.has(userId)) return sessionStatus.get(userId) ?? null;
  const stored = await getMeta(key(userId));
  return stored === 'pending' || stored === 'seen' ? stored : null;
}

export async function markProductTourPending(userId: string): Promise<void> {
  sessionStatus.set(userId, 'pending');
  await setMeta(key(userId), 'pending');
}

export async function markProductTourSeen(userId: string): Promise<void> {
  sessionStatus.set(userId, 'seen');
  await setMeta(key(userId), 'seen');
}

// Scan-flow tips: one JSON list per account of the tip sets already shown.
const scanTipsSession = new Map<string, string[]>();

function scanTipsKey(userId: string) {
  return accountStorageKey(userId, STORAGE_KEYS.scanTipsSeen);
}

export async function readSeenScanTips(userId: string): Promise<string[]> {
  const cached = scanTipsSession.get(userId);
  if (cached) return cached;
  let seen: string[] = [];
  try {
    const parsed: unknown = JSON.parse((await getMeta(scanTipsKey(userId))) ?? '[]');
    if (Array.isArray(parsed)) seen = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    // A corrupt value reads as "nothing seen"; the next write replaces it.
  }
  scanTipsSession.set(userId, seen);
  return seen;
}

export async function markScanTipsSeen(userId: string, ids: string[]): Promise<void> {
  const seen = [...new Set([...(await readSeenScanTips(userId)), ...ids])];
  scanTipsSession.set(userId, seen);
  await setMeta(scanTipsKey(userId), JSON.stringify(seen));
}

export async function resetScanTips(userId: string): Promise<void> {
  scanTipsSession.set(userId, []);
  await setMeta(scanTipsKey(userId), '[]');
}

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

import { getMeta, setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await getMeta(STORAGE_KEYS.hasSeenOnboarding)) === '1';
}

export async function markOnboardingSeen(): Promise<void> {
  await setMeta(STORAGE_KEYS.hasSeenOnboarding, '1');
}

export async function resetOnboarding(): Promise<void> {
  await setMeta(STORAGE_KEYS.hasSeenOnboarding, '');
}

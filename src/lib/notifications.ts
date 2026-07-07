import { getMeta, setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';

/** Whether the user has opted into re-screening reminders. No native scheduling yet — this is purely a stored preference. */
export async function getRemindersEnabled(): Promise<boolean> {
  return (await getMeta(STORAGE_KEYS.reengagementRemindersEnabled)) === '1';
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await setMeta(STORAGE_KEYS.reengagementRemindersEnabled, enabled ? '1' : '');
}

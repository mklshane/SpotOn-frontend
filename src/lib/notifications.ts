import { getMeta, setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';

/** Whether the user has opted into re-screening reminders. No native scheduling yet — this is purely a stored preference. */
export async function getRemindersEnabled(): Promise<boolean> {
  return (await getMeta(STORAGE_KEYS.reengagementRemindersEnabled)) === '1';
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await setMeta(STORAGE_KEYS.reengagementRemindersEnabled, enabled ? '1' : '');
}

/**
 * Opt into the 30-day self-monitoring reminder after a Low-tier result (spec: Low
 * urgency schedules a monthly re-check). Stores the preference + due date; native
 * push scheduling hooks in here later.
 */
export async function scheduleSelfCheckReminder(days = 30): Promise<void> {
  const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  await setRemindersEnabled(true);
  await setMeta(STORAGE_KEYS.selfCheckReminderDueAt, due);
}

export async function getSelfCheckReminderDueAt(): Promise<string | null> {
  return await getMeta(STORAGE_KEYS.selfCheckReminderDueAt);
}

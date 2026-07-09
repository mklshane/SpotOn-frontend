/** Keys used with `getMeta`/`setMeta` (the SQLite `sync_meta` key-value store). */
export const STORAGE_KEYS = {
  hasSeenOnboarding: 'has_seen_onboarding',
  reengagementRemindersEnabled: 'reengagement_reminders_enabled',
} as const;

/** Keys used with `getMeta`/`setMeta` (the SQLite `sync_meta` key-value store). */
export const STORAGE_KEYS = {
  hasSeenOnboarding: 'has_seen_onboarding',
  reengagementRemindersEnabled: 'reengagement_reminders_enabled',
  selfCheckReminderDueAt: 'self_check_reminder_due_at',
  /** Identifier of the OS-scheduled notification, so it can be cancelled or checked for later. */
  selfCheckReminderNotificationId: 'self_check_reminder_notification_id',
  /** Lesion the pending reminder points at, so a re-arm after a restart keeps the deep link. */
  selfCheckReminderLesionId: 'self_check_reminder_lesion_id',
} as const;

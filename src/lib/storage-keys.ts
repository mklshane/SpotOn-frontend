/** Keys used with `getMeta`/`setMeta` (the SQLite `sync_meta` key-value store). */
export const STORAGE_KEYS = {
  hasSeenOnboarding: 'has_seen_onboarding',
  /** The remaining keys are passed through accountStorageKey before persistence. */
  productTourStatus: 'product_tour_status',
  /** JSON array of scan-flow tip sets (`ScanTipsId`) the account has seen. */
  scanTipsSeen: 'scan_tips_seen',
  reengagementRemindersEnabled: 'reengagement_reminders_enabled',
  selfCheckReminderDueAt: 'self_check_reminder_due_at',
  /** Identifier of the OS-scheduled notification, so it can be cancelled or checked for later. */
  selfCheckReminderNotificationId: 'self_check_reminder_notification_id',
  /** Lesion the pending reminder points at, so a re-arm after a restart keeps the deep link. */
  selfCheckReminderLesionId: 'self_check_reminder_lesion_id',
  /**
   * The research-consent version this account last saw the "Help improve SpotOn" ask for. Kept
   * locally because "Not now" never reaches the server; a new consent version re-asks.
   */
  researchPromptVersion: 'research_prompt_version',
  /**
   * The consent version of a "Share" tapped while offline. Sent to the server as soon as there is
   * a connection; nothing is uploaded until the server has recorded it.
   */
  researchPendingGrant: 'research_pending_grant',
} as const;

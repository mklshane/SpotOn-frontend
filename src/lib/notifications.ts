/**
 * The 30-day re-screening reminder, delivered by the operating system.
 *
 * This is a *local* notification: the due date is computed on the device and handed to
 * iOS/Android, which fires it whether or not the app is ever reopened. Nothing here talks to a
 * server — a push-based reminder would mean shipping screening dates off-device for no clinical
 * gain, and it would stop working the moment the user is offline.
 *
 * The stored state is the source of truth for the *intent* (enabled, due date, which lesion); the
 * OS holds the actual alarm. Those two can drift — a reinstall, "clear app data", or a permission
 * revoked and re-granted all leave the intent without an alarm — so `syncSelfCheckReminder()`
 * reconciles them on every launch.
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { getMeta, setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';

/** Default re-check interval for a Low-tier result (spec: Low urgency schedules a monthly re-check). */
export const REMINDER_DAYS = 30;

/** Android groups notifications by channel; the user can mute this one without muting the app. */
const ANDROID_CHANNEL_ID = 'self-check';

/** Fired mid-morning local time rather than at the exact hour of the original scan. */
const REMINDER_HOUR = 9;

/** Marks a notification as ours, so a tap can be told apart from anything else the OS delivers. */
const REMINDER_KIND = 'self-check-reminder';

export type ReminderOutcome =
  /** Handed to the OS; it will fire on the due date. */
  | 'scheduled'
  /** The user declined notification permission — nothing was stored. */
  | 'denied'
  /** No OS notification support (web). */
  | 'unsupported';

/** Whether the user has opted into re-screening reminders. */
export async function getRemindersEnabled(): Promise<boolean> {
  return (await getMeta(STORAGE_KEYS.reengagementRemindersEnabled)) === '1';
}

export async function getSelfCheckReminderDueAt(): Promise<string | null> {
  return (await getMeta(STORAGE_KEYS.selfCheckReminderDueAt)) || null;
}

/** The reminder currently waiting to fire, or null if there isn't one (or its date has passed). */
export type PendingReminder = { dueAt: string; lesionId: string | null };

export async function getPendingSelfCheckReminder(): Promise<PendingReminder | null> {
  if (!(await getRemindersEnabled())) return null;
  const dueAt = await getSelfCheckReminderDueAt();
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due) || due <= Date.now()) return null;
  return { dueAt, lesionId: (await getMeta(STORAGE_KEYS.selfCheckReminderLesionId)) || null };
}

async function writeEnabled(enabled: boolean): Promise<void> {
  await setMeta(STORAGE_KEYS.reengagementRemindersEnabled, enabled ? '1' : '');
}

/** When `days` from now falls, snapped to a civil hour. */
function reminderDate(days: number): Date {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setHours(REMINDER_HOUR, 0, 0, 0);
  // Snapping backwards can land in the past for a same-day interval (only reachable from the dev
  // shortcut); a reminder the OS would drop on the floor is worse than one a few minutes out.
  const floor = Date.now() + 60_000;
  if (at.getTime() < floor) at.setTime(floor);
  return at;
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Re-screening reminders',
    description: 'Reminders to photograph a spot again after 30 days.',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#FF8A4C',
  });
}

/**
 * Get notification permission, prompting only if the OS still allows a prompt. Returns whether we
 * may post notifications; a provisional (quiet) iOS authorization counts, since the reminder still
 * reaches Notification Center.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const granted = (s: Notifications.NotificationPermissionsStatus) =>
    s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  const current = await Notifications.getPermissionsAsync();
  if (granted(current)) return true;
  if (!current.canAskAgain) return false; // previously denied — only the system settings can undo it
  return granted(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }),
  );
}

/**
 * Hand one dated notification to the OS and return its identifier.
 *
 * The copy deliberately states no elapsed-day count: a re-arm after a reinstall knows the due
 * date but not the original screening date, and a reminder that misstates when you were last
 * screened is worse than one that doesn't mention it.
 */
async function arm(due: Date, lesionId: string | null): Promise<string> {
  await ensureChannel();
  return await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to re-check your spot',
      body: 'Take a new photo so SpotOn can compare it against your last screening.',
      data: { kind: REMINDER_KIND, lesionId },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: due,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

/** Cancel the pending OS notification (if any), leaving the stored due date alone. */
async function disarm(): Promise<void> {
  const id = await getMeta(STORAGE_KEYS.selfCheckReminderNotificationId);
  if (!id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await setMeta(STORAGE_KEYS.selfCheckReminderNotificationId, '');
}

/**
 * Opt into the re-screening reminder after a Low-tier result: asks for notification permission,
 * schedules the OS notification, and records the due date. Only one reminder is pending at a time
 * — scheduling a new one replaces the old.
 */
export async function scheduleSelfCheckReminder(
  days = REMINDER_DAYS,
  opts: { lesionId?: string | null } = {},
): Promise<ReminderOutcome> {
  if (Platform.OS === 'web') return 'unsupported';
  if (!(await ensureNotificationPermission())) return 'denied';

  await disarm();
  const lesionId = opts.lesionId ?? null;
  const due = reminderDate(days);
  const id = await arm(due, lesionId);

  await setMeta(STORAGE_KEYS.selfCheckReminderDueAt, due.toISOString());
  await setMeta(STORAGE_KEYS.selfCheckReminderNotificationId, id);
  await setMeta(STORAGE_KEYS.selfCheckReminderLesionId, lesionId ?? '');
  await writeEnabled(true);
  return 'scheduled';
}

/** Cancel the pending reminder and forget the due date entirely. */
export async function cancelSelfCheckReminder(): Promise<void> {
  await disarm();
  await setMeta(STORAGE_KEYS.selfCheckReminderDueAt, '');
  await setMeta(STORAGE_KEYS.selfCheckReminderLesionId, '');
}

/**
 * Settings toggle. Turning it off cancels the OS notification but keeps the due date, so turning
 * it back on restores the *same* date rather than restarting the 30 days. Returns the state the
 * toggle actually ended in — turning it on can fail if the user denies the permission prompt.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await disarm();
    await writeEnabled(false);
    return false;
  }
  if (Platform.OS !== 'web' && !(await ensureNotificationPermission())) {
    await writeEnabled(false);
    return false;
  }
  await writeEnabled(true);
  await syncSelfCheckReminder();
  return true;
}

/**
 * Reconcile stored intent with what the OS actually holds. Called on every launch, and after the
 * settings toggle is switched back on.
 *
 * Never prompts: a launch-time permission dialog the user didn't ask for is the wrong trade, and
 * the opt-in points already prompt.
 */
export async function syncSelfCheckReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await getRemindersEnabled())) return;

  const dueAt = await getSelfCheckReminderDueAt();
  if (!dueAt) return;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) {
    await cancelSelfCheckReminder();
    return;
  }
  // Past due means it already fired, or was missed while the app was uninstalled. Either way,
  // re-arming would deliver a reminder for a date that has gone by.
  if (due <= Date.now()) {
    await cancelSelfCheckReminder();
    return;
  }

  const id = await getMeta(STORAGE_KEYS.selfCheckReminderNotificationId);
  if (id) {
    const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    if (pending.some((n) => n.identifier === id)) return; // still armed, nothing to do
  }

  const status = await Notifications.getPermissionsAsync();
  if (!status.granted && status.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return; // permission was revoked — leave the intent stored, re-arm if it's granted again
  }
  const lesionId = (await getMeta(STORAGE_KEYS.selfCheckReminderLesionId)) || null;
  await setMeta(STORAGE_KEYS.selfCheckReminderNotificationId, await arm(new Date(due), lesionId));
}

/** What a tap on our reminder should open. `lesionId` is null for reminders saved before a lesion existed. */
export type ReminderTap = { lesionId: string | null };

function tapTarget(response: Notifications.NotificationResponse | null): ReminderTap | null {
  const data = response?.notification.request.content.data;
  if (!data || data.kind !== REMINDER_KIND) return null;
  return { lesionId: typeof data.lesionId === 'string' && data.lesionId ? data.lesionId : null };
}

let coldStart: Promise<ReminderTap | null> | undefined;

/**
 * The reminder tap that launched this process, if any — resolved once and memoized.
 *
 * The splash route awaits this because it owns the first navigation: pushing a lesion screen
 * before the splash has finished its `replace` would just be thrown away.
 */
export function consumeReminderColdStart(): Promise<ReminderTap | null> {
  coldStart ??= (async () => {
    if (Platform.OS === 'web') return null;
    const response = await Notifications.getLastNotificationResponseAsync().catch(() => null);
    if (!response) return null;
    // Clear it so the live listener registered in `initNotifications` doesn't replay this same tap.
    await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    return tapTarget(response);
  })();
  return coldStart;
}

let initialized = false;

/**
 * Install the foreground presentation handler, the Android channel, and the tap listener, then
 * reconcile the pending reminder. Called once from the root layout — guarded because a second
 * tap listener would navigate twice for one tap (Fast Refresh re-runs the effect in dev).
 */
export async function initNotifications(): Promise<void> {
  if (Platform.OS === 'web' || initialized) return;
  initialized = true;

  // Without this, a reminder arriving while the app is open is delivered silently to JS only.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await ensureChannel();
  // Take the cold-start tap before subscribing, so the listener below only ever sees live taps.
  await consumeReminderColdStart();

  Notifications.addNotificationResponseReceivedListener((response) => {
    const tap = tapTarget(response);
    if (tap?.lesionId) {
      router.push({ pathname: '/scan/lesion', params: { id: tap.lesionId } });
    }
  });

  await syncSelfCheckReminder();
}

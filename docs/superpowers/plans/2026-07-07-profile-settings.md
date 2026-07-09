# Profile & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Profile tab with stats/screening summary and add a new Settings screen (account & security, notifications, privacy & data, about & support), per `docs/superpowers/specs/2026-07-07-profile-settings-design.md`.

**Architecture:** New `profile/` stack route group (mirrors the existing `scan/` pattern) holding `edit.tsx`, `settings.tsx`, `terms.tsx`, `privacy.tsx`. Three new shared UI primitives (`Switch`, `SettingsRow`, `StubScreen`) and small additions to existing lib modules (`profile.ts`, `auth-api.ts`, `onboarding.ts`) plus two new lib modules (`settings-api.ts`, `notifications.ts`) and a shared `storage-keys.ts`.

**Tech Stack:** React Native (Expo Router), TypeScript, react-native-reanimated, expo-secure-store, expo-sqlite (via existing `data/db.ts`), no test framework present — verification is `npx tsc --noEmit` + manual app checks.

**Note on verification:** This repo has no Jest/Vitest setup (`package.json` has no `test` script for it, no test deps). Every task's "verify" step is `npx tsc --noEmit` (must pass with zero errors touching changed files) plus a manual behavior check. Do not add a test framework as part of this plan — out of scope.

---

## Task 1: Add `DELETE` support to the API client

**Files:**
- Modify: `src/api/client.ts:82-89`

- [ ] **Step 1: Add the `delete` method**

In `src/api/client.ts`, the exported `api` object currently ends with:

```ts
export const api = {
  get: <T>(path: string, params?: QueryParams, auth = false) =>
    request<T>("GET", path, { params, auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("POST", path, { body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("PATCH", path, { body, auth }),
};
```

Replace it with:

```ts
export const api = {
  get: <T>(path: string, params?: QueryParams, auth = false) =>
    request<T>("GET", path, { params, auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("POST", path, { body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("PATCH", path, { body, auth }),
  delete: <T>(path: string, body?: unknown, auth = true) =>
    request<T>("DELETE", path, { body, auth }),
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: add DELETE method to api client"
```

---

## Task 2: Centralize local storage keys

**Files:**
- Create: `src/lib/storage-keys.ts`
- Modify: `src/lib/onboarding.ts`

- [ ] **Step 1: Create `src/lib/storage-keys.ts`**

```ts
/** Keys used with `getMeta`/`setMeta` (the SQLite `sync_meta` key-value store). */
export const STORAGE_KEYS = {
  hasSeenOnboarding: 'has_seen_onboarding',
  reengagementRemindersEnabled: 'reengagement_reminders_enabled',
} as const;
```

- [ ] **Step 2: Update `src/lib/onboarding.ts` to use the shared key**

Current content:

```ts
import { getMeta, setMeta } from '@/data/db';

const ONBOARDING_KEY = 'has_seen_onboarding';

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await getMeta(ONBOARDING_KEY)) === '1';
}

export async function markOnboardingSeen(): Promise<void> {
  await setMeta(ONBOARDING_KEY, '1');
}

export async function resetOnboarding(): Promise<void> {
  await setMeta(ONBOARDING_KEY, '');
}
```

Replace with:

```ts
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
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. Onboarding flow behavior is unchanged (same key value `has_seen_onboarding`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage-keys.ts src/lib/onboarding.ts
git commit -m "refactor: centralize local storage keys in storage-keys.ts"
```

---

## Task 3: Notification preference storage

**Files:**
- Create: `src/lib/notifications.ts`

- [ ] **Step 1: Create `src/lib/notifications.ts`**

```ts
import { getMeta, setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';

/** Whether the user has opted into re-screening reminders. No native scheduling yet — this is purely a stored preference. */
export async function getRemindersEnabled(): Promise<boolean> {
  return (await getMeta(STORAGE_KEYS.reengagementRemindersEnabled)) === '1';
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await setMeta(STORAGE_KEYS.reengagementRemindersEnabled, enabled ? '1' : '');
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat: add local notification preference storage"
```

---

## Task 4: `clearAllLocalData` in `auth-api.ts`

**Files:**
- Modify: `src/lib/auth-api.ts:1-8` (imports), and after `clearCachedProfile` (currently ending around line 74)

- [ ] **Step 1: Add imports**

At the top of `src/lib/auth-api.ts`, change:

```ts
import * as SecureStore from 'expo-secure-store';

import { api, setAuthRefreshHandler, setAuthTokenProvider } from '@/api/client';
import type { UserProfile } from '@/api/types';
```

to:

```ts
import * as SecureStore from 'expo-secure-store';

import { api, setAuthRefreshHandler, setAuthTokenProvider } from '@/api/client';
import type { UserProfile } from '@/api/types';
import { setMeta } from '@/data/db';

import { STORAGE_KEYS } from './storage-keys';
```

- [ ] **Step 2: Add `clearAllLocalData` after `clearCachedProfile`**

Find this existing function:

```ts
export async function clearCachedProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(PROFILE_KEY);
}
```

Add immediately after it:

```ts
/**
 * Wipes every local trace of the current account: auth tokens, cached profile,
 * and app-scoped local preferences (onboarding-seen, notification prefs).
 * Called before `signOut()` when an account is deleted, so a fresh install/login
 * on the same device never inherits a deleted account's stray local flags.
 * Does NOT touch the directory sync cache (facilities/doctors) — that data isn't
 * user-specific.
 */
export async function clearAllLocalData(): Promise<void> {
  await clearTokens();
  await clearCachedProfile();
  await setMeta(STORAGE_KEYS.hasSeenOnboarding, '');
  await setMeta(STORAGE_KEYS.reengagementRemindersEnabled, '');
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth-api.ts
git commit -m "feat: add clearAllLocalData for account deletion"
```

---

## Task 5: Extend `saveProfile` to support more fields and report partial failures

**Files:**
- Modify: `src/lib/profile.ts` (entire file)

- [ ] **Step 1: Replace the full contents of `src/lib/profile.ts`**

Current content:

```ts
import { api } from '@/api/client';
import type { Sex, UserProfile } from '@/api/types';

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>('/me', undefined, true);
}

/** A profile counts as complete once a date of birth has been recorded. */
export function isProfileComplete(user: UserProfile): boolean {
  return user.date_of_birth != null;
}

export type ProfileInput = {
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
};

export async function saveProfile({ dateOfBirth, sex, phone }: ProfileInput): Promise<void> {
  // DOB + sex are accepted by the deployed API today.
  await api.patch('/me', { date_of_birth: dateOfBirth, sex });
  // `phone` requires the UserUpdate change to be redeployed; isolate so a 422
  // before redeploy doesn't fail the whole step.
  const trimmed = phone?.trim();
  if (trimmed) {
    try {
      await api.patch('/me', { phone: trimmed });
    } catch {
      // Backend not yet redeployed with the phone field — skip silently.
    }
  }
}

/**
 * Where an authenticated user should land: the profile step if incomplete, else
 * the app. Defaults to the app on network error so offline users aren't blocked.
 */
export async function routeAfterAuth(): Promise<'/(auth)/complete-profile' | '/home'> {
  try {
    const me = await fetchProfile();
    return isProfileComplete(me) ? '/home' : '/(auth)/complete-profile';
  } catch {
    return '/home';
  }
}
```

Replace the entire file with:

```ts
import { api } from '@/api/client';
import type { Sex, UserProfile } from '@/api/types';

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>('/me', undefined, true);
}

/** A profile counts as complete once a date of birth has been recorded. */
export function isProfileComplete(user: UserProfile): boolean {
  return user.date_of_birth != null;
}

export type ProfileInput = {
  fullName?: string;
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
  fitzpatrickSkinType?: number; // 1-6
};

export type SaveProfileResult = {
  /** Server-authoritative profile, re-fetched after all PATCH attempts — never assembled from local input. */
  user: UserProfile;
  /** Field names (matching the API's snake_case) that failed to save, if any. */
  failedFields: string[];
};

export async function saveProfile({
  fullName,
  dateOfBirth,
  sex,
  phone,
  fitzpatrickSkinType,
}: ProfileInput): Promise<SaveProfileResult> {
  const failedFields: string[] = [];

  // DOB + sex are accepted by the deployed API today.
  await api.patch('/me', { date_of_birth: dateOfBirth, sex });

  // Each of the following isolates its own PATCH so a 404/422 on one field
  // (e.g. before the backend redeploys with that field) doesn't fail the others.
  const trimmedName = fullName?.trim();
  if (trimmedName) {
    try {
      await api.patch('/me', { full_name: trimmedName });
    } catch {
      failedFields.push('full_name');
    }
  }

  const trimmedPhone = phone?.trim();
  if (trimmedPhone) {
    try {
      await api.patch('/me', { phone: trimmedPhone });
    } catch {
      failedFields.push('phone');
    }
  }

  if (fitzpatrickSkinType != null) {
    try {
      await api.patch('/me', { fitzpatrick_skin_type: fitzpatrickSkinType });
    } catch {
      failedFields.push('fitzpatrick_skin_type');
    }
  }

  const user = await fetchProfile();
  return { user, failedFields };
}

/**
 * Where an authenticated user should land: the profile step if incomplete, else
 * the app. Defaults to the app on network error so offline users aren't blocked.
 */
export async function routeAfterAuth(): Promise<'/(auth)/complete-profile' | '/home'> {
  try {
    const me = await fetchProfile();
    return isProfileComplete(me) ? '/home' : '/(auth)/complete-profile';
  } catch {
    return '/home';
  }
}
```

- [ ] **Step 2: Update the only existing call site — `src/app/(auth)/complete-profile.tsx`**

Find:

```ts
      await saveProfile({ dateOfBirth: dob, sex, phone: hasPhone ? undefined : phone });
      router.replace('/home');
```

Replace with:

```ts
      await saveProfile({ dateOfBirth: dob, sex, phone: hasPhone ? undefined : phone });
      router.replace('/home');
```

(No change needed here — `saveProfile`'s new return value is simply unused at this call site, which is valid TypeScript. Confirm this by reading `src/app/(auth)/complete-profile.tsx:43-55` and leaving it as-is.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. `complete-profile.tsx` still compiles since ignoring a promise's resolved value is valid.

- [ ] **Step 4: Commit**

```bash
git add src/lib/profile.ts
git commit -m "feat: extend saveProfile with name/skin-type and partial-failure reporting"
```

---

## Task 6: `settings-api.ts` — best-guess backend calls

**Files:**
- Create: `src/lib/settings-api.ts`

- [ ] **Step 1: Create `src/lib/settings-api.ts`**

```ts
import { api, ApiError } from '@/api/client';

/**
 * Best-guess endpoints for account/security and data actions. The backend may
 * not have these deployed yet — callers should use `isNotDeployed()` to show a
 * friendly "not available yet" message instead of a generic error on a 404.
 */

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export async function deleteAccount(): Promise<void> {
  await api.delete('/me');
}

export async function requestDataExport(): Promise<void> {
  await api.post('/me/export');
}

/** True when the failure means "this endpoint isn't deployed yet" rather than a real error. */
export function isNotDeployed(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-api.ts
git commit -m "feat: add settings-api for change-password/delete-account/data-export"
```

---

## Task 7: Icon additions for Settings

**Files:**
- Modify: `src/components/ui/icon.tsx:20-57`

- [ ] **Step 1: Add new `VECTOR_MAP` entries**

Find the end of the `VECTOR_MAP` object (just before its closing `};`):

```ts
  person: { set: 'ionicons', name: 'person-outline' },
  'person.fill': { set: 'ionicons', name: 'person' },
};
```

Replace with:

```ts
  person: { set: 'ionicons', name: 'person-outline' },
  'person.fill': { set: 'ionicons', name: 'person' },
  // settings / account
  'gearshape.fill': { set: 'ionicons', name: 'settings' },
  'bell.fill': { set: 'ionicons', name: 'notifications' },
  'lock.fill': { set: 'ionicons', name: 'lock-closed' },
  'key.fill': { set: 'ionicons', name: 'key' },
  'trash.fill': { set: 'ionicons', name: 'trash' },
  'shield.fill': { set: 'ionicons', name: 'shield' },
  'questionmark.circle.fill': { set: 'ionicons', name: 'help-circle' },
  'doc.text.fill': { set: 'ionicons', name: 'document-text' },
  'envelope.fill': { set: 'ionicons', name: 'mail' },
  'info.circle.fill': { set: 'ionicons', name: 'information-circle' },
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. (If any of the SF Symbol name literals above aren't in `expo-symbols`'s `SymbolViewProps['name']` union, `tsc` will report it on the line using that name in a later task — if so, check `node_modules/expo-symbols`'s type definitions for the nearest valid name and swap it in both this map and the call site.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/icon.tsx
git commit -m "feat: add settings-related icon mappings"
```

---

## Task 8: `Switch` component

**Files:**
- Create: `src/components/ui/switch.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create `src/components/ui/switch.tsx`**

```tsx
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

export type SwitchProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 4; // 2px inset each side

/**
 * On/off toggle matching the app's warm-sunset design language (not the OS-native
 * Switch look). Only the thumb's `translateX` is animated — that's native-driver
 * eligible. The track's background color is set directly from `value`, not
 * animated, since animating `backgroundColor` can't use the native driver.
 */
export function Switch({ value, onChange, disabled = false }: SwitchProps) {
  const theme = useTheme();
  const translateX = useSharedValue(value ? THUMB_TRAVEL : 0);

  useEffect(() => {
    translateX.value = withTiming(value ? THUMB_TRAVEL : 0, { duration: 160 });
  }, [value, translateX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      onPress={() => !disabled && onChange(!value)}
      hitSlop={8}
      disabled={disabled}
      style={[
        styles.track,
        { backgroundColor: value ? theme.brand : theme.hairline },
        disabled && styles.disabled,
      ]}>
      <Animated.View style={[styles.thumb, { backgroundColor: theme.surface }, thumbStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
  disabled: { opacity: 0.5 },
});
```

- [ ] **Step 2: Export it from `src/components/ui/index.ts`**

Find:

```ts
export { Segmented } from './segmented';
export { Select } from './select';
```

Replace with:

```ts
export { Segmented } from './segmented';
export { Select } from './select';
export { Switch } from './switch';
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/switch.tsx src/components/ui/index.ts
git commit -m "feat: add Switch component"
```

---

## Task 9: `DateField` — support a pre-filled `value`

**Files:**
- Modify: `src/components/ui/date-field.tsx`

The current `DateField` has no way to pre-populate an existing date, which `profile/edit.tsx` (Task 15) needs in order to show the user's already-saved date of birth. This is a small, backward-compatible addition — existing call sites (`complete-profile.tsx`) don't pass `value` and keep working identically.

- [ ] **Step 1: Add a `value` prop and an ISO-parsing helper**

Find:

```ts
export type DateFieldProps = {
  label?: string;
  error?: string;
  /** Called with an ISO "YYYY-MM-DD" string when a date is picked. */
  onChange: (iso: string | null) => void;
  containerStyle?: ViewStyle | ViewStyle[];
};
```

Replace with:

```ts
export type DateFieldProps = {
  label?: string;
  error?: string;
  /** Pre-fill with an existing ISO "YYYY-MM-DD" date (e.g. when editing a saved profile). */
  value?: string | null;
  /** Called with an ISO "YYYY-MM-DD" string when a date is picked. */
  onChange: (iso: string | null) => void;
  containerStyle?: ViewStyle | ViewStyle[];
};

function fromIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
```

- [ ] **Step 2: Initialize state from `value`**

Find:

```ts
export function DateField({ label, error, onChange, containerStyle }: DateFieldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState<Date | null>(null);
  const [temp, setTemp] = useState<Date>(DEFAULT_DATE);
  const [open, setOpen] = useState(false);
```

Replace with:

```ts
export function DateField({ label, error, value, onChange, containerStyle }: DateFieldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState<Date | null>(() => fromIso(value));
  const [temp, setTemp] = useState<Date>(() => fromIso(value) ?? DEFAULT_DATE);
  const [open, setOpen] = useState(false);
```

Everything else in the file (the `commit`, `openPicker`, and render logic) is unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

Manual check: in `complete-profile.tsx` (unchanged call site, no `value` passed), the field should still start on "Select date" exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/date-field.tsx
git commit -m "feat: support pre-filled value in DateField"
```

---

## Task 10: `SettingsRow` component

**Files:**
- Create: `src/components/ui/settings-row.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create `src/components/ui/settings-row.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';
import { IconCircle } from './icon-circle';
import { Switch } from './switch';

export type SettingsRowProps = {
  icon: IconName;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  /**
   * `'chevron'` (default) shows a nav arrow. `'switch'` renders a `Switch` wired
   * to `switchValue`/`onSwitchChange` and the row's own `onPress` is ignored (no
   * nested-touchable conflict). Any other `ReactNode` (including `null` for a
   * plain informational row) is rendered as-is — an interactive `ReactNode`
   * accessory is the caller's responsibility to keep out of the row's own
   * touch target.
   */
  accessory?: 'chevron' | 'switch' | ReactNode;
  switchValue?: boolean;
  onSwitchChange?: (next: boolean) => void;
  /** Renders the label and icon tint in the critical/danger color (e.g. "Delete account"). */
  destructive?: boolean;
};

export function SettingsRow({
  icon,
  label,
  sublabel,
  onPress,
  accessory = 'chevron',
  switchValue = false,
  onSwitchChange,
  destructive = false,
}: SettingsRowProps) {
  const theme = useTheme();

  let accessoryNode: ReactNode;
  if (accessory === 'chevron') {
    accessoryNode = <Icon name="chevron.right" tintColor={theme.muted} size={18} />;
  } else if (accessory === 'switch') {
    accessoryNode = <Switch value={switchValue} onChange={(next) => onSwitchChange?.(next)} />;
  } else {
    accessoryNode = accessory;
  }

  const isInteractive = accessory !== 'switch' && Boolean(onPress);

  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      accessibilityRole={isInteractive ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && isInteractive && styles.pressed]}>
      <IconCircle
        icon={icon}
        variant="tint"
        size={44}
        iconColor={destructive ? theme.riskCritical : undefined}
      />
      <View style={styles.text}>
        <ThemedText type="headline" themeColor={destructive ? 'riskCritical' : 'text'}>
          {label}
        </ThemedText>
        {sublabel ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {sublabel}
          </ThemedText>
        ) : null}
      </View>
      {accessoryNode}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    paddingVertical: Space.md,
  },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
});
```

- [ ] **Step 2: Export it from `src/components/ui/index.ts`**

Find:

```ts
export { Segmented } from './segmented';
export { Select } from './select';
export { Switch } from './switch';
```

Replace with:

```ts
export { Segmented } from './segmented';
export { Select } from './select';
export { SettingsRow } from './settings-row';
export { Switch } from './switch';
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/settings-row.tsx src/components/ui/index.ts
git commit -m "feat: add SettingsRow component"
```

---

## Task 11: `StubScreen` component

**Files:**
- Create: `src/components/ui/stub-screen.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create `src/components/ui/stub-screen.tsx`**

Mirrors the back-chevron header pattern from `src/app/scan/history.tsx:24-33,51-59` exactly, so terms/privacy screens are never a dead end.

```tsx
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';
import { Screen } from './screen';

export type StubScreenProps = {
  title: string;
  body?: string;
};

export function StubScreen({ title, body = 'This document is coming soon.' }: StubScreenProps) {
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          {title}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <ThemedText type="body" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.lg },
});
```

- [ ] **Step 2: Export it from `src/components/ui/index.ts`**

Find:

```ts
export { Segmented } from './segmented';
export { Select } from './select';
export { SettingsRow } from './settings-row';
export { Switch } from './switch';
```

Replace with:

```ts
export { Screen } from './screen';
export { Segmented } from './segmented';
export { Select } from './select';
export { SettingsRow } from './settings-row';
export { StubScreen } from './stub-screen';
export { Switch } from './switch';
```

Note: `Screen` is already exported earlier in the file (`export { Screen } from './screen';`) — this step is only adding the `StubScreen` line; do not create a duplicate `Screen` export. Add `export { StubScreen } from './stub-screen';` alphabetically after `Segmented`/`Select`/`SettingsRow` and before `Switch`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/stub-screen.tsx src/components/ui/index.ts
git commit -m "feat: add StubScreen component"
```

---

## Task 12: `profile/` route group scaffolding

**Files:**
- Create: `src/app/profile/_layout.tsx`
- Create: `src/app/profile/terms.tsx`
- Create: `src/app/profile/privacy.tsx`
- Modify: `src/app/_layout.tsx`

- [ ] **Step 1: Create `src/app/profile/_layout.tsx`**

Mirrors `src/app/scan/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="edit" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="privacy" />
    </Stack>
  );
}
```

- [ ] **Step 2: Create `src/app/profile/terms.tsx`**

```tsx
import { StubScreen } from '@/components/ui/stub-screen';

export default function TermsScreen() {
  return <StubScreen title="Terms of Service" />;
}
```

- [ ] **Step 3: Create `src/app/profile/privacy.tsx`**

```tsx
import { StubScreen } from '@/components/ui/stub-screen';

export default function PrivacyScreen() {
  return <StubScreen title="Privacy Policy" />;
}
```

- [ ] **Step 4: Register the `profile` stack in the root layout**

In `src/app/_layout.tsx`, find:

```tsx
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFF9F4' } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="scan" />
              </Stack>
```

Replace with:

```tsx
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFF9F4' } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="scan" />
                <Stack.Screen name="profile" />
              </Stack>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. (`edit.tsx` and `settings.tsx` don't exist yet — that's fine, `Stack.Screen name="edit"`/`"settings"` in `profile/_layout.tsx` don't require the files to exist at type-check time, only at runtime navigation, which Tasks 15/16 add next.)

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/_layout.tsx src/app/profile/terms.tsx src/app/profile/privacy.tsx src/app/_layout.tsx
git commit -m "feat: scaffold profile route group with terms/privacy stubs"
```

---

## Task 13: `profile/edit.tsx`

**Files:**
- Create: `src/app/profile/edit.tsx`

- [ ] **Step 1: Create `src/app/profile/edit.tsx`**

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import type { Sex } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { saveProfile } from '@/lib/profile';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const SKIN_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'Type I — always burns, never tans' },
  { value: '2', label: 'Type II — usually burns, tans minimally' },
  { value: '3', label: 'Type III — sometimes burns, tans uniformly' },
  { value: '4', label: 'Type IV — rarely burns, tans easily' },
  { value: '5', label: 'Type V — very rarely burns, tans easily' },
  { value: '6', label: 'Type VI — never burns' },
];

export default function EditProfileScreen() {
  const theme = useTheme();
  const { user, setUser } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [dob, setDob] = useState<string | null>(user?.date_of_birth ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex | null) ?? null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [skinType, setSkinType] = useState<string | null>(
    user?.fitzpatrick_skin_type != null ? String(user.fitzpatrick_skin_type) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ dob?: string; sex?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate() {
    const next: typeof errors = {};
    if (!dob) next.dob = 'Enter a valid date of birth.';
    if (!sex) next.sex = 'Please select one.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate() || !dob || !sex) return;
    setSubmitting(true);
    try {
      const { user: saved, failedFields } = await saveProfile({
        fullName,
        dateOfBirth: dob,
        sex,
        phone,
        fitzpatrickSkinType: skinType ? Number(skinType) : undefined,
      });
      setUser(saved);
      if (failedFields.length > 0) {
        Alert.alert('Profile saved', 'Profile saved, but some fields could not be updated.');
      }
      router.back();
    } catch {
      setFormError("Couldn't save your details. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable
              hitSlop={12}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back">
              <Icon name="chevron.left" tintColor={theme.brand} size={20} />
            </Pressable>
            <ThemedText type="title1">Edit profile</ThemedText>
          </View>

          <View style={styles.form}>
            <TextField label="Full name" placeholder="Your name" value={fullName} onChangeText={setFullName} />
            <DateField label="Date of birth" value={dob} onChange={setDob} error={errors.dob} />
            <Select
              label="Sex"
              placeholder="Select"
              value={sex}
              options={SEX_OPTIONS}
              onChange={setSex}
              error={errors.sex}
            />
            <TextField
              label="Phone number"
              placeholder="09xx xxx xxxx"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
            />
            <Select
              label="Skin type"
              placeholder="Select"
              value={skinType}
              options={SKIN_TYPE_OPTIONS}
              onChange={setSkinType}
            />
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button label="Save changes" variant="brand" loading={submitting} onPress={handleSubmit} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingTop: Space.lg, paddingBottom: Space.xl, gap: Space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  form: { gap: Space.xl },
  actions: { marginTop: 'auto', gap: Space.sm, paddingTop: Space.xl },
  center: { textAlign: 'center' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

Manual check: navigate Profile → Edit profile (this route isn't wired up from the UI until Task 17 — for now, verify by temporarily running `npx expo start`, then in the running app's URL bar / deep link, or just proceed to Task 17 first if you'd rather verify end-to-end at once). Confirm existing values (name, DOB, sex, phone, skin type) are pre-filled if the signed-in test account has them.

- [ ] **Step 3: Commit**

```bash
git add src/app/profile/edit.tsx
git commit -m "feat: add profile edit screen"
```

---

## Task 14: `profile/settings.tsx`

**Files:**
- Create: `src/app/profile/settings.tsx`

- [ ] **Step 1: Create `src/app/profile/settings.tsx`**

```tsx
import { ApiError } from '@/api/client';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/themed-text';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { clearAllLocalData } from '@/lib/auth-api';
import { getRemindersEnabled, setRemindersEnabled } from '@/lib/notifications';
import {
  changePassword,
  deleteAccount,
  isNotDeployed,
  requestDataExport,
} from '@/lib/settings-api';

const SUPPORT_EMAIL = 'help.spoton@gmail.com';

function formatConsentStatus(user: { consent_data_privacy: boolean; consent_at: string | null } | null): string {
  if (!user?.consent_data_privacy) return 'Not granted';
  if (!user.consent_at) return 'Granted';
  const d = new Date(user.consent_at);
  return `Granted on ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  // Notifications
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  useEffect(() => {
    getRemindersEnabled().then(setRemindersEnabledState);
  }, []);

  async function handleToggleReminders(next: boolean) {
    setRemindersEnabledState(next); // optimistic
    await setRemindersEnabled(next);
  }

  // Change password (inline form)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleChangePassword() {
    setPasswordError(null);
    if (!currentPassword || !newPassword) {
      setPasswordError('Enter both your current and new password.');
      return;
    }
    setPasswordSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setShowPasswordForm(false);
      Alert.alert('Password changed', 'Your password has been updated.');
    } catch (e) {
      setPasswordError(
        isNotDeployed(e)
          ? "This isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : "Couldn't change your password. Check your connection and try again.",
      );
    } finally {
      setPasswordSubmitting(false);
    }
  }

  // Delete account
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
      await clearAllLocalData();
      await signOut();
      router.replace('/(auth)/login');
    } catch (e) {
      Alert.alert(
        'Could not delete account',
        isNotDeployed(e)
          ? "This isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : 'Something went wrong. Please try again.',
      );
      setDeleting(false);
    }
  }

  // Data export
  const [exporting, setExporting] = useState(false);

  async function handleDataExport() {
    setExporting(true);
    try {
      await requestDataExport();
      Alert.alert('Export requested', "We'll email your data export within a few days.");
    } catch (e) {
      Alert.alert(
        'Could not request export',
        isNotDeployed(e)
          ? "Data export isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  const appVersion = Constants.expoConfig?.version ?? 'Unknown';

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Settings
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="subhead" themeColor="textSecondary" style={styles.sectionTitle}>
            Account & security
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="key.fill"
              label="Change password"
              onPress={() => setShowPasswordForm((s) => !s)}
            />
            {showPasswordForm ? (
              <View style={styles.passwordForm}>
                <TextField
                  label="Current password"
                  secure
                  textContentType="password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                />
                <TextField
                  label="New password"
                  secure
                  textContentType="newPassword"
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                {passwordError ? (
                  <ThemedText type="footnote" themeColor="riskCritical">
                    {passwordError}
                  </ThemedText>
                ) : null}
                <Button
                  label="Update password"
                  variant="outline"
                  loading={passwordSubmitting}
                  onPress={handleChangePassword}
                />
              </View>
            ) : null}
            <SettingsRow
              icon="trash.fill"
              label={deleting ? 'Deleting…' : 'Delete account'}
              destructive
              onPress={deleting ? undefined : () => setConfirmDeleteVisible(true)}
            />
          </Card>

          <ThemedText type="subhead" themeColor="textSecondary" style={styles.sectionTitle}>
            Notifications
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="bell.fill"
              label="Re-screening reminders"
              sublabel="Occasional reminders to check your skin"
              accessory="switch"
              switchValue={remindersEnabled}
              onSwitchChange={handleToggleReminders}
            />
          </Card>

          <ThemedText type="subhead" themeColor="textSecondary" style={styles.sectionTitle}>
            Privacy & data
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="shield.fill"
              label="Data privacy consent"
              sublabel={formatConsentStatus(user)}
              accessory={null}
            />
            <SettingsRow
              icon="doc.text.fill"
              label={exporting ? 'Requesting export…' : 'Request data export'}
              onPress={exporting ? undefined : handleDataExport}
            />
          </Card>

          <ThemedText type="subhead" themeColor="textSecondary" style={styles.sectionTitle}>
            About & support
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow icon="info.circle.fill" label="App version" sublabel={appVersion} accessory={null} />
            <SettingsRow
              icon="envelope.fill"
              label="Help & support"
              sublabel={SUPPORT_EMAIL}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            />
            <SettingsRow
              icon="doc.text.fill"
              label="Terms of Service"
              onPress={() => router.push('/profile/terms')}
            />
            <SettingsRow
              icon="lock.fill"
              label="Privacy Policy"
              onPress={() => router.push('/profile/privacy')}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={confirmDeleteVisible}
        title="Delete your account? This can't be undone."
        onClose={() => setConfirmDeleteVisible(false)}
        options={[
          {
            key: 'delete',
            label: 'Delete account',
            destructive: true,
            onPress: handleDeleteAccount,
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  content: { paddingHorizontal: Space.xl, paddingBottom: Space.xxl, gap: Space.sm },
  sectionTitle: { marginTop: Space.lg, marginBottom: Space.sm },
  section: { gap: 0 },
  passwordForm: { gap: Space.base, paddingVertical: Space.base },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/profile/settings.tsx
git commit -m "feat: add settings screen"
```

---

## Task 15: Wire up Profile tab

**Files:**
- Modify: `src/app/(tabs)/profile.tsx` (entire file)

- [ ] **Step 1: Replace the full contents of `src/app/(tabs)/profile.tsx`**

Current content (83 lines) keeps the identity card, "See body lesions" row, and sign-out button. Replace the whole file with:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useScanHistory } from '@/lib/scan-history';

const SEX_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  intersex: 'Intersex',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

const SKIN_TYPE_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  // Parse "YYYY-MM-DD" as a local date, not `new Date(dob)`'s UTC-midnight
  // parsing — the latter can roll the birth date back a day in timezones
  // behind UTC once read back via local getMonth()/getDate().
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function skinTypeLabel(type: number | null): string {
  if (type == null || type < 1 || type > 6) return '—';
  return `Type ${SKIN_TYPE_ROMAN[type - 1]}`;
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { entries } = useScanHistory();
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.full_name?.trim() || 'Your profile';
  const identifier = user?.email || user?.phone || '';

  const age = computeAge(user?.date_of_birth ?? null);
  const sexLabel = user?.sex ? (SEX_LABELS[user.sex] ?? user.sex) : null;
  const skinLabel = skinTypeLabel(user?.fitzpatrick_skin_type ?? null);
  const missingDetails = age == null || !sexLabel || user?.fitzpatrick_skin_type == null;

  const scanCount = entries.length;
  const lastScan = entries[0]?.createdAt;
  const lastScanLabel = lastScan
    ? new Date(lastScan).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace('/(auth)/login');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="largeTitle">Profile</ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Card style={styles.identity}>
          <IconCircle icon="person.fill" variant="gradient" size={60} />
          <View style={styles.identityText}>
            <ThemedText type="headline">{name}</ThemedText>
            {identifier ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {identifier}
              </ThemedText>
            ) : null}
          </View>
        </Card>

        <Card style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Age
              </ThemedText>
              <ThemedText type="headline">{age != null ? age : '—'}</ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.hairline }]} />
            <View style={styles.statItem}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Sex
              </ThemedText>
              <ThemedText type="headline">{sexLabel ?? '—'}</ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.hairline }]} />
            <View style={styles.statItem}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Skin type
              </ThemedText>
              <ThemedText type="headline">{skinLabel}</ThemedText>
            </View>
          </View>
          {missingDetails ? (
            <Pressable
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              style={styles.addDetails}>
              <ThemedText type="footnote" themeColor="brand">
                Add details
              </ThemedText>
              <Icon name="chevron.right" tintColor={theme.brand} size={14} />
            </Pressable>
          ) : null}
        </Card>

        <Card style={styles.row}>
          <IconCircle icon="sparkles" variant="tint" size={48} />
          <View style={styles.rowText}>
            <ThemedText type="headline">
              {scanCount === 0
                ? 'No screenings yet'
                : `${scanCount} ${scanCount === 1 ? 'screening' : 'screenings'} completed`}
            </ThemedText>
            {lastScanLabel ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Last screening {lastScanLabel}
              </ThemedText>
            ) : null}
          </View>
        </Card>

        <Pressable
          onPress={() => router.push('/scan/history')}
          accessibilityRole="button"
          style={({ pressed }) => pressed && styles.pressed}>
          <Card style={styles.row}>
            <IconCircle icon="figure.stand" variant="tint" size={48} />
            <View style={styles.rowText}>
              <ThemedText type="headline">See body lesions</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                View your screening history on the 3D body
              </ThemedText>
            </View>
            <Icon name="chevron.right" tintColor={theme.muted} size={18} />
          </Card>
        </Pressable>

        <Card style={styles.section}>
          <SettingsRow icon="person.fill" label="Edit profile" onPress={() => router.push('/profile/edit')} />
          <SettingsRow icon="gearshape.fill" label="Settings" onPress={() => router.push('/profile/settings')} />
        </Card>

        <View style={styles.actions}>
          <Button label="Sign out" variant="outline" loading={signingOut} onPress={handleSignOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.lg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: Space.base },
  identity: { marginTop: Space.xl, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  identityText: { flex: 1, gap: 2 },
  statsCard: { marginTop: Space.base },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', gap: Space.xs },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  addDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    marginTop: Space.base,
  },
  row: { marginTop: Space.base, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  rowText: { flex: 1, gap: 2 },
  section: { marginTop: Space.base, gap: 0 },
  pressed: { opacity: 0.7 },
  actions: { marginTop: Space.xl },
});
```

**Post-implementation correction:** manual verification on Android found that a `ScrollView(flex:1)` sharing flex space with a fixed sibling below it (the Sign Out button, originally placed outside the `ScrollView`) corrupted the layout of the last row inside the ScrollView's content — the second `SettingsRow` ("Settings") measured with inverted/negative bounds and was invisible despite existing correctly in the render tree (confirmed via `uiautomator dump`). The code above reflects the fix: Sign Out moved to be the last item *inside* the ScrollView's own content, matching the working pattern in `settings.tsx` (which has no such sibling).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/profile.tsx"
git commit -m "feat: add stats, screening summary, and settings entry to Profile tab"
```

---

## Task 16: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero errors (warnings pre-existing elsewhere in the repo are fine; don't introduce new ones in changed files).

- [ ] **Step 3: Run the app and exercise every new/changed screen**

Use the project's `run` skill (or `npm run android` / `npx expo start` per your existing dev workflow) and manually check:

1. **Profile tab** — identity card unchanged; stats card shows age/sex/skin type or "—" placeholders with an "Add details" link if any are missing; screening summary shows the seeded scan-history count/date; "See body lesions" still navigates to `/scan/history` as before; "Edit profile" and "Settings" rows navigate correctly.
2. **Edit profile** (`/profile/edit`) — fields pre-fill from the signed-in user; Save writes through, returns to Profile, and the identity/stats cards reflect the change immediately (no need to restart the app).
3. **Settings** (`/profile/settings`) — each section renders; "Re-screening reminders" toggle animates and persists (toggle it, background/reopen the app, confirm it stayed on); "Change password" expands the inline form without the keyboard covering the inputs on Android; "Delete account" shows the confirm sheet (do not actually delete during this check unless you have a disposable test account); "Request data export" and "Change password" show the expected "not available yet" message if the backend 404s; "Help & support" opens the device's mail client to `help.spoton@gmail.com`; Terms/Privacy rows push `StubScreen` and the back chevron returns to Settings.

- [ ] **Step 4: Final commit (only if the manual pass above required fixes)**

If Step 3 surfaced any bugs, fix them in the relevant file from Tasks 1–15, re-run `npx tsc --noEmit`, and commit:

```bash
git add -A
git commit -m "fix: address issues found in profile/settings manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `2026-07-07-profile-settings-design.md` (§1 SettingsRow/Switch/StubScreen, §2 Profile tab additions, §3 profile/ route group incl. edit/settings/terms/privacy, §4 lib changes incl. storage-keys/clearAllLocalData placement/isNotDeployed, §5 icon additions) has a corresponding task above.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable.
- **Type consistency:** `SaveProfileResult` (Task 5) is the exact shape consumed in `edit.tsx` (Task 13); `STORAGE_KEYS` keys (Task 2) match what `notifications.ts` (Task 3) and `clearAllLocalData` (Task 4) reference; `SettingsRow`'s `accessory`/`switchValue`/`onSwitchChange` props (Task 10) match every call site in `settings.tsx` (Task 14).

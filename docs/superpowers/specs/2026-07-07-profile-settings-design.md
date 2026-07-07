# Profile & Settings — Design

## Goal

Turn the current minimal Profile tab (identity card + "see body lesions" link + sign out)
into a fuller profile view, and add a new Settings screen reachable from it, covering
account/security, notifications, privacy/data, and about/support.

## Scope

- Enhance `(tabs)/profile.tsx`.
- Add a new `profile/` stack route group with `edit.tsx` and `settings.tsx`.
- Extend `lib/profile.ts` to save more fields.
- Add two small new lib modules for settings-related API calls and a local
  notification preference flag.
- Add three small new UI primitives: `SettingsRow`, `Switch`, and
  `StubScreen`.

Out of scope (explicitly deferred): actually scheduling local notifications
(no `expo-notifications` install/native rebuild in this pass), real Terms of
Service / Privacy Policy content (stubbed placeholder screens/links for now),
and building the backend endpoints this UI calls (see "Backend-dependent
actions" below — the frontend calls best-guess routes and degrades gracefully
if they 404).

## 1. New reusable UI components

### `SettingsRow` (`src/components/ui/settings-row.tsx`)

A single list-row primitive used for every entry in the Settings screen (and
the new rows on Profile), so all sections look consistent:

- Props: `icon: IconName`, `label: string`, `sublabel?: string`,
  `onPress?: () => void`, `accessory?: 'chevron' | 'switch' | ReactNode`,
  `switchValue?: boolean`, `onSwitchChange?: (next: boolean) => void`,
  `destructive?: boolean` (renders label/icon in `riskCritical` color, for
  "Delete account").
- `accessory: 'switch'` is handled internally (renders `Switch` wired to
  `switchValue`/`onSwitchChange`, and the row's own `onPress` is ignored so
  there's no nested-touchable conflict). A raw `ReactNode` accessory is the
  caller's responsibility — the row still forwards `onPress`, so an
  interactive `ReactNode` accessory must not itself be a `Pressable`.
- Renders inside a `Card`-like row (reuse existing `Card` + `IconCircle` +
  `ThemedText` + `Icon` pattern already used in `profile.tsx`'s
  "see body lesions" row) — no new visual language, just extracted into a
  reusable component since the same row shape repeats ~10+ times across
  Settings.

### `Switch` (`src/components/ui/switch.tsx`)

A simple on/off toggle matching the app's rounded, warm-sunset aesthetic
(brand-colored track when on, following the same color logic as `Checkbox`).

- Props: `value: boolean`, `onChange: (next: boolean) => void`,
  `disabled?: boolean`.
- Built with `Pressable` + `Animated` (reanimated, already a dependency), not
  the RN core `Switch` (keeps visual consistency with the rest of the design
  system instead of the OS-native switch look).
- Only the thumb's `translateX` is animated (native driver eligible). The
  track's background color is toggled directly via state/style, not
  animated — animating `backgroundColor` can't use the native driver and
  would run the transition on the JS thread.

### `StubScreen` (`src/components/ui/stub-screen.tsx`)

Placeholder content screen with a working back-chevron header (see §3's
"About & support" for its two call sites). Props: `title: string`,
`body?: string` (defaults to "This document is coming soon."). Reuses the
`Screen` + header pattern already established in `scan/history.tsx` so
navigating into a stub never traps the user without a way back.

## 2. Profile tab (`(tabs)/profile.tsx`)

Kept: identity card, "See body lesions" row, sign-out button — unchanged.

Added, top to bottom after the identity card:

1. **Stats card** — a `Card` with three compact fields: age (computed from
   `user.date_of_birth`), sex (`user.sex`), skin type
   (`user.fitzpatrick_skin_type`, labeled "Type I"–"Type VI"). Any missing
   field shows "—" and the card footer shows "Add details" (only when at
   least one field is missing) linking to `/profile/edit`.
2. **Screening summary card** — a `Card` showing scan count and last-scan
   date, sourced from `useScanHistory().entries` (count = `entries.length`,
   last date = `entries[0]?.createdAt` formatted, since entries are
   newest-first per `scan-history.tsx`). If `entries.length === 0`, shows
   "No screenings yet."
3. **"Edit profile"** `SettingsRow` → `router.push('/profile/edit')`.
4. **"Settings"** `SettingsRow` (gear icon) → `router.push('/profile/settings')`.

## 3. New route group `src/app/profile/`

Mirrors the existing `scan/` stack pattern. (There is no `+not-found` route
in this app today, so registration order in the root `Stack` isn't a
concern — but the new `<Stack.Screen name="profile" />` entry should still
be added alongside the other named screens, not appended after anything
that might act as a catch-all in the future.)

### `_layout.tsx`

```tsx
<Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
  <Stack.Screen name="edit" />
  <Stack.Screen name="settings" />
</Stack>
```

Registered as a new `<Stack.Screen name="profile" />` entry in the root
`src/app/_layout.tsx`, alongside the existing `scan` entry.

### `edit.tsx`

Same shape as `(auth)/complete-profile.tsx` (reuses `DateField`, `Select`,
`TextField`, `Screen variant="gradient" gradient="dawnSoft"`), pre-filled
from `user`:

- Full name (`TextField`, maps to `user.full_name`) — new field, not
  currently editable anywhere.
- Date of birth (`DateField`, pre-filled).
- Sex (`Select`, pre-filled).
- Phone (`TextField`) — editable here even if it was set at signup (unlike
  `complete-profile.tsx`, which only shows it when absent).
- Skin type (new `Select`, options "Type I" through "Type VI" mapped to
  `fitzpatrick_skin_type` 1–6, with a short one-line explainer per type
  pulled from the standard Fitzpatrick scale).

On submit: calls the extended `saveProfile()`. `saveProfile()` returns the
authoritative post-save profile (re-fetched from `GET /me`, not assembled
from the local form values — the backend is the source of truth for what
actually persisted). `edit.tsx` calls `setUser()` with that server response,
then `router.back()`. If one or more of the isolated field PATCHes failed
(see §4), `router.back()` is still called, but an alert/toast is shown
first: "Profile saved, but some fields could not be updated" (see §4 for
which fields are tracked).

### `settings.tsx`

Four `ThemedText type="headline"` section headers, each with a stack of
`SettingsRow`s inside a `Card`:

**Account & security**
- "Change password" → navigates to a small inline form (same screen, a
  `Select`-free simple two-field password form shown via local state
  toggle — avoids a 5th new route for one form) calling
  `changePassword(currentPassword, newPassword)`. This inline section is
  wrapped in `KeyboardAvoidingView` (`behavior="padding"` on iOS, as done in
  `complete-profile.tsx`) so the keyboard doesn't obscure the inputs on
  Android when the settings list is scrolled.
- "Delete account" (`destructive`) → confirmation `ActionSheet` (existing
  `action-sheet.tsx` component), then calls `deleteAccount()`, then
  `clearAllLocalData()` (new — see §4), then `signOut()` +
  `router.replace('/(auth)/login')`. Both "Delete account" and "Request
  data export" (below) track their own in-flight state and disable
  themselves (and show a spinner, matching the existing `Button loading`
  prop convention) while their request is pending, to prevent a double-tap
  firing the action twice.

**Notifications**
- "Re-screening reminders" `SettingsRow` with a `Switch` accessory, backed
  by `getNotificationPref()`/`setNotificationPref()` in the new
  `lib/notifications.ts` (same `getMeta`/`setMeta` mechanism as
  `lib/onboarding.ts`). No native scheduling — purely a stored preference
  for now.

**Privacy & data**
- Read-only row showing consent status: "Data privacy consent" with
  sublabel "Granted on {consent_at date}" or "Not granted" if
  `consent_data_privacy` is false.
- "Request data export" → calls `requestDataExport()`, shows a success
  toast/alert ("We'll email your data export within a few days.") on
  success. On failure, a 404 specifically (endpoint not deployed yet) is
  caught and shown as "Data export isn't available yet — check back soon,"
  distinct from other errors (network/5xx), which show the generic
  "Something went wrong, please try again."

**About & support**
- App version row (read-only), from `Constants.expoConfig?.version ?? 'Unknown'`
  (`expo-constants`) — falls back since this can be `undefined` at runtime
  in some build configurations.
- "Help & support" → opens `mailto:help.spoton@gmail.com` via
  `Linking.openURL`.
- "Terms of Service" / "Privacy Policy" → each pushes a stub screen
  (`profile/terms.tsx`, `profile/privacy.tsx`) — kept as real routes so the
  nav wiring doesn't need to change later, just the content. Both render a
  shared `StubScreen` component (`src/components/ui/stub-screen.tsx`),
  parametrized by `title: string` (and default body copy "This document is
  coming soon."), rather than duplicating placeholder markup twice.
  `StubScreen` includes the same back-chevron header used elsewhere
  (`scan/history.tsx`'s pattern: `Pressable` + `chevron.left` calling
  `router.back()`, centered `ThemedText` title) so these screens are never
  a dead end — each file is then just:
  `<StubScreen title="Terms of Service" />` /
  `<StubScreen title="Privacy Policy" />`.

## 4. Data layer changes

### `lib/profile.ts`

Extend `ProfileInput`:

```ts
export type ProfileInput = {
  fullName?: string;
  dateOfBirth: string;
  sex: Sex;
  phone?: string;
  fitzpatrickSkinType?: number;
};
```

`saveProfile()` sends `date_of_birth` + `sex` in the primary PATCH (as
today), then isolates `full_name`, `phone`, and `fitzpatrick_skin_type` each
in their own try/catch-guarded PATCH — following the existing comment/pattern
for `phone` ("requires the UserUpdate change to be redeployed; isolate so a
422 before redeploy doesn't fail the whole step"), so a partially-deployed
backend degrades field-by-field instead of failing the whole save.

Unlike the current `phone`-only version, failures are no longer swallowed
silently: `saveProfile()` collects which of the isolated fields failed
(e.g. `['full_name', 'fitzpatrick_skin_type']`) and returns
`{ user: UserProfile; failedFields: string[] }`, where `user` is a fresh
`GET /me` response taken after all PATCH attempts (server-authoritative,
not assembled from the input). `edit.tsx` uses `user` for `setUser()` and
`failedFields` to decide whether to show the "some fields could not be
updated" warning.

### `lib/settings-api.ts` (new)

```ts
export function changePassword(currentPassword: string, newPassword: string): Promise<void>
export function deleteAccount(): Promise<void>
export function requestDataExport(): Promise<void>
```

Calling, respectively, best-guess routes `POST /auth/change-password`,
`DELETE /me`, `POST /me/export` through the existing `api` client. Each
throws a normal `ApiError`/network error on failure — the UI is responsible
for showing a friendly message (not silently swallowed, unlike the
`saveProfile` phone case, since these are explicit user-initiated actions
that need visible success/failure feedback).

Also exports `clearAllLocalData()`, called by `settings.tsx` right after a
successful `deleteAccount()` and before `signOut()`. This app has no
AsyncStorage usage — local state lives in `expo-secure-store` (auth tokens
+ cached profile, via `lib/auth-api.ts`) and the SQLite `meta`/`facilities`/
`doctors` tables (via `lib/data/db.ts`). `clearAllLocalData()` calls the
existing `clearTokens()` + `clearCachedProfile()` (already in
`auth-api.ts`) and clears the `meta` table's app-scoped keys (onboarding-seen,
notification preference — see `lib/storage-keys.ts` below), so a fresh
install/login on the same device never inherits a deleted account's stray
local flags.

### `lib/storage-keys.ts` (new)

Centralizes the local key-value keys used across `getMeta`/`setMeta`
(SQLite `meta` table), so `lib/onboarding.ts` and the new
`lib/notifications.ts` don't each hardcode their own string literal (a
silent-typo risk when two files independently pick keys):

```ts
export const STORAGE_KEYS = {
  hasSeenOnboarding: 'has_seen_onboarding',
  reengagementRemindersEnabled: 'reengagement_reminders_enabled',
} as const;
```

`lib/onboarding.ts` is updated to import `STORAGE_KEYS.hasSeenOnboarding`
instead of its current local `ONBOARDING_KEY` constant.

### `lib/notifications.ts` (new)

Mirrors `lib/onboarding.ts`, using the shared key from `storage-keys.ts`:

```ts
import { STORAGE_KEYS } from './storage-keys';
export function getRemindersEnabled(): Promise<boolean>
export function setRemindersEnabled(enabled: boolean): Promise<void>
```

## 5. Icon additions

New SF Symbol names introduced need entries in `VECTOR_MAP`
(`components/ui/icon.tsx`) for Android/web fallback:
`gearshape.fill`, `bell.fill`, `lock.fill`, `key.fill`, `trash.fill`,
`shield.fill`, `questionmark.circle.fill`, `doc.text.fill`,
`envelope.fill`, `info.circle.fill`.

## Testing

No existing test suite in this repo (verified: no `__tests__`/`*.test.*`
files under `src/`). Verification will be manual: run the app, exercise
each new screen and action (edit profile save, settings toggle persists
across app restart, sign-out/delete-account confirmation flow, mailto
link), per the project's `verify` skill.

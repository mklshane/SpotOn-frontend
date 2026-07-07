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
- Add two small new UI primitives: `SettingsRow` and `Switch`.

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
  `onPress?: () => void`, `accessory?: 'chevron' | ReactNode`,
  `destructive?: boolean` (renders label/icon in `riskCritical` color, for
  "Delete account").
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

Mirrors the existing `scan/` stack pattern.

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

On submit: calls the extended `saveProfile()`, then `setUser()` (from
`useAuth()`) with the merged result so the Profile tab reflects changes
immediately, then `router.back()`.

### `settings.tsx`

Four `ThemedText type="headline"` section headers, each with a stack of
`SettingsRow`s inside a `Card`:

**Account & security**
- "Change password" → navigates to a small inline form (same screen, a
  `Select`-free simple two-field password form shown via local state
  toggle — avoids a 5th new route for one form) calling
  `changePassword(currentPassword, newPassword)`.
- "Delete account" (`destructive`) → confirmation `ActionSheet` (existing
  `action-sheet.tsx` component), then calls `deleteAccount()`, then
  `signOut()` + `router.replace('/(auth)/login')`.

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
  toast/alert ("We'll email your data export within a few days.") or a
  friendly failure message if the endpoint isn't available yet.

**About & support**
- App version row (read-only), from `Constants.expoConfig?.version`
  (`expo-constants`).
- "Help & support" → opens `mailto:help.spoton@gmail.com` via
  `Linking.openURL`.
- "Terms of Service" / "Privacy Policy" → each pushes a stub screen
  (`profile/terms.tsx`, `profile/privacy.tsx`) with placeholder body text
  ("This document is coming soon.") — kept as real routes so the nav
  wiring doesn't need to change later, just the content.

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

### `lib/notifications.ts` (new)

Mirrors `lib/onboarding.ts` exactly:

```ts
const REMINDERS_KEY = 'reengagement_reminders_enabled';
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

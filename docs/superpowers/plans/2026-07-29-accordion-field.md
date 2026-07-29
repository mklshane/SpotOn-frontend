# Accordion Field (Sex / Skin Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlay-dropdown `Select` component used for "Sex" and "Skin type" with a true expand-in-place `Accordion` component, reusing the existing `SelectCard` primitive for the expanded rows.

**Architecture:** A new `src/components/ui/accordion.tsx` renders a collapsed trigger (same look as today's `Select` trigger) plus an in-flow (not overlaid) animated options list built from `SelectCard`s. The three call sites (`Sex` in two screens, `Skin type` in one) switch from `Select` to `Accordion`; skin type's options gain a `description` field for two-line rows. `select.tsx` is then deleted since nothing else uses it.

**Tech Stack:** React Native, TypeScript, Reanimated (already a dependency, used the same way in `button.tsx`/`select-card.tsx`), existing `theme.ts` tokens, existing `SelectCard`/`ThemedText`/`Icon` primitives. No new dependencies. No test runner is configured in this project — verification is `npx tsc --noEmit` after each code change, plus manual emulator testing in the final task.

**Reference:** `docs/superpowers/specs/2026-07-29-accordion-field-design.md`

---

### Task 1: `Accordion` component

**Files:**
- Create: `src/components/ui/accordion.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Write the complete `accordion.tsx` file**

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';
import { SelectCard } from './select-card';

export type AccordionOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

export type AccordionProps<T extends string> = {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: AccordionOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  containerStyle?: ViewStyle | ViewStyle[];
};

/** Per-option height budget for the open-state cap: SelectCard's ~64px min-height
 *  plus its Space.sm gap, rounded up to comfortably fit a two-line title+description
 *  row without clipping. */
const ROW_HEIGHT = 80;

export function Accordion<T extends string>({
  label,
  placeholder = 'Select',
  value,
  options,
  onChange,
  error,
  containerStyle,
}: AccordionProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);

  const selected = options.find((o) => o.value === value);
  const borderColor = error ? theme.riskCritical : open ? theme.brand : 'transparent';
  const maxHeight = options.length * ROW_HEIGHT + Space.base;

  function setOpenAnimated(next: boolean) {
    setOpen(next);
    progress.value = withTiming(next ? 1 : 0, { duration: 250 });
  }

  const animatedStyle = useAnimatedStyle(() => ({
    maxHeight: progress.value * maxHeight,
    opacity: progress.value,
  }));

  return (
    <View style={containerStyle}>
      {label ? (
        <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => setOpenAnimated(!open)}
        style={[styles.field, { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 }]}>
        <ThemedText type="body" themeColor={selected ? 'text' : 'muted'}>
          {selected ? selected.label : placeholder}
        </ThemedText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} tintColor={theme.muted} size={16} />
      </Pressable>

      <Animated.View style={[styles.options, animatedStyle]}>
        {options.map((option) => (
          <SelectCard
            key={option.value}
            title={option.label}
            subtitle={option.description}
            selected={option.value === value}
            onPress={() => {
              onChange(option.value);
              setOpenAnimated(false);
            }}
            style={styles.card}
          />
        ))}
      </Animated.View>

      {error ? (
        <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: Space.sm },
  field: {
    height: 54,
    borderRadius: Radius.md,
    paddingHorizontal: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  options: { overflow: 'hidden' },
  card: { marginTop: Space.sm },
  error: { marginTop: Space.xs },
});
```

- [ ] **Step 2: Export it from the UI barrel**

In `src/components/ui/index.ts`, add the export alphabetically as the first line (before `Button`):

```ts
export { Accordion } from './accordion';
export { Button } from './button';
```

(Leave the existing `export { Select } from './select';` line in place for now — Task 3 removes it, after Task 2 has migrated every caller off of it.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `accordion.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/accordion.tsx src/components/ui/index.ts
git commit -m "feat(ui): add Accordion primitive"
```

---

### Task 2: Wire `Accordion` into the Sex and Skin type fields

**Files:**
- Modify: `src/app/profile/edit.tsx`
- Modify: `src/app/(auth)/complete-profile.tsx`

- [ ] **Step 1: Update `src/app/profile/edit.tsx`**

Replace the `Select` import and the `SKIN_TYPE_OPTIONS` constant, and swap both `<Select ...>` usages for `<Accordion ...>`. Full resulting file:

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
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
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

const SKIN_TYPE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: '1', label: 'Type I', description: 'Always burns, never tans' },
  { value: '2', label: 'Type II', description: 'Usually burns, tans minimally' },
  { value: '3', label: 'Type III', description: 'Sometimes burns, tans uniformly' },
  { value: '4', label: 'Type IV', description: 'Rarely burns, tans easily' },
  { value: '5', label: 'Type V', description: 'Very rarely burns, tans easily' },
  { value: '6', label: 'Type VI', description: 'Never burns' },
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
  const [errors, setErrors] = useState<{ dob?: string; sex?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate() {
    const next: typeof errors = {};
    if (!dob) next.dob = 'Enter a valid date of birth.';
    if (!sex) next.sex = 'Please select one.';
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^(\+63|0)9\d{9}$/.test(trimmedPhone)) {
      next.phone = 'Enter a valid PH mobile number (e.g. 09xx xxx xxxx).';
    }
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
            <Accordion
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
              error={errors.phone}
            />
            <Accordion
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

- [ ] **Step 2: Update `src/app/(auth)/complete-profile.tsx`**

Full resulting file (only the import and the `Sex` field's tag change):

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import type { Sex } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { saveProfile } from '@/lib/profile';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export default function CompleteProfileScreen() {
  const { user } = useAuth();
  // Already captured at sign-up if they registered by phone — don't ask again.
  const hasPhone = Boolean(user?.phone);
  const [dob, setDob] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [phone, setPhone] = useState('');
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
      await saveProfile({ dateOfBirth: dob, sex, phone: hasPhone ? undefined : phone });
      router.replace('/home');
    } catch {
      setFormError("Couldn't save your details. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen variant="gradient" gradient="dawnSoft">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title1">Tell us about you</ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              A few details to personalize your screening. This stays private to you.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <DateField label="Date of birth" onChange={setDob} error={errors.dob} />

            <Accordion
              label="Sex"
              placeholder="Select"
              value={sex}
              options={SEX_OPTIONS}
              onChange={setSex}
              error={errors.sex}
            />

            {hasPhone ? null : (
              <TextField
                label="Phone number (optional)"
                placeholder="09xx xxx xxxx"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                value={phone}
                onChangeText={setPhone}
              />
            )}
          </View>

          <View style={styles.actions}>
            {formError ? (
              <ThemedText type="footnote" themeColor="riskCritical" style={styles.center}>
                {formError}
              </ThemedText>
            ) : null}
            <Button label="Continue" variant="brand" loading={submitting} onPress={handleSubmit} />
            <Button
              label="Skip for now"
              variant="ghost"
              onPress={() => router.replace('/home')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingTop: Space.xxl, paddingBottom: Space.xl, gap: Space.xxl },
  header: { gap: Space.md },
  form: { gap: Space.xl },
  actions: { marginTop: 'auto', gap: Space.sm },
  center: { textAlign: 'center' },
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in either file. (`Select` is still exported/present at this point — Task 3
removes it — so this step just confirms nothing outside these two files broke.)

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/edit.tsx "src/app/(auth)/complete-profile.tsx"
git commit -m "refactor(profile): use Accordion for Sex and Skin type fields"
```

---

### Task 3: Remove the now-unused `Select` component

**Files:**
- Delete: `src/components/ui/select.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Confirm nothing still imports it**

Run: `grep -rn "components/ui/select'" src/` (or equivalent search)
Expected: no matches (Task 2 already migrated the only three usages).

- [ ] **Step 2: Delete the file**

Delete `src/components/ui/select.tsx`.

- [ ] **Step 3: Remove its barrel export**

In `src/components/ui/index.ts`, delete this line:

```ts
export { Select } from './select';
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — confirms nothing still references `Select` or `./select`.

- [ ] **Step 5: Commit**

```bash
git add -u src/components/ui/select.tsx src/components/ui/index.ts
git commit -m "chore: remove unused Select component (replaced by Accordion)"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Reload the app**

This task only changed JS (no native dependency changes), so a Metro reload is enough — no
native rebuild needed. Use the `run` skill, or just reload (`r` in the Metro terminal, or
shake/`Ctrl+M` → Reload in the emulator).

- [ ] **Step 2: Walk through the checklist from the design spec**

On `profile/edit.tsx`:
- Tap "Sex" — it expands in place (pushes "Phone number" and "Skin type" down, doesn't overlay
  them). Options show as brand-tint/checkmark cards when selected.
- Pick a Sex option — it selects, closes the accordion, and the following fields settle back up.
- Tap "Skin type" — expands showing all 6 options as two-line cards (bold "Type I" etc. +
  muted description below). Scrolls naturally with the rest of the form, nothing clipped.
- Pick a skin type option — selects and closes.
- Clear "Sex", tap "Save changes" — error state shows: red border on the Sex trigger, error
  message below it (same as before).

On `(auth)/complete-profile.tsx`:
- Tap "Sex" — same expand-in-place behavior, pushes phone number field (if shown) down.
- Leave it unset and tap "Continue" — same error-state check as above.

- [ ] **Step 3: Report results**

Note any visual or interaction issues found during the walkthrough for follow-up — this task
doesn't have automated pass/fail, so explicitly confirm each bullet above worked before
considering the plan complete.

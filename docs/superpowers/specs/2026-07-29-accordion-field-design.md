# Accordion Field (Sex / Skin Type) — Design

## Goal

The "Sex" field (`profile/edit.tsx`, `(auth)/complete-profile.tsx`) and "Skin type" field
(`profile/edit.tsx`) both use `src/components/ui/select.tsx` — a collapsed trigger that expands
into an absolutely-positioned overlay menu. It's functional but generic (plain white menu, thin
border, basic checkmark) and doesn't behave like an accordion: the overlay floats on top of
whatever's below it instead of pushing it down, and skin type's long descriptive labels
("Type I — always burns, never tans") are cramped into a single line.

This replaces it with a true expand-in-place accordion, reusing the existing `SelectCard`
primitive (already used elsewhere, already on-theme: brand-tint fill + checkmark when selected,
soft shadow, spring press animation, optional title+subtitle) for the expanded rows.

## Scope

- Add `src/components/ui/accordion.tsx` (new `Accordion` component) and export it from
  `src/components/ui/index.ts`.
- Remove `src/components/ui/select.tsx` and its `index.ts` export — nothing else uses it (only
  the two Sex usages and the one Skin type usage, confirmed by grepping the codebase).
- Update `src/app/profile/edit.tsx` (Sex + Skin type) and `src/app/(auth)/complete-profile.tsx`
  (Sex) to import `Accordion` instead of `Select`. Skin type's option list gains a `description`
  per option (the part of today's label after the em dash).

Out of scope: changing `DateField`/`TextField`/any other field; changing the trigger's visual
design (it already matches the rest of the form and isn't part of the complaint); building a
"only one open at a time" accordion-group behavior (Sex and Skin type are unrelated fields, each
manages its own open/closed state).

## 1. `Accordion` component

`src/components/ui/accordion.tsx`. Same external contract as today's `Select`, plus an optional
per-option `description`:

```ts
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
```

### Collapsed trigger

Unchanged in appearance from today's `Select` trigger: a `Pressable` field (`elementBg` fill,
`Radius.md`, height 54), showing the selected option's `label` or the `placeholder` in muted
text, with a `chevron.down`/`chevron.up` `Icon` that swaps based on open state (same convention
used elsewhere in the codebase, e.g. `directory/ClinicPreviewCard.tsx` — no new rotation-animation
mechanism needed). Border is `theme.brand` while open, `theme.riskCritical` when `error` is set,
`transparent` otherwise — same logic as today.

### Expanded body

Renders **in-flow** (normal, relatively-positioned `View`, not `position: 'absolute'`) directly
below the trigger, so opening it pushes any following form fields down instead of overlaying
them. Contains one `SelectCard` per option, stacked with `Space.sm` gaps:

```tsx
<SelectCard
  title={option.label}
  subtitle={option.description}
  selected={option.value === value}
  onPress={() => {
    onChange(option.value);
    setOpen(false);
  }}
/>
```

Tapping any option selects it and closes the accordion (same as today's dropdown-closes-on-select
behavior).

### Animation

A Reanimated shared value (`progress`, 0 → 1) driven by `withTiming` (~250ms) on toggle. The
options wrapper is `overflow: 'hidden'` with an animated style interpolating:

- `maxHeight`: `0` → a generous cap computed as `options.length * 80 + Space.base` (each
  `SelectCard` is `minHeight: 64` + `Space.sm` gap ≈ 72, rounded up to 80 per row for safety,
  plus top padding before the first card). This scales automatically with however many options a
  caller passes — no hardcoded constant tied to a specific field's option count.
- `opacity`: `0` → `1`, so the reveal cross-fades rather than just clipping.

No `onLayout`/measured-height logic needed — the `maxHeight` cap only has to exceed the actual
content height (verified generous for both Sex's 5 options and Skin type's 6), and
`overflow: hidden` clips it correctly while collapsed.

## 2. Call site updates

Both `src/app/profile/edit.tsx` and `src/app/(auth)/complete-profile.tsx` swap their
`import { Select } from '@/components/ui/select'` for
`import { Accordion } from '@/components/ui/accordion'` and rename the JSX tag — props passed
are unchanged except:

- `profile/edit.tsx`'s `SKIN_TYPE_OPTIONS` gains a `description` per entry (splitting today's
  single label at the em dash):

```ts
const SKIN_TYPE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: '1', label: 'Type I', description: 'Always burns, never tans' },
  { value: '2', label: 'Type II', description: 'Usually burns, tans minimally' },
  { value: '3', label: 'Type III', description: 'Sometimes burns, tans uniformly' },
  { value: '4', label: 'Type IV', description: 'Rarely burns, tans easily' },
  { value: '5', label: 'Type V', description: 'Very rarely burns, tans easily' },
  { value: '6', label: 'Type VI', description: 'Never burns' },
];
```

- `SEX_OPTIONS` (in both files) is unchanged — no `description`, so those render as simple
  single-line `SelectCard`s (no subtitle).

## 3. Cleanup

`src/components/ui/select.tsx` is deleted and its `index.ts` export removed, since nothing else
in the codebase imports it (confirmed: only the three usages listed above).

## 4. Verification

No test runner is configured in this project (same as the calendar picker work). Verify manually
by running the app in the emulator (via the `run` skill) and exercising:

- Sex accordion on both `profile/edit.tsx` and `(auth)/complete-profile.tsx`: opens in place
  (pushes content below it down, not overlaid), picking an option selects + closes it, selected
  option shows brand-tint + checkmark, error state (leaving it unset and submitting) shows the
  red border + message.
- Skin type accordion on `profile/edit.tsx`: opens showing all 6 options with two-line
  title+description rows, scrolls naturally within the screen's existing `ScrollView` (no clipped
  content), selecting an option works the same way.
- Confirm the open/close animation is smooth (no flash of unclipped content, no jump).

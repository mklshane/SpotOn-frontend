# Custom Calendar Picker — Design

## Goal

`DateField` (`src/components/ui/date-field.tsx`) currently delegates its calendar UI to the
native `@react-native-community/datetimepicker` widget: an OS dialog on Android and an inline
native picker inside a themed bottom sheet on iOS. Neither can be laid out or styled to match
the SpotOn sunset theme beyond accent-color tweaks. This replaces both with one fully
custom-built calendar component so the picker looks and feels like the rest of the app on both
platforms.

## Scope

- Add `src/components/ui/calendar-picker.tsx` — a pure, controlled calendar primitive.
- Rewrite `src/components/ui/date-field.tsx` to use it via a single cross-platform bottom sheet,
  removing the `Platform.OS` fork entirely.
- Remove the `@react-native-community/datetimepicker` dependency and its `app.json` plugin
  entry (nothing else in the codebase uses it), then re-run `expo prebuild`.
- The `withAndroidAccentColor` plugin (added separately) stays — it still benefits other native
  Android widgets.

Out of scope: changing `DateField`'s public props/API (`label`, `error`, `value`, `onChange`,
`containerStyle` stay the same, so `profile/edit.tsx` and `(auth)/complete-profile.tsx` need no
changes), automated tests (no test runner is configured in this project — verification is manual
in the emulator).

## 1. `CalendarPicker` component

`src/components/ui/calendar-picker.tsx`. Fully controlled, presentational only — owns no
"selected date" concept beyond what it's given.

Props:

```ts
type CalendarPickerProps = {
  value: Date;
  minDate: Date;
  maxDate: Date;
  onChange: (date: Date) => void;
};
```

Internal state:

- `cursor: Date` — the year/month currently browsed in day-grid view. Initialized from `value`.
- `view: 'day' | 'month' | 'year'` — which grid is showing. Initialized to `'day'`.

### Day grid (default view)

- Header row: `‹` chevron · centered pressable label (e.g. "September 2001", Hanken Grotesk
  `title2`/600, `theme.text`, small caret-down icon) · `›` chevron. Chevrons step `cursor` by one
  month; the label press switches `view` to `'year'`.
- Weekday row: S M T W T F S, `footnote` / `theme.textSecondary`, centered over 7 columns.
- 7-column day grid, ~42px circular cells, up to 6 rows:
  - Selected day (`isSameDay(cell, value)`): filled `theme.brand` circle, white bold text.
  - Today, unselected: `theme.brand`-tinted ring + brand text.
  - In-range day (between `minDate`/`maxDate`), plain: `theme.text`, no fill.
  - Out-of-range day (before `minDate` or after `maxDate`): `theme.muted`, not pressable.
  - Leading/trailing days from adjacent months: rendered dimmed (`theme.muted`, lower opacity)
    to fill the grid, but still tappable — tapping one moves `cursor` to that month and fires
    `onChange` for that day (standard calendar-app convenience).
  - Tapping any enabled day calls `onChange(day)` immediately. The component doesn't manage a
    "confirm" step itself — `DateField` owns the draft/commit behavior (see below).

### Month grid (year-jump step 2)

- Reached by picking a year in year-list view.
- 3×4 grid of month abbreviations (Jan…Dec) for the chosen year, `Radius.md` rounded-rect cells.
- Same selected/current/disabled color logic as day cells (a month counts "disabled" only if
  every day in it falls outside `[minDate, maxDate]`, which in practice is just future months
  in the current year — day-level disabling still applies once inside that month).
- Tapping a month sets `cursor` to that year/month and switches `view` back to `'day'`.

### Year list (year-jump step 1)

- Reached by tapping the day-grid header.
- Plain `FlatList` of years from `minDate.getFullYear()` to `maxDate.getFullYear()`, descending
  (most recent first) so a birth-year search starts near "now" and scrolls back.
- ~52px rows, no dividers. Current `cursor` year gets a brand-tinted pill background + bold
  brand text. List auto-scrolls (`initialScrollIndex`) so that row is on-screen when opened.
- Tapping a year sets `cursor`'s year and switches `view` to `'month'`.

## 2. `DateField` integration

`date-field.tsx` drops both the Android imperative-dialog branch and the iOS-only `Modal`
branch, replacing them with one `Modal` (reusing the existing sheet chrome: grabber,
`Radius.xl` top corners, `theme.surface` background, safe-area bottom padding — matching
`ActionSheet`) that renders on both platforms:

- A `temp: Date` draft state, seeded from `value ?? DEFAULT_DATE` when the sheet opens (same
  `DEFAULT_DATE` / `MIN_DATE` / `MAX_AGE` constants as today).
- `<CalendarPicker value={temp} minDate={MIN_DATE} maxDate={TODAY} onChange={setTemp} />`.
- Footer: full-width `Button variant="brand"` label "Done" → commits `temp` via the existing
  `commit()` helper and closes. Below it, a plain-text "Cancel" row (same treatment as
  `ActionSheet`'s Cancel) discards and closes without calling `onChange`. Tapping the backdrop
  also cancels.

Net effect: identical behavior and appearance on Android and iOS; the `Platform.OS` checks in
this file disappear.

## 3. Dependency cleanup

- Remove `@react-native-community/datetimepicker` from `package.json` and its entry from the
  `plugins` array in `app.json`.
- Run `npx expo prebuild --platform android` (and iOS if applicable) to regenerate native
  projects without it.
- `plugins/withAndroidAccentColor.js` is unrelated to this dependency and stays as-is.

## 4. Verification

No test runner is configured in this project. Verify manually by running the app in the
emulator (via the `run` skill) and exercising:

- Opening the sheet from both `profile/edit.tsx` and `(auth)/complete-profile.tsx`.
- Day grid: selecting a day, selecting a dimmed adjacent-month day (confirms month navigation),
  confirming today/selected/disabled cell styling.
- Header tap → year list (confirm auto-scroll near current year) → pick a year → month grid →
  pick a month → back to day grid on the right year/month.
- Boundary behavior at `MIN_DATE` (120 years ago) and `TODAY` (future days disabled).
- Done commits and closes; Cancel and backdrop-tap both discard and close.

# Custom Calendar Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `@react-native-community/datetimepicker` calendar (a system dialog on Android, an inline native widget on iOS — neither stylable beyond accent color) with one fully custom, on-brand `CalendarPicker` component shared by both platforms in `DateField`.

**Architecture:** A new controlled presentational primitive `src/components/ui/calendar-picker.tsx` owns three internal views (day grid / month grid / year list) and pure date-math helpers. `date-field.tsx` drops its `Platform.OS` fork and wraps `CalendarPicker` in a single themed bottom sheet (same chrome as `ActionSheet`), with a `temp` draft state committed on "Done".

**Tech Stack:** React Native, TypeScript, existing `theme.ts` tokens (`Colors`, `Radius`, `Space`), existing `ThemedText`/`Button`/`Icon` primitives. No new dependencies. No test runner is configured in this project — verification is `npx tsc --noEmit` after each code change, plus manual emulator testing in the final task.

**Reference:** `docs/superpowers/specs/2026-07-29-calendar-picker-design.md`

---

### Task 1: `CalendarPicker` component

**Files:**
- Create: `src/components/ui/calendar-picker.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Write the complete `calendar-picker.tsx` file**

```tsx
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';

export type CalendarPickerProps = {
  /** Currently highlighted date (the draft selection). */
  value: Date;
  minDate: Date;
  maxDate: Date;
  onChange: (date: Date) => void;
};

type DayCell = { date: Date; inCurrentMonth: boolean };
type PickerView = 'day' | 'month' | 'year';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DAY_CELL = 42;
const MONTH_ROW_HEIGHT = 64;
const YEAR_ROW_HEIGHT = 52;
const YEAR_LIST_HEIGHT = YEAR_ROW_HEIGHT * 6;

/** Y*10000 + M*100 + D, so two dates compare by calendar day only (ignores time-of-day). */
function dateKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Always 42 cells (6 full weeks) so the grid height never jumps between months. */
function buildDayGrid(cursor: Date): DayCell[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { date, inCurrentMonth: date.getMonth() === month };
  });
}

function isMonthDisabled(year: number, month: number, minDate: Date, maxDate: Date): boolean {
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  return dateKey(lastDayOfMonth) < dateKey(minDate) || dateKey(firstDayOfMonth) > dateKey(maxDate);
}

export function CalendarPicker({ value, minDate, maxDate, onChange }: CalendarPickerProps) {
  const theme = useTheme();
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(value));
  const [view, setView] = useState<PickerView>('day');
  const today = useMemo(() => new Date(), []);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = maxDate.getFullYear(); y >= minDate.getFullYear(); y--) list.push(y);
    return list;
  }, [minDate, maxDate]);

  function goToPreviousPeriod() {
    if (view === 'day') setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
    else if (view === 'month') setCursor((c) => new Date(c.getFullYear() - 1, c.getMonth(), 1));
  }

  function goToNextPeriod() {
    if (view === 'day') setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
    else if (view === 'month') setCursor((c) => new Date(c.getFullYear() + 1, c.getMonth(), 1));
  }

  function selectDay(date: Date) {
    setCursor(startOfMonth(date));
    onChange(date);
  }

  function selectYear(year: number) {
    setCursor((c) => new Date(year, c.getMonth(), 1));
    setView('month');
  }

  function selectMonth(month: number) {
    setCursor((c) => new Date(c.getFullYear(), month, 1));
    setView('day');
  }

  const headerLabel =
    view === 'month'
      ? String(cursor.getFullYear())
      : view === 'year'
        ? 'Select year'
        : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => (view === 'year' ? setView('day') : goToPreviousPeriod())}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={view === 'year'}
          onPress={() => setView('year')}
          style={styles.headerLabel}>
          <ThemedText type="title2" themeColor="text">
            {headerLabel}
          </ThemedText>
          {view !== 'year' ? (
            <Icon name="chevron.down" tintColor={theme.textSecondary} size={14} />
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          disabled={view === 'year'}
          onPress={goToNextPeriod}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
            view === 'year' && styles.hidden,
          ]}>
          <Icon name="chevron.right" tintColor={theme.brand} size={20} />
        </Pressable>
      </View>

      {view === 'day' ? (
        <DayGrid
          cursor={cursor}
          value={value}
          minDate={minDate}
          maxDate={maxDate}
          today={today}
          onSelect={selectDay}
        />
      ) : null}
      {view === 'month' ? (
        <MonthGrid
          year={cursor.getFullYear()}
          value={value}
          minDate={minDate}
          maxDate={maxDate}
          onSelect={selectMonth}
        />
      ) : null}
      {view === 'year' ? (
        <YearList years={years} selectedYear={value.getFullYear()} onSelect={selectYear} />
      ) : null}
    </View>
  );
}

type DayGridProps = {
  cursor: Date;
  value: Date;
  minDate: Date;
  maxDate: Date;
  today: Date;
  onSelect: (date: Date) => void;
};

function DayGrid({ cursor, value, minDate, maxDate, today, onSelect }: DayGridProps) {
  const theme = useTheme();
  const cells = useMemo(() => buildDayGrid(cursor), [cursor]);

  return (
    <View>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <ThemedText key={i} type="footnote" themeColor="textSecondary" style={styles.weekdayCell}>
            {label}
          </ThemedText>
        ))}
      </View>
      <View style={styles.dayGrid}>
        {cells.map(({ date, inCurrentMonth }) => {
          const disabled = dateKey(date) < dateKey(minDate) || dateKey(date) > dateKey(maxDate);
          const selected = isSameDay(date, value);
          const isToday = isSameDay(date, today);

          return (
            <Pressable
              key={date.toISOString()}
              disabled={disabled}
              accessibilityRole="button"
              onPress={() => onSelect(date)}
              style={styles.dayCellWrap}>
              <View
                style={[
                  styles.dayCell,
                  selected && { backgroundColor: theme.brand },
                  !selected && isToday && { borderWidth: 1.5, borderColor: theme.brand },
                ]}>
                <ThemedText
                  type="callout"
                  style={selected && styles.cellTextSelected}
                  themeColor={
                    selected
                      ? 'onBrand'
                      : disabled
                        ? 'muted'
                        : isToday
                          ? 'brand'
                          : !inCurrentMonth
                            ? 'muted'
                            : 'text'
                  }>
                  {date.getDate()}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type MonthGridProps = {
  year: number;
  value: Date;
  minDate: Date;
  maxDate: Date;
  onSelect: (month: number) => void;
};

function MonthGrid({ year, value, minDate, maxDate, onSelect }: MonthGridProps) {
  const theme = useTheme();

  return (
    <View style={styles.monthGrid}>
      {MONTH_LABELS.map((label, month) => {
        const disabled = isMonthDisabled(year, month, minDate, maxDate);
        const selected = year === value.getFullYear() && month === value.getMonth();

        return (
          <Pressable
            key={label}
            disabled={disabled}
            accessibilityRole="button"
            onPress={() => onSelect(month)}
            style={styles.monthCellWrap}>
            <View style={[styles.monthCell, selected && { backgroundColor: theme.brand }]}>
              <ThemedText
                type="callout"
                style={selected && styles.cellTextSelected}
                themeColor={selected ? 'onBrand' : disabled ? 'muted' : 'text'}>
                {label}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type YearListProps = {
  years: number[];
  selectedYear: number;
  onSelect: (year: number) => void;
};

function YearList({ years, selectedYear, onSelect }: YearListProps) {
  const theme = useTheme();
  const selectedIndex = Math.max(years.indexOf(selectedYear), 0);

  return (
    <FlatList
      data={years}
      keyExtractor={(year) => String(year)}
      style={styles.yearList}
      initialScrollIndex={selectedIndex}
      getItemLayout={(_, index) => ({ length: YEAR_ROW_HEIGHT, offset: YEAR_ROW_HEIGHT * index, index })}
      renderItem={({ item: year }) => {
        const selected = year === selectedYear;
        return (
          <Pressable accessibilityRole="button" onPress={() => onSelect(year)} style={styles.yearRow}>
            <View style={[styles.yearPill, selected && { backgroundColor: theme.brandTint }]}>
              <ThemedText
                type="headline"
                style={selected && styles.cellTextSelected}
                themeColor={selected ? 'brand' : 'text'}>
                {year}
              </ThemedText>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.base,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  hidden: { opacity: 0 },
  pressed: { opacity: 0.6 },
  weekdayRow: { flexDirection: 'row', marginBottom: Space.sm },
  weekdayCell: { width: `${100 / 7}%`, textAlign: 'center' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellWrap: {
    width: `${100 / 7}%`,
    height: DAY_CELL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  dayCell: {
    width: DAY_CELL,
    height: DAY_CELL,
    borderRadius: DAY_CELL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTextSelected: { fontWeight: '700' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCellWrap: {
    width: '33.3333%',
    height: MONTH_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xs,
  },
  monthCell: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearList: { height: YEAR_LIST_HEIGHT },
  yearRow: { height: YEAR_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  yearPill: { paddingHorizontal: Space.xl, paddingVertical: Space.sm, borderRadius: Radius.pill },
});
```

- [ ] **Step 2: Export it from the UI barrel**

In `src/components/ui/index.ts`, add the export alphabetically between `Button` and `Card`:

```ts
export { Button } from './button';
export { CalendarPicker } from './calendar-picker';
export { Card } from './card';
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `calendar-picker.tsx` (pre-existing unrelated errors elsewhere in the repo, if any, are not this task's concern — only confirm nothing new is introduced by this file).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/calendar-picker.tsx src/components/ui/index.ts
git commit -m "feat(ui): add custom CalendarPicker primitive"
```

---

### Task 2: Wire `CalendarPicker` into `DateField`

**Files:**
- Modify: `src/components/ui/date-field.tsx` (full rewrite — replaces the whole file)

- [ ] **Step 1: Replace the file contents**

```tsx
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Button } from './button';
import { CalendarPicker } from './calendar-picker';
import { Icon } from './icon';

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

const MAX_AGE = 120;
const TODAY = new Date();
const MIN_DATE = new Date(TODAY.getFullYear() - MAX_AGE, 0, 1);
const DEFAULT_DATE = new Date(TODAY.getFullYear() - 25, TODAY.getMonth(), TODAY.getDate());

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const format = (d: Date) =>
  d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function DateField({ label, error, value, onChange, containerStyle }: DateFieldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState<Date | null>(() => fromIso(value));
  const [temp, setTemp] = useState<Date>(() => fromIso(value) ?? DEFAULT_DATE);
  const [open, setOpen] = useState(false);

  const borderColor = error ? theme.riskCritical : 'transparent';

  function commit(d: Date) {
    setDate(d);
    onChange(toIso(d));
  }

  function openPicker() {
    setTemp(date ?? DEFAULT_DATE);
    setOpen(true);
  }

  return (
    <View style={containerStyle}>
      {label ? (
        <ThemedText type="subhead" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={openPicker}
        style={[styles.field, { backgroundColor: theme.elementBg, borderColor, borderWidth: 1.5 }]}>
        <ThemedText type="body" themeColor={date ? 'text' : 'muted'}>
          {date ? format(date) : 'Select date'}
        </ThemedText>
        <Icon name="calendar" tintColor={theme.muted} size={18} />
      </Pressable>

      {error ? (
        <ThemedText type="footnote" themeColor="riskCritical" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: theme.surface, paddingBottom: insets.bottom + Space.base },
            ]}>
            <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />

            {/* Mounted only while open, so its internal cursor/view state resets each time. */}
            {open ? (
              <CalendarPicker value={temp} minDate={MIN_DATE} maxDate={TODAY} onChange={setTemp} />
            ) : null}

            <Button
              label="Done"
              variant="brand"
              onPress={() => {
                commit(temp);
                setOpen(false);
              }}
              style={styles.doneButton}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <ThemedText type="headline" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  error: { marginTop: Space.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.sm,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Space.sm },
  doneButton: { marginTop: Space.sm },
  cancel: { height: 54, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `date-field.tsx`, `src/app/profile/edit.tsx`, or `src/app/(auth)/complete-profile.tsx` (both consume `DateField`'s unchanged public props, so they need no edits).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/date-field.tsx
git commit -m "refactor(ui): replace native DateTimePicker with CalendarPicker in DateField"
```

---

### Task 3: Remove the native `datetimepicker` dependency

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `app.json`

- [ ] **Step 1: Remove the plugin entry from `app.json`**

In the `expo.plugins` array, delete this line:

```json
      "@react-native-community/datetimepicker",
```

- [ ] **Step 2: Uninstall the package**

Run: `npm uninstall @react-native-community/datetimepicker`
Expected: npm reports the package removed; `package.json`'s `dependencies` no longer lists it.

- [ ] **Step 3: Regenerate the native Android project**

Run: `npx expo prebuild --platform android`
Expected: ends with `✔ Finished prebuild`. (The `android/` directory is gitignored/generated — this just keeps it in sync with `app.json`/`package.json`; nothing here needs to be committed.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "chore: remove unused @react-native-community/datetimepicker dependency"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild and launch on the Android emulator**

Use the `run` skill (or `npx expo run:android` directly) to build and install, since Task 3 changed native dependencies — a Metro reload alone isn't enough here.

- [ ] **Step 2: Walk through the checklist from the design spec**

In both `profile/edit.tsx`'s "Date of birth" field and `(auth)/complete-profile.tsx`:

- Sheet opens with the sunset-themed chrome (rounded top corners, grabber, brand-colored controls).
- Day grid: tap a day → it highlights in brand orange. Tap a dimmed leading/trailing-month day → the grid navigates to that month with the day selected.
- Today's date shows a brand-colored ring when not selected.
- Days after today, and days before the 120-years-ago floor, are visibly muted and don't respond to taps.
- Tap the header label → year list appears, auto-scrolled near the current year, selected year shown in a brand-tinted pill.
- Tap a year → month grid for that year appears. Months entirely in the future are muted/disabled.
- Tap a month → returns to the day grid on that year/month.
- Tap "Done" → sheet closes and the field shows the newly picked date.
- Reopen, tap "Cancel" → sheet closes without changing the field's value.
- Reopen, tap the backdrop → same as Cancel.

- [ ] **Step 3: Report results**

Note any visual or interaction issues found during the walkthrough for follow-up — this task doesn't have automated pass/fail, so explicitly confirm each bullet above worked before considering the plan complete.

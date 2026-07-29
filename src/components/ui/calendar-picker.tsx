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

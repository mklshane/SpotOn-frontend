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

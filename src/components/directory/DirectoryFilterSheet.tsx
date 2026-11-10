import { t, useLocale } from '@/lib/i18n';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Radius, Space } from '@/constants/theme';
import type { FacilityKind } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { CONCERNS, type ConcernId } from '@/lib/concerns';

export type DirectorySort = 'distance' | 'rating' | 'name';

export type DirectoryFilters = {
  kind: FacilityKind | null;
  todayOnly: boolean;
  weekendOnly: boolean;
  bookingOnly: boolean;
  concern: ConcernId | null;
};

/**
 * Every directory filter in one place. The rail above the list keeps only the few quick toggles;
 * skin concerns (which need a sentence of explanation) and the sort order live here, so the list
 * starts right under the search bar instead of below two chip rows and a paragraph.
 * Filters apply as they are changed; Apply just closes the sheet.
 */
export function DirectoryFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  onReset,
  sort,
  onSort,
  hasLocation,
  concernIds,
}: {
  visible: boolean;
  onClose: () => void;
  filters: DirectoryFilters;
  onChange: (next: Partial<DirectoryFilters>) => void;
  onReset: () => void;
  sort: DirectorySort;
  onSort: (s: DirectorySort) => void;
  hasLocation: boolean;
  /** Concerns with enough places to be worth offering (ClinicsView's MIN_CONCERN_PLACES). */
  concernIds: ConcernId[];
}) {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const sortOptions = [
    ...(hasLocation ? [{ value: 'distance' as const, label: t('Nearest') }] : []),
    { value: 'rating' as const, label: t('Top rated') },
    { value: 'name' as const, label: t('A–Z') },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close filters')} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + Space.base }]}>
          <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
          <View style={styles.titleRow}>
            <ThemedText type="title2">{t('Filters')}</ThemedText>
            <Pressable onPress={onReset} hitSlop={12} accessibilityRole="button">
              <ThemedText type="callout" style={[styles.reset, { color: theme.brandPressed }]}>
                {t('Reset')}
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Section title={t('Place')}>
              <Segmented
                options={[
                  { value: 'all', label: t('All') },
                  { value: 'clinic', label: t('Clinics') },
                  { value: 'hospital', label: t('Hospitals') },
                ]}
                value={filters.kind ?? 'all'}
                onChange={(v) => onChange({ kind: v === 'all' ? null : (v as FacilityKind) })}
              />
            </Section>

            <Section title={t('Availability')}>
              <ToggleRow
                label={t('Dermatologist in today')}
                sublabel={t('A dermatologist holds clinic today, or the clinic is open now')}
                value={filters.todayOnly}
                onChange={(v) => onChange({ todayOnly: v })}
              />
              <ToggleRow
                label={t('Weekend clinic')}
                sublabel={t('A dermatologist sees patients on Saturday or Sunday')}
                value={filters.weekendOnly}
                onChange={(v) => onChange({ weekendOnly: v })}
              />
              <ToggleRow
                label={t('Books online')}
                sublabel={t('Book online with the clinic or a dermatologist here')}
                value={filters.bookingOnly}
                onChange={(v) => onChange({ bookingOnly: v })}
              />
            </Section>

            <Section
              title={t('Skin concern')}
              note={t('Every dermatologist treats common skin problems. These show places that list it as a focus.')}
            >
              <View style={styles.wrap}>
                {CONCERNS.filter((c) => concernIds.includes(c.id)).map((c) => (
                  <Chip
                    key={c.id}
                    size="sm"
                    label={t(c.label)}
                    active={filters.concern === c.id}
                    onPress={() => onChange({ concern: filters.concern === c.id ? null : c.id })}
                  />
                ))}
              </View>
            </Section>

            <Section title={t('Sort by')}>
              <Segmented options={sortOptions} value={sort} onChange={onSort} />
            </Section>
          </ScrollView>

          <Button label={t('Apply')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="headline">{title}</ThemedText>
      {note ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={sublabel}
    >
      <View style={styles.toggleText}>
        <ThemedText type="callout" style={styles.toggleLabel}>
          {label}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {sublabel}
        </ThemedText>
      </View>
      <Switch value={value} onChange={onChange} accessibilityLabel={label} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    gap: Space.base,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reset: { fontWeight: '600' },
  body: { gap: Space.xl, paddingBottom: Space.base },
  section: { gap: Space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 52 },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontWeight: '600' },
});

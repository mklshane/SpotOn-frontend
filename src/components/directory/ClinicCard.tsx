import { t, useLocale } from '@/lib/i18n';
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { isHospitalType, isHospitalWithoutDerm, type DermSummary } from '@/lib/directory-core';
import { dermSummaryLine, todayScheduleBit } from '@/lib/directory-display';
import { facilityDisplayName, formatDistance, formatFee, humanizeTag } from '@/lib/format';
import { openChangeLabel, openStatus } from '@/lib/hours';
import { normalizeUrl, openDirections, openWebsite } from '@/lib/links';

import { hasPhone } from './use-phone-call';

const NATIVE = Platform.OS !== 'web';

export type ClinicCardProps = {
  facility: FacilitySync | FacilityWithDistance;
  onPress: () => void;
  /** Linked dermatologists; undefined = not loaded yet (falls back to derm_status). */
  derm?: DermSummary;
  /** Dial the clinic. The list owns one shared number-picker sheet instead of one per card. */
  onCall: (phone: string | null) => void;
  /** Booking opens a web page, so it is disabled offline (calling and directions still work). */
  isOnline: boolean;
};

export function ClinicCard({ facility, onPress, derm, onCall, isOnline }: ClinicCardProps) {
  useLocale();
  const theme = useTheme();
  const distance = 'distance_m' in facility ? facility.distance_m : null;
  const hospital = isHospitalType(facility.type);
  // A hospital's own hours (often 24h) say nothing about when a dermatologist is in, so hospital
  // cards show the dermatologists instead of "Open now" and the Mon–Fri line.
  const status = hospital ? { open: null, changesAt: null } : openStatus(facility.weekday_hours, facility.weekend_hours);
  const open = status.open;
  const change = openChangeLabel(status);
  const noDerm = isHospitalWithoutDerm(facility, derm?.count);
  const dermLine = noDerm ? t('No dermatologist listed - call the OPD') : dermSummaryLine(derm, todayScheduleBit());
  const bookingUrl = normalizeUrl(facility.booking_url);
  const name = facilityDisplayName(facility);
  const meta = [
    humanizeTag(facility.type),
    facility.google_rating != null ? `★ ${facility.google_rating.toFixed(1)}` : null,
    facility.fee_min != null ? t('From {{fee}}', { fee: formatFee(facility.fee_min) }) : null,
    facility.has_philhealth ? t('PhilHealth') : null,
  ].filter((x): x is string => !!x);
  const callable = hasPhone(facility.phone);

  const directions = () =>
    openDirections({
      googleMapsUrl: facility.google_maps_url,
      latitude: facility.latitude,
      longitude: facility.longitude,
    });

  // One screen-reader stop per clinic: the card reads its summary and offers the buttons as
  // actions, instead of a silent card with four unlabeled-in-context buttons inside.
  const a11yLabel = [
    name,
    distance != null ? formatDistance(distance) : null,
    open != null ? (open ? t('Open now') : t('Closed')) : null,
    dermLine,
    facility.address,
  ]
    .filter(Boolean)
    .join(', ');
  const a11yActions = [
    { name: 'directions', label: t('Directions') },
    ...(callable ? [{ name: 'call', label: t('Call') }] : []),
    ...((bookingUrl || (derm?.bookable ?? 0) > 0) && isOnline ? [{ name: 'book', label: t('Book online') }] : []),
  ];
  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'directions') directions();
    else if (e.nativeEvent.actionName === 'call') onCall(facility.phone);
    else if (e.nativeEvent.actionName === 'book') {
      if (bookingUrl) openWebsite(bookingUrl);
      else onPress();
    }
  };

  return (
    <Pressable
      onPress={onPress}
      // Native: one screen-reader stop with the buttons as actions. Web: a <button> may not
      // contain buttons, so the card stays a plain container and its own buttons stay reachable.
      {...(NATIVE
        ? {
            accessibilityRole: 'button' as const,
            accessibilityLabel: a11yLabel,
            accessibilityHint: t('Opens the clinic details'),
            accessibilityActions: a11yActions,
            onAccessibilityAction: onA11yAction,
          }
        : { accessible: false })}
    >
      {({ pressed }) => (
        <Card style={[styles.card, pressed && styles.cardPressed]} elevation="sm">
          {/* 1 · Who and how far */}
          <View style={styles.titleRow}>
            <ThemedText type="headline" style={styles.title} numberOfLines={2}>
              {name}
            </ThemedText>
            {distance != null ? (
              <ThemedText type="subhead" style={[styles.distance, { color: theme.brandPressed }]}>
                {formatDistance(distance)}
              </ThemedText>
            ) : null}
          </View>

          {/* 2 · What it is, in one quiet line */}
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {meta.join('  ·  ')}
          </ThemedText>

          {/* 3 · Can I go now? */}
          {status.open != null ? (
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: status.open ? theme.riskLow : theme.muted }]} />
              <ThemedText
                type="footnote"
                style={[styles.statusText, { color: status.open ? theme.riskLow : theme.textSecondary }]}
                numberOfLines={1}
              >
                {[status.open ? t('Open') : t('Closed'), change].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
          ) : null}
          {dermLine ? (
            <View style={styles.statusRow}>
              <Icon
                name={noDerm ? 'info.circle' : 'stethoscope'}
                size={13}
                tintColor={noDerm ? theme.textSecondary : theme.brandPressed}
              />
              <ThemedText
                type="footnote"
                style={[styles.statusText, { color: noDerm ? theme.textSecondary : theme.brandPressed }]}
                numberOfLines={1}
              >
                {dermLine}
              </ThemedText>
            </View>
          ) : null}

          {/* 4 · Where */}
          <ThemedText type="footnote" themeColor="muted" numberOfLines={1}>
            {facility.address}
          </ThemedText>

          {/* 5 · Act - the whole card opens the details, so no separate Details button */}
          <View
            style={styles.actions}
            importantForAccessibility={NATIVE ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={NATIVE}
          >
            {callable ? (
              <ActionPill icon="phone.fill" label={t('Call')} onPress={() => onCall(facility.phone)} />
            ) : null}
            <ActionPill icon="arrow.triangle.turn.up.right.diamond.fill" label={t('Directions')} onPress={directions} />
            {bookingUrl || (derm?.bookable ?? 0) > 0 ? (
              <ActionPill
                icon="calendar"
                label={t('Book')}
                disabled={!isOnline}
                // No clinic booking page: the details screen offers its bookable dermatologists.
                onPress={() => (bookingUrl ? openWebsite(bookingUrl) : onPress())}
              />
            ) : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function ActionPill({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: theme.elementBg },
        disabled && styles.disabled,
        pressed && !disabled && styles.pillPressed,
      ]}
    >
      <Icon name={icon} size={14} tintColor={theme.brandPressed} />
      <ThemedText type="footnote" style={[styles.pillLabel, { color: theme.text }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md, gap: Space.xs },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  title: { flex: 1 },
  distance: { fontWeight: '700', marginTop: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 2 },
  statusText: { flexShrink: 1, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 36,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
  pillPressed: { opacity: 0.7 },
  pillLabel: { fontWeight: '600' },
  disabled: { opacity: 0.45 },
});

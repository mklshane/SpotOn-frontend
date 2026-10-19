import { t, useLocale } from '@/lib/i18n';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import {
  distanceMeters,
  facilityDermSummary,
  listFacilities,
  onlineBookingOptions,
  type OnlineBookingOption,
} from '@/data/repositories';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useKnownLocation, type Coords } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { dermTier } from '@/lib/concerns';
import type { DermSummary } from '@/lib/directory-core';
import { dermSummaryLine, todayScheduleBit } from '@/lib/directory-display';
import { facilityDisplayName, formatDistance, formatFee } from '@/lib/format';
import { openDirections, openWebsite } from '@/lib/links';

import { hasPhone, usePhoneCall } from './use-phone-call';

/** Beyond this, a trip to the nearest dermatologist is a day's travel - suggest online consults. */
export const FAR_METERS = 50_000;
const SHOW = 3;

type Place = { facility: FacilitySync; distance: number; derm: DermSummary | undefined };

/** Which Dermatologists-tab chip a "see all" link should open on. */
export type BookingFilter = 'booking' | 'online';

/** What the result screen's two dermatologist cards show, loaded once for both. */
export type DermOptions = {
  coords: Coords | null;
  /** Nearest derm places; null while loading or without a location. */
  places: Place[] | null;
  /** Dermatologists bookable online - video consults only when `far`. */
  booking: OnlineBookingOption[];
  /** The nearest dermatologist is more than FAR_METERS away (or there is none). */
  far: boolean;
};

/**
 * Loads the 3 nearest places where a dermatologist does mole/skin-cancer checks and 3 dermatologists
 * bookable online (nearest practice first). When the nearest clinic is more than ~50 km away the
 * booking list narrows to video consults, cheapest first.
 *
 * Uses the last known location only (never prompts); without one there are no places and the
 * booking list has no distances.
 */
export function useDermOptions(): DermOptions {
  const coords = useKnownLocation();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [booking, setBooking] = useState<OnlineBookingOption[]>([]);
  const [far, setFar] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!coords) {
      // No location: no clinic list, but booking online doesn't need one.
      onlineBookingOptions({ limit: SHOW })
        .then((rows) => !cancelled && setBooking(rows))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const [rows, summary] = await Promise.all([
        listFacilities({ concern: 'skin_cancer_mole_check', limit: null }),
        facilityDermSummary(),
      ]);
      const near = rows
        // Only places where a dermatologist can actually be seen.
        .filter((f) => dermTier(f) === 0)
        .map((f) => ({
          facility: f,
          distance: distanceMeters(coords.latitude, coords.longitude, f.latitude, f.longitude),
          derm: summary.get(f.id),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, SHOW);
      const isFar = !near.length || near[0].distance > FAR_METERS;
      // Far away, a video consult's clinic distance is noise: cheapest first, no distance.
      const options = await onlineBookingOptions({ limit: SHOW, onlineOnly: isFar, coords: isFar ? null : coords });
      if (cancelled) return;
      setPlaces(near);
      setFar(isFar);
      setBooking(options);
    })().catch(() => !cancelled && setPlaces([]));
    return () => {
      cancelled = true;
    };
  }, [coords]);

  return { coords, places, booking, far };
}

/**
 * The result screen's "see a dermatologist" step, made concrete: the nearest places where a
 * dermatologist does mole/skin-cancer checks, each with Call and Directions, plus a link to the map.
 * Distance leads each row so "which is closest" reads at a glance.
 */
export function NearbyDerms({ data, onSeeAll }: { data: DermOptions; onSeeAll: () => void }) {
  useLocale();
  const theme = useTheme();
  const phone = usePhoneCall();
  const { coords, places } = data;
  const todayBit = todayScheduleBit();

  return (
    <Card padded={false} style={styles.card}>
      <CardHead
        icon="mappin.circle.fill"
        title={t('Dermatologists near you')}
        subtitle={
          coords
            ? t('Clinics where a dermatologist can check this spot.')
            : t('Turn on location in the directory to see the nearest ones here.')
        }
      />

      {(places ?? []).map((p) => {
        const name = facilityDisplayName(p.facility);
        const derm = dermSummaryLine(p.derm, todayBit);
        return (
          <View key={p.facility.id} style={[styles.row, { borderTopColor: theme.hairline }]}>
            <PressableScale
              style={styles.rowMain}
              onPress={() => router.push({ pathname: '/directory/clinic', params: { id: p.facility.id } })}
              accessibilityRole="button"
              accessibilityLabel={[name, formatDistance(p.distance), derm].filter(Boolean).join(', ')}
            >
              <DistanceTile meters={p.distance} />
              <View style={styles.rowText}>
                <ThemedText type="callout" style={styles.bold} numberOfLines={2}>
                  {name}
                </ThemedText>
                {derm ? (
                  <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                    {derm}
                  </ThemedText>
                ) : null}
              </View>
            </PressableScale>
            <View style={styles.actions}>
              {hasPhone(p.facility.phone) ? (
                <RoundAction
                  icon="phone.fill"
                  label={t('Call {{name}}', { name })}
                  onPress={() => phone.call(p.facility.phone)}
                />
              ) : null}
              <RoundAction
                icon="arrow.triangle.turn.up.right.diamond.fill"
                label={t('Directions to {{name}}', { name })}
                onPress={() =>
                  openDirections({
                    googleMapsUrl: p.facility.google_maps_url,
                    latitude: p.facility.latitude,
                    longitude: p.facility.longitude,
                  })
                }
              />
            </View>
          </View>
        );
      })}

      <SeeAllRow
        label={places?.length ? t('See all clinics on the map') : t('Find a clinic near you')}
        onPress={onSeeAll}
      />
      {phone.sheet}
    </Card>
  );
}

/**
 * Dermatologists the patient can book without a phone call: each row says what kind of visit it
 * is (video call or clinic visit), what it costs and how far the clinic is, and Book opens the
 * doctor's page on the booking platform. Far from any clinic it becomes "Consult online", video only.
 * Renders nothing when there is nobody to book.
 */
export function BookOnlineDerms({
  data,
  onSeeAll,
}: {
  data: DermOptions;
  onSeeAll: (filter: BookingFilter) => void;
}) {
  useLocale();
  const theme = useTheme();
  const { isOnline } = useConnectivity();
  const { booking, far, places } = data;
  if (!booking.length) return null;

  const subtitle = !far
    ? t('Pick a time on the doctor’s booking page. No phone call needed.')
    : places?.length
      ? t('The nearest dermatologist is {{distance}} away. These dermatologists also see patients by video call.', {
          distance: formatDistance(places[0].distance),
        })
      : t('These dermatologists see patients by video call.');
  // Say the platform once, not under every Book button, unless the rows mix platforms.
  const platforms = new Set(booking.map((o) => o.platformName));
  const sharedPlatform = platforms.size === 1 ? booking[0].platformName : null;

  return (
    <Card padded={false} style={styles.card}>
      <CardHead icon={far ? 'video.fill' : 'calendar'} title={far ? t('Consult online') : t('Book a dermatologist online')} subtitle={subtitle} />

      {booking.map((o) => (
        <BookingRow key={o.doctor.id} option={o} isOnline={isOnline} showPlatform={!sharedPlatform} />
      ))}

      {!isOnline || sharedPlatform ? (
        <View style={[styles.note, { borderTopColor: theme.hairline }]}>
          <Icon name={isOnline ? 'arrow.up.right' : 'wifi.slash'} size={12} tintColor={theme.muted} />
          <ThemedText type="caption" themeColor="muted" style={styles.flex}>
            {isOnline ? t('Booking opens on {{platform}}.', { platform: sharedPlatform ?? '' }) : t('Connect to the internet to book.')}
          </ThemedText>
        </View>
      ) : null}

      <SeeAllRow
        label={far ? t('See all online consults') : t('See all dermatologists who book online')}
        onPress={() => onSeeAll(far ? 'online' : 'booking')}
      />
    </Card>
  );
}

/** A bookable dermatologist: tap the row for the profile, the Book pill for the platform. */
function BookingRow({
  option: o,
  isOnline,
  showPlatform,
}: {
  option: OnlineBookingOption;
  isOnline: boolean;
  showPlatform: boolean;
}) {
  const theme = useTheme();
  const visit = o.online ? t('Video call or clinic') : t('Clinic visit');
  const meta = [
    o.fee != null ? formatFee(o.fee) : null,
    o.distance != null ? t('{{distance}} away', { distance: formatDistance(o.distance) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/directory/doctor', params: { id: o.doctor.id } })}
      accessibilityRole="button"
      accessibilityLabel={[o.doctor.name, visit, meta].filter(Boolean).join(', ')}
      style={[styles.row, { borderTopColor: theme.hairline }]}
    >
      <Avatar name={o.doctor.name.replace(/^dr\.?\s+/i, '')} size={48} />
      <View style={styles.rowText}>
        <ThemedText type="callout" style={styles.bold} numberOfLines={2}>
          {o.doctor.name}
        </ThemedText>
        <View style={styles.visit}>
          <Icon
            name={o.online ? 'video.fill' : 'building.2.fill'}
            size={12}
            tintColor={o.online ? theme.brandPressed : theme.textSecondary}
          />
          <ThemedText
            type="footnote"
            numberOfLines={1}
            style={[styles.flexText, { color: o.online ? theme.brandPressed : theme.textSecondary }, o.online && styles.bold]}
          >
            {visit}
          </ThemedText>
        </View>
        {meta ? (
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.bookSide}>
        <PressableScale
          onPress={() => openWebsite(o.url)}
          disabled={!isOnline}
          hitSlop={Space.sm}
          accessibilityRole="link"
          accessibilityLabel={t('Book with {{name}} on {{platform}}', { name: o.doctor.name, platform: o.platformName })}
          style={[styles.pill, { backgroundColor: theme.brand }, !isOnline && styles.disabled]}
        >
          <ThemedText type="subhead" style={[styles.bold, { color: theme.onBrand }]}>
            {t('Book')}
          </ThemedText>
          <Icon name="arrow.up.right" size={12} tintColor={theme.onBrand} />
        </PressableScale>
        {showPlatform ? (
          <ThemedText type="caption" themeColor="muted" numberOfLines={1}>
            {t('on {{platform}}', { platform: o.platformName })}
          </ThemedText>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Shared card header: icon, title and one line of context, so both cards read as a pair. */
function CardHead({ icon, title, subtitle }: { icon: IconName; title: string; subtitle: string }) {
  return (
    <View style={styles.head}>
      <IconCircle icon={icon} size={40} />
      <View style={styles.flex}>
        <ThemedText type="headline">{title}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
    </View>
  );
}

/** "1.8 / km" stacked in a soft tile: the number is what people compare down the list. */
function DistanceTile({ meters }: { meters: number }) {
  const theme = useTheme();
  const [value, unit] = formatDistance(meters).split(' ');
  return (
    <View style={[styles.tile, { backgroundColor: theme.brandTint }]}>
      <ThemedText type="subhead" style={[styles.tileValue, { color: theme.brandPressed }]} numberOfLines={1}>
        {value}
      </ThemedText>
      <ThemedText type="caption" style={{ color: theme.brandPressed }}>
        {unit}
      </ThemedText>
    </View>
  );
}

function RoundAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={Space.xs}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.iconBtn, { backgroundColor: theme.elementBg }]}
    >
      <Icon name={icon} size={18} tintColor={theme.brand} />
    </PressableScale>
  );
}

function SeeAllRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" style={[styles.seeAll, { borderTopColor: theme.hairline }]}>
      <ThemedText type="subhead" style={[styles.bold, { color: theme.brandPressed }]}>
        {label}
      </ThemedText>
      <Icon name="chevron.right" size={12} tintColor={theme.brandPressed} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, padding: Space.base, paddingBottom: Space.md },
  flex: { flex: 1, gap: Space.xs },
  flexText: { flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  rowText: { flex: 1, gap: 2 },
  bold: { fontWeight: '600' },
  tile: { width: 48, height: 48, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileValue: { fontWeight: '700', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Space.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  visit: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  bookSide: { alignItems: 'center', gap: Space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: 40,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    minHeight: 48,
    paddingHorizontal: Space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  disabled: { opacity: 0.5 },
});

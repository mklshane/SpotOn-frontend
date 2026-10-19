import { t, useLocale } from '@/lib/i18n';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
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
 */
export function NearbyDerms({ data, onSeeAll }: { data: DermOptions; onSeeAll: () => void }) {
  useLocale();
  const theme = useTheme();
  const phone = usePhoneCall();
  const { coords, places } = data;
  const todayBit = todayScheduleBit();

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.head}>
        <ThemedText type="headline">{t('Dermatologists near you')}</ThemedText>
        {!coords ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {t('Turn on location in the directory to see the nearest ones here.')}
          </ThemedText>
        ) : null}
      </View>

      {(places ?? []).map((p) => {
        const name = facilityDisplayName(p.facility);
        const derm = dermSummaryLine(p.derm, todayBit);
        return (
          <View key={p.facility.id} style={[styles.row, { borderTopColor: theme.hairline }]}>
            <Pressable
              style={styles.rowMain}
              onPress={() => router.push({ pathname: '/directory/clinic', params: { id: p.facility.id } })}
              accessibilityRole="button"
              accessibilityLabel={[name, formatDistance(p.distance), derm].filter(Boolean).join(', ')}
            >
              <ThemedText type="callout" style={styles.bold} numberOfLines={2}>
                {name}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                {[formatDistance(p.distance), derm].filter(Boolean).join(' · ')}
              </ThemedText>
            </Pressable>
            {hasPhone(p.facility.phone) ? (
              <Pressable
                onPress={() => phone.call(p.facility.phone)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('Call {{name}}', { name })}
                style={[styles.iconBtn, { backgroundColor: theme.elementBg }]}
              >
                <Icon name="phone.fill" size={16} tintColor={theme.brand} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() =>
                openDirections({
                  googleMapsUrl: p.facility.google_maps_url,
                  latitude: p.facility.latitude,
                  longitude: p.facility.longitude,
                })
              }
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('Directions to {{name}}', { name })}
              style={[styles.iconBtn, { backgroundColor: theme.elementBg }]}
            >
              <Icon name="arrow.triangle.turn.up.right.diamond.fill" size={16} tintColor={theme.brand} />
            </Pressable>
          </View>
        );
      })}

      <SeeAllRow
        icon="mappin.circle.fill"
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

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.bookHead}>
        <IconCircle icon={far ? 'video.fill' : 'calendar'} size={44} />
        <View style={styles.flex}>
          <ThemedText type="headline">{far ? t('Consult online') : t('Book a dermatologist online')}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        </View>
      </View>

      {booking.map((o) => (
        <BookingRow key={o.doctor.id} option={o} isOnline={isOnline} />
      ))}

      {!isOnline ? (
        <View style={[styles.offline, { borderTopColor: theme.hairline }]}>
          <Icon name="wifi.slash" size={14} tintColor={theme.muted} />
          <ThemedText type="footnote" themeColor="muted" style={styles.flex}>
            {t('Connect to the internet to book.')}
          </ThemedText>
        </View>
      ) : null}

      <SeeAllRow
        icon={far ? 'video.fill' : 'calendar'}
        label={far ? t('See all online consults') : t('See all dermatologists who book online')}
        onPress={() => onSeeAll(far ? 'online' : 'booking')}
      />
    </Card>
  );
}

/** A bookable dermatologist: tap the row for the profile, the Book pill for the platform. */
function BookingRow({ option: o, isOnline }: { option: OnlineBookingOption; isOnline: boolean }) {
  const theme = useTheme();
  const visit = o.online ? t('Video call or clinic') : t('Clinic visit');
  const meta = [
    o.fee != null ? formatFee(o.fee) : null,
    o.distance != null ? t('{{distance}} away', { distance: formatDistance(o.distance) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/directory/doctor', params: { id: o.doctor.id } })}
      accessibilityRole="button"
      accessibilityLabel={[o.doctor.name, visit, meta].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.bookRow, { borderTopColor: theme.hairline }, pressed && styles.pressed]}
    >
      <View style={styles.bookMain}>
        <ThemedText type="callout" style={styles.bold} numberOfLines={1}>
          {o.doctor.name}
        </ThemedText>
        <Badge label={visit} tone={o.online ? 'brand' : 'neutral'} />
        {meta ? (
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.bookSide}>
        <Pressable
          onPress={() => openWebsite(o.url)}
          disabled={!isOnline}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={t('Book with {{name}} on {{platform}}', { name: o.doctor.name, platform: o.platformName })}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: pressed ? theme.brand : theme.brandTint },
            !isOnline && styles.disabled,
          ]}
        >
          {({ pressed }) => (
            <>
              <ThemedText type="subhead" style={[styles.bold, { color: pressed ? theme.onBrand : theme.brandPressed }]}>
                {t('Book')}
              </ThemedText>
              <Icon name="arrow.up.right" size={12} tintColor={pressed ? theme.onBrand : theme.brandPressed} />
            </>
          )}
        </Pressable>
        <ThemedText type="caption" themeColor="muted" numberOfLines={1}>
          {t('on {{platform}}', { platform: o.platformName })}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function SeeAllRow({ icon, label, onPress }: { icon: 'mappin.circle.fill' | 'video.fill' | 'calendar'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.seeAll, { borderTopColor: theme.hairline }]}>
      <Icon name={icon} size={16} tintColor={theme.brandPressed} />
      <ThemedText type="callout" style={[styles.bold, styles.flex, { color: theme.brandPressed }]}>
        {label}
      </ThemedText>
      <Icon name="chevron.right" size={14} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  head: { padding: Space.base, gap: Space.xs },
  flex: { flex: 1, gap: Space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: 2 },
  bold: { fontWeight: '600' },
  iconBtn: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  bookHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, padding: Space.base },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bookMain: { flex: 1, gap: Space.xs },
  bookSide: { alignItems: 'flex-end', gap: Space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  offline: {
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
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

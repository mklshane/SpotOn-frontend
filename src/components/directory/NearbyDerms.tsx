import { t, useLocale } from '@/lib/i18n';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import {
  distanceMeters,
  facilityDermSummary,
  listFacilities,
  onlineConsultOptions,
  type OnlineConsultOption,
} from '@/data/repositories';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useKnownLocation } from '@/hooks/use-location';
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

/**
 * The result screen's "see a dermatologist" step, made concrete: the 3 nearest places where a
 * dermatologist does mole/skin-cancer checks, each with Call and Directions, plus a link to the
 * full directory. When the nearest is more than ~50 km away, online consultations are offered too.
 *
 * Uses the last known location only (never prompts); without one it falls back to a plain link.
 */
export function NearbyDerms({ onSeeAll }: { onSeeAll: () => void }) {
  useLocale();
  const theme = useTheme();
  const coords = useKnownLocation();
  const { isOnline } = useConnectivity();
  const phone = usePhoneCall();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [online, setOnline] = useState<OnlineConsultOption[]>([]);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
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
      const far = !near.length || near[0].distance > FAR_METERS;
      const consults = far ? await onlineConsultOptions(3) : [];
      if (cancelled) return;
      setPlaces(near);
      setOnline(consults);
    })().catch(() => !cancelled && setPlaces([]));
    return () => {
      cancelled = true;
    };
  }, [coords]);

  const todayBit = todayScheduleBit();

  return (
    <View style={styles.wrap}>
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

        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          style={[styles.seeAll, { borderTopColor: theme.hairline }]}
        >
          <Icon name="mappin.circle.fill" size={16} tintColor={theme.brandPressed} />
          <ThemedText type="callout" style={[styles.bold, { color: theme.brandPressed, flex: 1 }]}>
            {places?.length ? t('See all clinics on the map') : t('Find a clinic near you')}
          </ThemedText>
          <Icon name="chevron.right" size={14} tintColor={theme.textSecondary} />
        </Pressable>
      </Card>

      {online.length ? (
        <Card padded={false} style={styles.card}>
          <View style={styles.head}>
            <View style={styles.titleRow}>
              <Icon name="video.fill" size={16} tintColor={theme.brand} />
              <ThemedText type="headline">{t('Or consult online')}</ThemedText>
            </View>
            <ThemedText type="footnote" themeColor="textSecondary">
              {places?.length
                ? t('The nearest dermatologist is {{distance}} away. These dermatologists also see patients by video call.', {
                    distance: formatDistance(places[0].distance),
                  })
                : t('These dermatologists see patients by video call.')}
            </ThemedText>
          </View>
          {online.map((o) => (
            <Pressable
              key={o.doctor.id}
              onPress={() => openWebsite(o.url)}
              disabled={!isOnline}
              accessibilityRole="link"
              accessibilityLabel={t('Book an online consult with {{name}} on {{platform}}', {
                name: o.doctor.name,
                platform: o.platformName,
              })}
              style={[styles.row, { borderTopColor: theme.hairline }, !isOnline && styles.disabled]}
            >
              <View style={styles.rowMain}>
                <ThemedText type="callout" style={styles.bold} numberOfLines={1}>
                  {o.doctor.name}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                  {[o.platformName, o.fee != null ? formatFee(o.fee) : null].filter(Boolean).join(' · ')}
                </ThemedText>
              </View>
              <Icon name="arrow.up.right" size={14} tintColor={theme.brandPressed} />
            </Pressable>
          ))}
        </Card>
      ) : null}
      {phone.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.md },
  card: { overflow: 'hidden' },
  head: { padding: Space.base, gap: Space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
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
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  disabled: { opacity: 0.5 },
});

import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useConnectivity } from '@/hooks/use-connectivity';
import type { Coords } from '@/hooks/use-location';
import {
  DEFAULT_COORDS,
  fetchConditions,
  getCachedConditions,
  type Conditions,
} from '@/lib/weather';

type Place = { coords: Coords; usingDefault: boolean; name: string | null };

export type CurrentConditions = {
  /** `hidden` when offline or the fetch failed - the card simply isn't rendered. */
  status: 'hidden' | 'loading' | 'ready';
  data: Conditions | null;
  /** Reverse-geocoded city, or null (show "Your location" / "Metro Manila"). */
  placeName: string | null;
  usingDefault: boolean;
  /** Ask for location permission, then refetch for the user's own position. */
  requestLocation: () => Promise<void>;
};

const RETRY_MS = 30_000;

// Resolved once per app session; GPS doesn't need to be re-read on every tab visit.
let placeMemo: Place | null = null;

let placePending: Promise<Place> | null = null;

function resolvePlace(): Promise<Place> {
  if (placeMemo) return Promise.resolve(placeMemo);
  placePending ??= lookUpPlace().finally(() => {
    placePending = null;
  });
  return placePending;
}

async function lookUpPlace(): Promise<Place> {
  const fallback: Place = { coords: DEFAULT_COORDS, usingDefault: true, name: null };
  try {
    // Check only - never prompt from here. The prompt is behind "Use my location".
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return fallback;
    const position =
      (await Location.getLastKnownPositionAsync().catch(() => null)) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    let name: string | null = null;
    if (Platform.OS !== 'web') {
      try {
        const [geo] = await Location.reverseGeocodeAsync(coords);
        name = geo?.city ?? geo?.subregion ?? geo?.region ?? null;
      } catch {
        // No geocoder available - the card falls back to "Your location".
      }
    }
    placeMemo = { coords, usingDefault: false, name };
    return placeMemo;
  } catch {
    return fallback;
  }
}

export function useCurrentConditions(): CurrentConditions {
  const { isOnline } = useConnectivity();
  const [place, setPlace] = useState<Place | null>(placeMemo);
  const [data, setData] = useState<Conditions | null>(() =>
    placeMemo ? getCachedConditions(placeMemo.coords) ?? null : null
  );
  const [failed, setFailed] = useState(false);
  // Bumped to force a reload (foreground return, location granted).
  const [reloadKey, setReloadKey] = useState(0);

  // (Re)load whenever we come online or a reload is requested. fetchConditions
  // serves from its 15-min cache, so a reload with fresh data costs nothing.
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const next = await resolvePlace();
        if (cancelled) return;
        setPlace(next);
        const conditions = await fetchConditions(next.coords);
        if (cancelled) return;
        setData(conditions);
        setFailed(false);
      } catch (e) {
        if (cancelled) return;
        if (__DEV__) console.warn('[conditions] fetch failed', e);
        // Keep showing the last good reading if there is one; otherwise hide and
        // try again shortly - one stalled request shouldn't hide the card for the session.
        setFailed(true);
        retryTimer = setTimeout(() => setReloadKey((k) => k + 1), RETRY_MS);
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isOnline, reloadKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setReloadKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
    } catch {
      return;
    }
    placeMemo = null;
    setReloadKey((k) => k + 1);
  }, []);

  const status: CurrentConditions['status'] =
    !isOnline ? 'hidden' : data ? 'ready' : failed ? 'hidden' : 'loading';

  return {
    status,
    data: status === 'ready' ? data : null,
    placeName: place?.name ?? null,
    usingDefault: place?.usingDefault ?? true,
    requestLocation,
  };
}

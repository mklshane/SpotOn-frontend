import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

export type Coords = { latitude: number; longitude: number };
export type LocationStatus = 'idle' | 'granted' | 'denied';

/**
 * Foreground GPS fix. Works fully offline - only map tiles need connectivity.
 * `retry` asks again (or opens Settings when the OS won't show the prompt any more), for a
 * "Turn on location" action on screens that sort by distance.
 */
export function useLocation(): { coords: Coords | null; status: LocationStatus; retry: () => void } {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setCanAskAgain(res.canAskAgain !== false);
      if (res.status !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('granted');
      try {
        const position = await Location.getCurrentPositionAsync({});
        if (!cancelled) {
          setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        }
      } catch {
        // GPS fix unavailable - leave coords null, callers fall back to a name-sorted list.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    if (status === 'denied' && !canAskAgain) {
      // Throws synchronously on web, where there is no Settings app to open.
      try {
        Linking.openSettings().catch(() => {});
      } catch {}
    } else setAttempt((a) => a + 1);
  }, [status, canAskAgain]);

  return { coords, status, retry };
}

/**
 * The device's position ONLY if location access was already granted - never prompts. For detail
 * screens that merely enrich with a distance; the directory list owns the permission request.
 * Prefers the cached last-known fix (instant, offline) over waiting on a fresh GPS lock.
 */
export function useKnownLocation(): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos =
          (await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({}));
        if (!cancelled && pos) {
          setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      } catch {
        // No fix - the screen just omits the distance.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return coords;
}

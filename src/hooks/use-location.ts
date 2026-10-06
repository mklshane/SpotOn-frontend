import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Coords = { latitude: number; longitude: number };
export type LocationStatus = 'idle' | 'granted' | 'denied';

/** Foreground GPS fix. Works fully offline - only map tiles need connectivity. */
export function useLocation(): { coords: Coords | null; status: LocationStatus } {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission !== 'granted') {
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
  }, []);

  return { coords, status };
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

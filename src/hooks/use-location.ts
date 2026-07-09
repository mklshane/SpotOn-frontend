import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Coords = { latitude: number; longitude: number };
export type LocationStatus = 'idle' | 'granted' | 'denied';

/** Foreground GPS fix. Works fully offline — only map tiles need connectivity. */
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
        // GPS fix unavailable — leave coords null, callers fall back to a name-sorted list.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { coords, status };
}

/**
 * Opt-in diagnostics for builds where there is no console.
 *
 * The deployed web replica has no telemetry, and on a phone browser there is no practical way to
 * open a console - so a tester hitting an error could report nothing beyond the message on screen.
 * `?debug=1` turns detail on and remembers it; `?debug=0` clears it. Always on in development.
 *
 * ORDERING MATTERS. The URL parameter must be read while it is still in the address bar: most
 * consumers (image-quality, classify) are lazily imported, and by the time they first evaluate,
 * expo-router has navigated and the query is gone. So `captureDebugFlag()` is called once from the
 * root layout at boot, and everything else asks `isDebug()`, which reads the persisted value.
 *
 * Never gate anything that changes RESULTS on this - it reveals what happened, it does not alter
 * behaviour.
 */
import { Platform } from 'react-native';

const KEY = 'spoton.debug';

function storage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null; // private mode
  }
}

/** In-memory mirror, so the flag survives a browser that refuses storage. */
let sessionFlag = false;

/**
 * Read `?debug=` and persist it. Call once, as early as possible - see the ordering note above.
 */
export function captureDebugFlag(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  let param: string | null = null;
  try {
    param = new URLSearchParams(window.location.search).get('debug');
  } catch {
    return;
  }
  if (param === '1') {
    sessionFlag = true;
    storage()?.setItem(KEY, '1');
  } else if (param === '0') {
    sessionFlag = false;
    try {
      storage()?.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  }
}

/** Whether diagnostics are on right now. Cheap; safe to call from any module at any time. */
export function isDebug(): boolean {
  if (__DEV__) return true;
  if (sessionFlag) return true;
  try {
    return storage()?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Android hardware/gesture back, for screens that cannot use the default pop.
 *
 * `gestureEnabled: false` in the stack layout only silences the iOS back-SWIPE. Android's system
 * back is a different mechanism and ignores it entirely, so a screen that has deliberately taken
 * over its own back behaviour still gets popped out from under the user there. That is not a
 * theoretical gap: the result screen exits the capture flow on back, and without this the Android
 * button walked straight into the reset session underneath — the same bug the header fix addressed,
 * arriving by a different route.
 *
 * Pass a handler to run instead of the default pop, or `null` to leave the default alone, so a
 * screen can opt in conditionally without breaking the rules of hooks.
 *
 * The handler is held in a ref and read at press time, so callers do not have to memoize it and an
 * inline arrow does not resubscribe on every render; only switching between handling and not
 * re-registers. Bound to focus, so a screen sitting in the background never intercepts the button
 * for whichever screen is on top.
 *
 * No-op on every other platform — iOS has no hardware back, and web's browser back is the router's
 * own concern.
 */
export function useAndroidBack(handler: (() => void) | null): void {
  const ref = useRef(handler);
  // Written in an effect rather than during render: a ref write during render is a React-compiler
  // error, and the timing is irrelevant here — the effect runs long before anyone can press a
  // button.
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  const active = handler != null;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !active) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        ref.current?.();
        return true; // handled — do not also pop the stack
      });
      return () => sub.remove();
    }, [active]),
  );
}

/**
 * Swallow Android's back button entirely, for screens where going back is not a valid move — mid
 * inference, say. Every such screen offers its own explicit way out, so this blocks a silent,
 * destructive exit rather than trapping anyone. The iOS counterpart is the `gestureEnabled: false`
 * those same screens already declare in scan/_layout.tsx.
 */
export function useBlockAndroidBack(active = true): void {
  useAndroidBack(active ? NOOP : null);
}

const NOOP = () => {};

import * as Linking from 'expo-linking';
import { openBrowserAsync } from 'expo-web-browser';

import { normalizeUrl } from './directory-core';

export { normalizeUrl, splitPhones, type PhoneOption } from './directory-core';

/** Dial one already-normalized number (see splitPhones / usePhoneCall for free-text fields). */
export function callNumber(dial: string): void {
  Linking.openURL(`tel:${dial}`).catch(() => {});
}

/**
 * Open a listing URL in the in-app browser. Returns false when the URL is unusable, so callers
 * can hide the button up front with `normalizeUrl(url) != null` instead of showing one that
 * silently does nothing. Falls back to the system browser if the in-app one fails.
 */
export function openWebsite(raw: string): boolean {
  const url = normalizeUrl(raw);
  if (!url) return false;
  openBrowserAsync(url).catch(() => {
    Linking.openURL(url).catch(() => {});
  });
  return true;
}

export function openDirections(opts: {
  googleMapsUrl?: string | null;
  latitude: number;
  longitude: number;
}): void {
  const url =
    normalizeUrl(opts.googleMapsUrl) ??
    `https://www.google.com/maps/dir/?api=1&destination=${opts.latitude},${opts.longitude}`;
  Linking.openURL(url).catch(() => {});
}

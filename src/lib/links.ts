import * as Linking from 'expo-linking';
import { openBrowserAsync } from 'expo-web-browser';

export function callNumber(phone: string): void {
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {});
}

export function openWebsite(url: string): void {
  openBrowserAsync(url).catch(() => {});
}

export function openDirections(opts: {
  googleMapsUrl?: string | null;
  latitude: number;
  longitude: number;
}): void {
  const url =
    opts.googleMapsUrl || `https://www.google.com/maps/dir/?api=1&destination=${opts.latitude},${opts.longitude}`;
  Linking.openURL(url).catch(() => {});
}

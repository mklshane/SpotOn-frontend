import type { Locale } from './core';
const KEY = 'spoton.preferred_language';
/** Independent of SQLite/WASM startup, and safe during static web rendering. */
export async function readLocale(): Promise<Locale> {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(KEY) === 'fil' ? 'fil' : 'en';
}
export async function writeLocale(locale: Locale): Promise<void> {
  window.localStorage.setItem(KEY, locale);
}

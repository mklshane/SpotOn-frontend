import { getMeta, setMeta } from '@/data/db';
import type { Locale } from './core';
const KEY = 'preferred_language';
export async function readLocale(): Promise<Locale> {
  return (await getMeta(KEY)) === 'fil' ? 'fil' : 'en';
}
export async function writeLocale(locale: Locale): Promise<void> {
  await setMeta(KEY, locale);
}

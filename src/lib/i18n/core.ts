import tagalog from './fil.json';

export type Locale = 'en' | 'fil';
export type Message = keyof typeof tagalog;
export type Parameters = Record<string, string | number>;
let locale: Locale = 'en';
const listeners = new Set<() => void>();
export const getLocale = (): Locale => locale;
export const getIntlLocale = () => locale === 'fil' ? 'fil-PH' : 'en-PH';
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Called only after loading/saving the device preference. No clinical data is changed. */
export function applyLocale(next: Locale) {
  if (locale === next) return;
  locale = next;
  listeners.forEach((listener) => listener());
}
/** Source-keyed, offline catalog. Parameters are inserted once, never re-translated. */
export function translate(source: string, params?: Parameters, language: Locale = locale): string {
  const text = language === 'fil' && Object.hasOwn(tagalog, source)
    ? tagalog[source as Message] : source;
  return params ? text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match) : text;
}
export const t = translate;

/**
 * Lazy display copy for app-authored, immutable dictionaries only. Never pass a profile,
 * clinic record, answer, or other user/server data here. Getters let existing exported
 * content arrays read the current language without changing their IDs or module identity.
 * String arrays are handled by their parent getter. Callers subscribe with useLocale().
 */
export function localizedCopy<T>(source: T): T {
  if (typeof source === 'string') return translate(source) as T;
  if (!source || typeof source !== 'object') return source;
  const result = (Array.isArray(source) ? [] : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      Object.defineProperty(result, key, { enumerable: true, configurable: true, get: () => translate(value) });
    } else {
      result[key] = localizedCopy(value);
    }
  }
  return result as T;
}

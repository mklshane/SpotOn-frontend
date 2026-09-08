import tagalog from './fil.json';
import additions from './fil-additions.json';

const catalog = { ...tagalog, ...additions };
// JSX decodes entities and folds indentation before text reaches a display site.
const canonical = (text: string) => text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const normalizedCatalog = new Map(Object.entries(catalog).map(([key, value]) => [canonical(key), value]));

export type Locale = 'en' | 'fil';
export type Message = keyof typeof catalog;
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
  const translated = language === 'fil'
    ? (Object.hasOwn(catalog, source) ? catalog[source as Message] : normalizedCatalog.get(canonical(source)))
    : undefined;
  const text = translated === undefined ? source :
    Object.hasOwn(catalog, source) ? translated :
      (source.match(/^\s*/)?.[0] ?? '') + translated + (source.match(/\s*$/)?.[0] ?? '');
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
  // A primitive cannot expose a lazy getter. Keep it as source copy and translate
  // at the display site; otherwise module-level disclaimers freeze at startup.
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object') return source;
  const result = (Array.isArray(source) ? [] : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (['id', 'key', 'value', 'code', 'kind', 'url', 'href', 'imageId', 'region'].includes(key)) {
      result[key] = value;
    } else if (typeof value === 'string') {
      Object.defineProperty(result, key, { enumerable: true, configurable: true, get: () => translate(value) });
    } else {
      result[key] = localizedCopy(value);
    }
  }
  return result as T;
}

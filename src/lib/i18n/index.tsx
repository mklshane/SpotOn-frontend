import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { applyLocale, getLocale, subscribeLocale, type Locale } from './core';
import { readLocale, writeLocale } from './storage';
export { t, translate, localizedCopy, getIntlLocale, getLocale } from './core';
export type { Locale } from './core';
const serverLocale = (): Locale => 'en';
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, serverLocale);
}
let loading: Promise<void> | undefined;
export function loadLanguage(): Promise<void> {
  loading ??= readLocale().then(applyLocale).catch(() => { /* English remains usable if storage fails. */ });
  return loading;
}
let saving: Promise<void> = Promise.resolve();
/** Serialize changes; failed persistence leaves the current language intact. */
export function setLanguage(next: Locale): Promise<void> {
  const operation = saving.catch(() => {}).then(async () => {
    await loadLanguage();
    // Update the live UI first. Browser privacy modes can make storage unavailable;
    // that should never prevent the current page from changing language.
    applyLocale(next);
    try {
      await writeLocale(next);
    } catch {
      // The choice remains active for this session; the next launch falls back to English.
    }
    // Keep native notification content in sync without restarting its due date.
    if (Platform.OS !== 'web') {
      const { refreshReminderLanguage } = await import('../notifications');
      await refreshReminderLanguage();
    }
  });
  saving = operation;
  return operation;
}
export function LanguageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const locale = useLocale();
  useEffect(() => { let active = true; loadLanguage().then(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);
  return ready ? children : null;
}

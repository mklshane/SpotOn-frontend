/**
 * Web stand-in for expo-secure-store — localStorage, which is NOT secure storage.
 *
 * expo-secure-store has no web implementation: there is no browser equivalent of the iOS
 * Keychain, so anything stored here is readable by any script on the origin and survives in
 * plain text on the tester's disk.
 *
 * THIS IS ACCEPTABLE ONLY BECAUSE THE WEB BUILD EXISTS FOR REMOTE UX TESTING WITH THROWAWAY
 * ACCOUNTS. Do not point the web build at production auth, and do not let it hold real patient
 * data — auth-api.ts puts access/refresh tokens and the cached profile (name, email, phone)
 * through here, all of which app.json declares as collected personal data.
 *
 * Keys are namespaced so they can't collide with anything else the origin stores.
 */
const NS = 'spoton.ss.';

/** localStorage throws in private mode and when cookies are blocked; never break the app over it. */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return store()?.getItem(NS + key) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    store()?.setItem(NS + key, value);
  } catch (e) {
    console.warn('[secure-store.web] could not persist', key, e);
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    store()?.removeItem(NS + key);
  } catch {
    // Nothing to do — a key we can't remove is a key we probably never wrote.
  }
}

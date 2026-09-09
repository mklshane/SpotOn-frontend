/**
 * Secure key/value storage.
 *
 * Native re-exports `expo-secure-store` verbatim (Keychain / EncryptedSharedPreferences), so
 * behaviour on device is unchanged. The web build resolves `secure-store.web.ts` instead -
 * see that file for why the web replica is test-only.
 *
 * Only the three calls auth-api.ts actually makes are re-exported; widen deliberately.
 */
export { getItemAsync, setItemAsync, deleteItemAsync } from 'expo-secure-store';

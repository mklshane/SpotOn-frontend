import * as SecureStore from './secure-store';

import { api, setAuthRefreshHandler, setAuthTokenProvider } from '@/api/client';
import type { UserProfile } from '@/api/types';
import { setMeta } from '@/data/db';

import { cancelSelfCheckReminder } from './notifications';
import { accountStorageKey, getActiveAccountId, setActiveAccountId } from './account-scope';
import { STORAGE_KEYS } from './storage-keys';

const ACCESS_KEY = 'spoton.access';
const REFRESH_KEY = 'spoton.refresh';
const ACTIVE_ACCOUNT_KEY = 'spoton.account';
const LEGACY_PROFILE_KEY = 'spoton.profile';
const profileKey = (userId: string) => `spoton.profile.${userId}`;

export type TokenOut = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
};

export type RegisterInput = {
  password: string;
  email?: string;
  phone?: string;
  full_name?: string;
  consent?: boolean;
};

// In-memory cache (source of truth during a session); mirrored to SecureStore.
let accessToken: string | null = null;
let refreshToken: string | null = null;

async function persist(tokens: TokenOut): Promise<void> {
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  setActiveAccountId(tokens.user.id);
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
  await SecureStore.setItemAsync(ACTIVE_ACCOUNT_KEY, tokens.user.id);
  await SecureStore.setItemAsync(profileKey(tokens.user.id), JSON.stringify(tokens.user));
  await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
}

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  let accountId = await SecureStore.getItemAsync(ACTIVE_ACCOUNT_KEY);

  // Upgrade the old single global profile cache without letting a later account read it.
  if (!accountId) {
    const legacy = await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    if (legacy) {
      try {
        const profile = JSON.parse(legacy) as UserProfile;
        if (profile.id) {
          accountId = profile.id;
          await SecureStore.setItemAsync(ACTIVE_ACCOUNT_KEY, profile.id);
          await SecureStore.setItemAsync(profileKey(profile.id), legacy);
        }
      } catch {
        // An unreadable cache is disposable; the authenticated /me refresh remains authoritative.
      }
      await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
    }
  }
  setActiveAccountId(accountId);
  if (!accessToken) {
    await clearTokens();
    return false;
  }
  return true;
}

/** Whether an access token is currently held in memory (after loadTokens/persist). */
export function hasTokens(): boolean {
  return accessToken != null;
}

export async function clearTokens(): Promise<void> {
  const accountId = getActiveAccountId() ?? await SecureStore.getItemAsync(ACTIVE_ACCOUNT_KEY);
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(ACTIVE_ACCOUNT_KEY);
  await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
  if (accountId) await SecureStore.deleteItemAsync(profileKey(accountId));
  setActiveAccountId(null);
}

/** The last authenticated profile, cached for offline-first startup (PII → SecureStore). */
export async function loadCachedProfile(): Promise<UserProfile | null> {
  try {
    const accountId = getActiveAccountId() ?? await SecureStore.getItemAsync(ACTIVE_ACCOUNT_KEY);
    if (!accountId) return null;
    const raw = await SecureStore.getItemAsync(profileKey(accountId));
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

/** Persist the latest authenticated profile (e.g. after profile completion / refresh). */
export async function cacheProfile(user: UserProfile): Promise<void> {
  setActiveAccountId(user.id);
  await SecureStore.setItemAsync(ACTIVE_ACCOUNT_KEY, user.id);
  await SecureStore.setItemAsync(profileKey(user.id), JSON.stringify(user));
  await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
}

export async function clearCachedProfile(): Promise<void> {
  const accountId = getActiveAccountId() ?? await SecureStore.getItemAsync(ACTIVE_ACCOUNT_KEY);
  if (accountId) await SecureStore.deleteItemAsync(profileKey(accountId));
  await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
}

/**
 * Wipes every local trace of the current account: auth tokens, cached profile,
 * and app-scoped local preferences (onboarding-seen, notification prefs).
 * Called before `signOut()` when an account is deleted, so a fresh install/login
 * on the same device never inherits a deleted account's stray local flags.
 * Does NOT touch the directory sync cache (facilities/doctors) - that data isn't
 * user-specific.
 */
export async function clearAllLocalData(): Promise<void> {
  const accountId = getActiveAccountId();
  // Reminder metadata is account-scoped, and cancellation must happen while that scope is active.
  await cancelSelfCheckReminder().catch(() => {});
  if (accountId) {
    await setMeta(accountStorageKey(accountId, STORAGE_KEYS.reengagementRemindersEnabled), '');
  }
  await setMeta(STORAGE_KEYS.hasSeenOnboarding, '');
  await clearTokens();
}

export async function register(input: RegisterInput): Promise<TokenOut> {
  const tokens = await api.post<TokenOut>('/auth/register', input, false);
  await persist(tokens);
  return tokens;
}

export async function login(identifier: string, password: string): Promise<TokenOut> {
  const tokens = await api.post<TokenOut>('/auth/login', { identifier, password }, false);
  await persist(tokens);
  return tokens;
}

/** Exchange the stored refresh token for a fresh access token. Returns it, or null. */
export async function refresh(): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const tokens = await api.post<TokenOut>('/auth/refresh', { refresh_token: refreshToken }, false);
    await persist(tokens);
    return tokens.access_token;
  } catch {
    await cancelSelfCheckReminder().catch(() => {});
    await clearTokens();
    return null;
  }
}

export async function logout(): Promise<void> {
  const rt = refreshToken;
  // Never leave Account A's lesion reminder armed after Account B takes over the device.
  await cancelSelfCheckReminder().catch(() => {});
  await clearTokens();
  if (rt) {
    try {
      await api.post('/auth/logout', { refresh_token: rt }, false);
    } catch {
      // best-effort server-side revoke
    }
  }
}

// Wire the API client to our token store (once, on first import).
setAuthTokenProvider(() => accessToken);
setAuthRefreshHandler(() => refresh());

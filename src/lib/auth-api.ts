import * as SecureStore from 'expo-secure-store';

import { api, setAuthRefreshHandler, setAuthTokenProvider } from '@/api/client';
import type { UserProfile } from '@/api/types';

const ACCESS_KEY = 'spoton.access';
const REFRESH_KEY = 'spoton.refresh';
const PROFILE_KEY = 'spoton.profile';

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
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(tokens.user));
}

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  return Boolean(accessToken);
}

/** Whether an access token is currently held in memory (after loadTokens/persist). */
export function hasTokens(): boolean {
  return accessToken != null;
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(PROFILE_KEY);
}

/** The last authenticated profile, cached for offline-first startup (PII → SecureStore). */
export async function loadCachedProfile(): Promise<UserProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

/** Persist the latest authenticated profile (e.g. after profile completion / refresh). */
export async function cacheProfile(user: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(user));
}

export async function clearCachedProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(PROFILE_KEY);
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
    await clearTokens();
    return null;
  }
}

export async function logout(): Promise<void> {
  const rt = refreshToken;
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

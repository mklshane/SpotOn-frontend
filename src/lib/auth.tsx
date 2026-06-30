import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/api/client';
import type { UserProfile } from '@/api/types';

import * as authApi from './auth-api';
import { fetchProfile } from './profile';

type AuthResult = { error: string | null };

type AuthContextValue = {
  user: UserProfile | null;
  /** True until the initial token restore completes. */
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthResult>;
  signUp: (input: authApi.RegisterInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  setUser: (user: UserProfile | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function messageFor(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Mirror the profile to encrypted storage so it survives restarts (offline-first).
  const setUser = useCallback((u: UserProfile | null) => {
    setUserState(u);
    if (u) void authApi.cacheProfile(u);
    else void authApi.clearCachedProfile();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hasStored = await authApi.loadTokens();
      if (!hasStored) {
        if (mounted) setLoading(false);
        return;
      }

      // Offline-first: restore the cached profile immediately so a logged-in user is never
      // kicked out just because the network is unavailable. Unblock the UI without waiting.
      const cached = await authApi.loadCachedProfile();
      if (cached && mounted) {
        setUserState(cached);
        setLoading(false);
      }

      // Refresh from the server (background if we already restored a cache; blocking otherwise).
      try {
        const me = await fetchProfile(); // refreshes the access token on 401
        if (mounted) setUserState(me);
        await authApi.cacheProfile(me);
      } catch {
        // If the refresh failed the session is gone (tokens cleared) → log out. Otherwise it's
        // just offline — keep the cached profile so the user stays signed in.
        if (!authApi.hasTokens() && mounted) setUserState(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      setUser,
      signIn: async (identifier, password) => {
        try {
          const tokens = await authApi.login(identifier, password);
          setUserState(tokens.user); // login() already cached the profile via persist()
          return { error: null };
        } catch (e) {
          return { error: messageFor(e) };
        }
      },
      signUp: async (input) => {
        try {
          const tokens = await authApi.register(input);
          setUserState(tokens.user);
          return { error: null };
        } catch (e) {
          return { error: messageFor(e) };
        }
      },
      signOut: async () => {
        await authApi.logout(); // clears tokens + cached profile
        setUserState(null);
      },
    }),
    [user, loading, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hasTokens = await authApi.loadTokens();
      if (hasTokens) {
        try {
          const me = await fetchProfile(); // refreshes the access token on 401
          if (mounted) setUser(me);
        } catch {
          await authApi.clearTokens();
        }
      }
      if (mounted) setLoading(false);
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
          setUser(tokens.user);
          return { error: null };
        } catch (e) {
          return { error: messageFor(e) };
        }
      },
      signUp: async (input) => {
        try {
          const tokens = await authApi.register(input);
          setUser(tokens.user);
          return { error: null };
        } catch (e) {
          return { error: messageFor(e) };
        }
      },
      signOut: async () => {
        await authApi.logout();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

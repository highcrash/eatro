import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AdminUser {
  sub: string;
  email: string;
  role: 'OWNER' | 'STAFF';
  exp: number;
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  setAuth: (token: string, user: AdminUser) => void;
  clearAuth: () => void;
}

/**
 * Auth state persisted to localStorage. License admin is an entirely
 * separate origin from the Restora POS main admin, so we use our own
 * storage key (`license-admin-auth`) — no risk of cross-contamination.
 *
 * Token is short-lived (8h by default on the server). On expiry the
 * api.ts client sees a 401, clears the store, and the App re-renders
 * into the <LoginPage />.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    {
      name: 'license-admin-auth',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Decode a JWT payload without verifying the signature (server does that). */
export function decodeJwt(token: string): AdminUser | null {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

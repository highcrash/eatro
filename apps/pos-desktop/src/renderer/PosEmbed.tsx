import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PosApp from '@pos/App';
import { useAuthStore } from '@pos/store/auth.store';
import type { SessionUser } from './desktop-api';

/**
 * Embeds the full apps/pos React tree. Runs in:
 *   - <MemoryRouter> (not BrowserRouter) so url bar interactions from the
 *     Electron shell don't affect navigation
 *   - its own QueryClient so desktop-level caches (printer list, sync) stay
 *     independent of POS data queries
 *
 * Before rendering, we seed apps/pos's auth store with the Desktop session.
 * The desktop fetch-shim is already installed at this point, so access
 * tokens passed here are dummy — main attaches real Authorization headers.
 *
 * Auth-store re-seeding: the web POS's api.ts clears auth on certain 401s.
 * The desktop's api-proxy refreshes tokens transparently so POS shouldn't
 * see a 401, but if something slips through we re-seed the store instead of
 * bouncing to the lock screen — the desktop session is the source of truth
 * here.
 */
interface Props {
  user: SessionUser;
  onSignOutRequested: () => void;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function seedPosAuth(user: SessionUser): void {
  useAuthStore.setState({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as any,
      branchId: user.branchId,
      branchName: user.branchName,
    },
    accessToken: 'desktop-managed',
    refreshToken: 'desktop-managed',
    isAuthenticated: true,
  });
}

export function PosEmbed({ user, onSignOutRequested }: Props): JSX.Element {
  // Track the caller's latest callback without re-running the subscription.
  const signOutRef = React.useRef(onSignOutRequested);
  signOutRef.current = onSignOutRequested;

  // Track whether the desktop user has explicitly signed out. Only then is
  // a clearAuth a real sign-out; everything else is an unwanted side effect
  // we should repair by re-seeding.
  const userIntentsSignOutRef = React.useRef(false);

  // Seed synchronously on mount + whenever user changes. We don't rely on a
  // useEffect for the initial seed because PosApp renders immediately and
  // would flash its own LoginPage if we were a tick late.
  seedPosAuth(user);

  React.useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (prev.isAuthenticated && !state.isAuthenticated) {
        if (userIntentsSignOutRef.current) {
          signOutRef.current();
        } else {
          // POS cleared its own auth mid-session. Re-seed silently.
          console.warn('[PosEmbed] POS clearAuth intercepted — re-seeding from desktop session');
          seedPosAuth(user);
        }
      }
    });
    return unsub;
  }, [user]);

  // Expose a tiny global flag so the DesktopMenu's Sign Out flow can mark the
  // next clearAuth as "intended" right before calling window.desktop.session.signout().
  React.useEffect(() => {
    (window as unknown as { __desktopMarkSignOut?: () => void }).__desktopMarkSignOut = () => {
      userIntentsSignOutRef.current = true;
    };
    return () => {
      delete (window as unknown as { __desktopMarkSignOut?: () => void }).__desktopMarkSignOut;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosApp />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

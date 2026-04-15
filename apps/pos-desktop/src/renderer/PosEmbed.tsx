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
 */
interface Props {
  user: SessionUser;
  onSignOutRequested: () => void;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export function PosEmbed({ user, onSignOutRequested }: Props): JSX.Element {
  // Seed POS auth state once per user. Using setState synchronously before
  // the children render avoids a flash of LoginPage.
  useAuthStore.setState({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as any,
      branchId: user.branchId,
      branchName: user.branchName,
    },
    // Dummy tokens — real ones live in Electron main. Present so any
    // code path that guards on their presence is happy.
    accessToken: 'desktop-managed',
    refreshToken: 'desktop-managed',
    isAuthenticated: true,
  });

  // If POS signs itself out (e.g. 401 cascade), bounce back to the
  // desktop lock screen instead of POS's own LoginPage.
  React.useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (prev.isAuthenticated && !state.isAuthenticated) onSignOutRequested();
    });
    return unsub;
  }, [onSignOutRequested]);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosApp />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

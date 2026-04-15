import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PosApp from '@pos/App';
import { useAuthStore } from '@pos/store/auth.store';
import type { SessionUser } from './desktop-api';
import { OfflineErrorBoundary } from './OfflineErrorBoundary';

/**
 * Embeds the full apps/pos React tree and publishes `window.__desktop` so
 * the POS's sidebar can render Desktop-only actions (Change PIN, Printer
 * Settings, Sync, Unpair, Sign Out) without the POS knowing about Electron.
 *
 * apps/pos reads `window.__desktop` and renders accordingly; in the browser
 * build the global is undefined so those menu items disappear.
 *
 * Auth-store re-seeding: the web POS's api.ts clears auth on certain 401s.
 * The desktop's api-proxy refreshes tokens transparently so POS shouldn't
 * see a 401, but if something slips through we re-seed the store instead of
 * bouncing to the lock screen — the desktop session is the source of truth.
 */
interface Props {
  user: SessionUser;
  appVersion: string;
  onSignOutRequested: () => void;
  onOpenChangePin: () => void;
  onOpenPrinterSettings: () => void;
  onOpenSyncPanel: () => void;
  onOpenDiagnostics: () => void;
  onRequestUnpair: () => void;
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

export function PosEmbed(props: Props): JSX.Element {
  const { user } = props;

  const refs = React.useRef(props);
  refs.current = props;

  // True when the current clearAuth should actually bounce us out (vs being
  // a spurious POS refresh-cascade that we silently repair).
  const userIntentsSignOutRef = React.useRef(false);

  // Seed synchronously on render so PosApp never flashes its own LoginPage.
  seedPosAuth(user);

  // Publish the desktop bridge globals for apps/pos to read.
  React.useEffect(() => {
    const bridge = {
      appVersion: props.appVersion,
      cashierRole: user.role,
      cashierName: user.name,
      terminalBranch: user.branchName,
      signOut: () => {
        userIntentsSignOutRef.current = true;
        refs.current.onSignOutRequested();
      },
      openChangePin: () => refs.current.onOpenChangePin(),
      openPrinterSettings: () => refs.current.onOpenPrinterSettings(),
      openSyncPanel: () => refs.current.onOpenSyncPanel(),
      openDiagnostics: () => refs.current.onOpenDiagnostics(),
      requestUnpair: () => refs.current.onRequestUnpair(),
    };
    (window as unknown as { __desktop?: typeof bridge }).__desktop = bridge;
    (window as unknown as { __desktopMarkSignOut?: () => void }).__desktopMarkSignOut = () => {
      userIntentsSignOutRef.current = true;
    };
    return () => {
      delete (window as unknown as { __desktop?: unknown }).__desktop;
      delete (window as unknown as { __desktopMarkSignOut?: unknown }).__desktopMarkSignOut;
    };
  }, [props.appVersion, user.role, user.name, user.branchName]);

  React.useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (prev.isAuthenticated && !state.isAuthenticated) {
        if (userIntentsSignOutRef.current) {
          userIntentsSignOutRef.current = false;
          refs.current.onSignOutRequested();
        } else {
          // POS cleared its own auth mid-session. Re-seed silently.
          console.warn('[PosEmbed] POS clearAuth intercepted — re-seeding from desktop session');
          seedPosAuth(user);
        }
      }
    });
    return unsub;
  }, [user]);

  return (
    <OfflineErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PosApp />
        </MemoryRouter>
      </QueryClientProvider>
    </OfflineErrorBoundary>
  );
}

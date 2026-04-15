import { useEffect, useState } from 'react';

/**
 * Single source of truth for "should we allow online-only UI actions?"
 *
 * Inside the desktop shell the Electron main process owns connection
 * probing; it publishes a typed `sync` bridge under `window.desktop` that
 * broadcasts status changes. Outside the desktop (browser preview, plain
 * POS tab) we fall back to `navigator.onLine`, which is coarser but
 * still prevents a cashier from tapping a coupon button with their laptop
 * lid closed.
 *
 * Components call this as `const online = useIsOnline()` and typically
 * gate a specific button + render a short "Needs internet" hint. See
 * <OfflineHint /> for the reusable visual.
 */

interface DesktopSync {
  status: () => Promise<{ online: boolean }>;
  onStatusChanged: (cb: (s: { online: boolean }) => void) => () => void;
}

interface DesktopWindow {
  desktop?: { sync?: DesktopSync };
}

function hasDesktopSync(): DesktopSync | null {
  const w = window as unknown as DesktopWindow;
  return w.desktop?.sync ?? null;
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    // Optimistic initial: trust navigator.onLine until the desktop bridge
    // reports a more precise status. Avoids a frame of "offline" at mount
    // when everything is actually fine.
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    const sync = hasDesktopSync();
    if (sync) {
      void sync.status().then((s) => setOnline(s.online));
      return sync.onStatusChanged((s) => setOnline(s.online));
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}

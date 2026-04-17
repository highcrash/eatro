import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import TableEntry from './pages/TableEntry';
import MenuPage from './pages/MenuPage';
import ItemPage from './pages/ItemPage';
import CartPage from './pages/CartPage';
import OrderStatusPage from './pages/OrderStatusPage';
import WifiGate, { type GatePayload } from './pages/WifiGate';
import { useSessionStore } from './store/session.store';
import { useCartStore } from './store/cart.store';
import { apiUrl } from './lib/api';

// Shown to a guest whose network can't be verified. Fail-closed: we don't
// reveal the menu while the server is unreachable or the branch is
// unknown — anyone could otherwise trivially bypass the gate by blocking
// a single request.
const NETWORK_ERROR_GATE: GatePayload = {
  allowed: false,
  gateEnabled: true,
  branchName: '',
  wifiSsid: null,
  wifiPass: null,
  message: 'Unable to verify your network. Connect to the restaurant Wi-Fi and try again.',
  clientIp: null,
};

// Periodic re-check interval. Catches the case where the owner changes
// the allowlist after a guest has already been allowed in — within
// GATE_POLL_MS the stale tab flips to the Wi-Fi gate page.
const GATE_POLL_MS = 30_000;

// Cross-component signal: when a QR API call 403s with the "restricted"
// message, we trigger an immediate gate re-check. Everyone else (cart,
// menu) subscribes to this so they don't have to plumb state up.
const GATE_RECHECK_EVENT = 'qr-gate-recheck';
export function triggerGateRecheck() {
  window.dispatchEvent(new Event(GATE_RECHECK_EVENT));
}

/**
 * Resolves the branchId that the gate should evaluate against, BEFORE
 * TableEntry runs. Three sources, in priority order:
 *   1. tableId from the URL → fetch /public/table/:tableId to get its branchId
 *   2. Persisted session (sessionStorage) — returning guest
 *   3. null (no branch known yet) → don't render anything
 */
function useResolvedBranchId(): string | null | 'resolving' {
  const sessionBranchId = useSessionStore((s) => s.branchId);
  const location = useLocation();
  const [resolved, setResolved] = useState<string | null | 'resolving'>(
    sessionBranchId ?? 'resolving',
  );

  const tableMatch = location.pathname.match(/^\/table\/([^/]+)/);
  const tableId = tableMatch?.[1] ?? null;

  useEffect(() => {
    if (sessionBranchId) { setResolved(sessionBranchId); return; }
    if (!tableId) { setResolved(null); return; }

    let cancelled = false;
    setResolved('resolving');
    fetch(apiUrl(`/public/table/${tableId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { branchId?: string } | null) => {
        if (cancelled) return;
        setResolved(data?.branchId ?? null);
      })
      .catch(() => { if (!cancelled) setResolved(null); });
    return () => { cancelled = true; };
  }, [sessionBranchId, tableId]);

  return resolved;
}

export default function QrOrderApp() {
  const resolvedBranchId = useResolvedBranchId();
  const [gate, setGate] = useState<GatePayload | null | 'loading'>(null);
  const clearCart = useCartStore((s) => s.clearCart);

  const checkGate = useCallback(async (branchId: string) => {
    try {
      const r = await fetch(apiUrl(`/public/qr-gate/${branchId}?t=${Date.now()}`), { cache: 'no-store' });
      const data = r.ok ? (await r.json() as GatePayload | null) : null;
      return data ?? NETWORK_ERROR_GATE;
    } catch {
      return NETWORK_ERROR_GATE;
    }
  }, []);

  // Initial + periodic gate check. Re-fires:
  //  - when branchId resolves
  //  - every GATE_POLL_MS (catches allowlist edits during a live session)
  //  - on the GATE_RECHECK_EVENT from a 403 elsewhere in the app
  //  - when the tab regains focus (standard "pause while hidden" UX)
  useEffect(() => {
    if (resolvedBranchId === null || resolvedBranchId === 'resolving') return;
    let cancelled = false;

    const run = async () => {
      setGate((g) => (g === null ? 'loading' : g));
      const next = await checkGate(resolvedBranchId);
      if (cancelled) return;
      // Flipping from allowed → blocked mid-session: wipe the cart so the
      // guest doesn't carry items they can no longer order.
      setGate((prev) => {
        if (prev && prev !== 'loading' && prev.allowed && !next.allowed) {
          clearCart();
        }
        return next;
      });
    };

    void run();
    const id = setInterval(() => void run(), GATE_POLL_MS);
    const onRecheck = () => void run();
    const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
    window.addEventListener(GATE_RECHECK_EVENT, onRecheck);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener(GATE_RECHECK_EVENT, onRecheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [resolvedBranchId, checkGate, clearCart]);

  if (resolvedBranchId === 'resolving') return <Checking />;
  if (resolvedBranchId === null) return <Checking />;
  if (gate === null || gate === 'loading') return <Checking />;
  if (!gate.allowed) {
    return <WifiGate payload={gate} onAllowed={() => setGate({ ...gate, allowed: true })} />;
  }

  return (
    <Routes>
      <Route path="/table/:tableId" element={<TableEntry />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/item/:itemId" element={<ItemPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/order/:orderId" element={<OrderStatusPage />} />
      <Route path="*" element={<Navigate to="/menu" replace />} />
    </Routes>
  );
}

function Checking() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-theme-bg text-theme-text">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-theme-accent border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-body text-theme-text-muted">Checking network…</p>
      </div>
    </div>
  );
}

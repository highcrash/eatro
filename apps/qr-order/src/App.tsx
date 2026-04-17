import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import TableEntry from './pages/TableEntry';
import MenuPage from './pages/MenuPage';
import ItemPage from './pages/ItemPage';
import CartPage from './pages/CartPage';
import OrderStatusPage from './pages/OrderStatusPage';
import WifiGate, { type GatePayload } from './pages/WifiGate';
import { useSessionStore } from './store/session.store';
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

/**
 * Resolves the branchId that the gate should evaluate against, BEFORE
 * TableEntry runs. Three sources, in priority order:
 *   1. tableId from the URL → fetch /public/table/:tableId to get its branchId
 *   2. Persisted session (sessionStorage) — returning guest
 *   3. null (no branch known yet) → don't render anything
 *
 * This is what lets us gate even /table/:tableId itself: we peek at the
 * table's branch without waiting for TableEntry to populate the session.
 */
function useResolvedBranchId(): string | null | 'resolving' {
  const sessionBranchId = useSessionStore((s) => s.branchId);
  const location = useLocation();
  const [resolved, setResolved] = useState<string | null | 'resolving'>(
    sessionBranchId ?? 'resolving',
  );

  // Extract tableId from /table/:tableId without depending on react-router's
  // route matching (which only fires AFTER render). We parse the path.
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

  // Fire the gate check as soon as we know the branchId — regardless of
  // which route the user landed on. Previously the check waited for
  // TableEntry to populate the session, which meant /table/:tableId
  // itself was exempt and TableEntry navigated to /menu before the
  // gate could block.
  useEffect(() => {
    if (resolvedBranchId === null || resolvedBranchId === 'resolving') return;
    let cancelled = false;
    setGate('loading');
    fetch(apiUrl(`/public/qr-gate/${resolvedBranchId}?t=${Date.now()}`), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatePayload | null) => {
        if (cancelled) return;
        setGate(data ?? NETWORK_ERROR_GATE);
      })
      .catch(() => {
        if (!cancelled) setGate(NETWORK_ERROR_GATE);
      });
    return () => { cancelled = true; };
  }, [resolvedBranchId]);

  // Nothing is rendered until the gate verdict is in. This includes
  // /table/:tableId so the menu can't flash even briefly.
  if (resolvedBranchId === 'resolving') return <Checking />;
  if (resolvedBranchId === null) {
    // No branch context at all — user hit a random URL. Show a minimal
    // placeholder; don't touch the menu.
    return <Checking />;
  }
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

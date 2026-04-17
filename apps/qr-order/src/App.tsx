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

export default function QrOrderApp() {
  const branchId = useSessionStore((s) => s.branchId);
  const [gate, setGate] = useState<GatePayload | null | 'loading'>(null);

  // When a session branch is known, check whether the client IP is on the
  // branch's QR allowlist. If not, show the Wi-Fi gate instead of routes.
  // This runs every time branchId changes (incl. first load after
  // TableEntry populates the session).
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setGate('loading');
    fetch(apiUrl(`/public/qr-gate/${branchId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatePayload | null) => {
        if (cancelled) return;
        // Fail-closed on null (branch not found / empty response) too.
        setGate(data ?? NETWORK_ERROR_GATE);
      })
      .catch(() => {
        if (!cancelled) setGate(NETWORK_ERROR_GATE);
      });
    return () => { cancelled = true; };
  }, [branchId]);

  // /table/:tableId is the entry point — it has to render so it can
  // populate the session. Every other route is gated. useLocation so
  // client-side navigations re-evaluate (window.location alone isn't
  // reactive to React Router).
  const location = useLocation();
  const isEntryRoute = location.pathname.startsWith('/table/');

  if (!isEntryRoute) {
    // No session yet → treat as gated until TableEntry completes.
    if (!branchId) return <Checking />;
    if (gate === null || gate === 'loading') return <Checking />;
    if (!gate.allowed) {
      return <WifiGate payload={gate} onAllowed={() => setGate({ ...gate, allowed: true })} />;
    }
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

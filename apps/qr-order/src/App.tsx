import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import TableEntry from './pages/TableEntry';
import MenuPage from './pages/MenuPage';
import ItemPage from './pages/ItemPage';
import CartPage from './pages/CartPage';
import OrderStatusPage from './pages/OrderStatusPage';
import WifiGate, { type GatePayload } from './pages/WifiGate';
import { useSessionStore } from './store/session.store';
import { apiUrl } from './lib/api';

export default function QrOrderApp() {
  const branchId = useSessionStore((s) => s.branchId);
  const [gate, setGate] = useState<GatePayload | null | 'loading'>(null);

  // When a session branch is known, check whether the client IP is on the
  // branch's QR allowlist. If not, show the Wi-Fi gate instead of routes.
  // Gate is skipped entirely until a branch is loaded (TableEntry does that).
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setGate('loading');
    fetch(apiUrl(`/public/qr-gate/${branchId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatePayload | null) => {
        if (cancelled) return;
        setGate(data ?? { allowed: true, gateEnabled: false, branchName: '', wifiSsid: null, wifiPass: null, message: null, clientIp: null });
      })
      .catch(() => { if (!cancelled) setGate({ allowed: true, gateEnabled: false, branchName: '', wifiSsid: null, wifiPass: null, message: null, clientIp: null }); });
    return () => { cancelled = true; };
  }, [branchId]);

  if (gate && gate !== 'loading' && !gate.allowed) {
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

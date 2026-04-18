import { Routes, Route, Navigate } from 'react-router-dom';

import { useAuthStore } from './store/auth.store';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import PurchaseCodesPage from './pages/PurchaseCodesPage';
import LicensesPage from './pages/LicensesPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  // Primitive expiry check: JWT exp is unix seconds. If expired, clear
  // and force login. Real signature check happens server-side on every
  // call — this just avoids sending known-stale tokens.
  if (token && user && user.exp * 1000 < Date.now()) {
    useAuthStore.getState().clearAuth();
    return <LoginPage />;
  }

  if (!token) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/purchase-codes" element={<PurchaseCodesPage />} />
        <Route path="/licenses" element={<LicensesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

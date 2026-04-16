import { Routes, Route, Navigate } from 'react-router-dom';

import { useAuthStore } from './store/auth.store';
import LoginPage from './pages/LoginPage';
import PosLayout from './layouts/PosLayout';
import OrderPage from './pages/OrderPage';
import TablesPage from './pages/TablesPage';
import KitchenPage from './pages/KitchenPage';
import SalesReportPage from './pages/SalesReportPage';
import PosCustomersPage from './pages/PosCustomersPage';
import PosPurchasingPage from './pages/PosPurchasingPage';
import PosFinancePage from './pages/PosFinancePage';
import PosPreReadyPage from './pages/PosPreReadyPage';
import PosReservationsPage from './pages/PosReservationsPage';
import CustomerDisplayPage from './pages/CustomerDisplayPage';

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Customer-display runs on a separate device (second monitor / tablet)
  // and hits a public /orders/display/:tableId endpoint, so it has to
  // be reachable without a cashier login. Route it outside the auth
  // wall. Everything else still requires auth.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/customer-display')) {
    return (
      <Routes>
        <Route path="/customer-display/:tableId?" element={<CustomerDisplayPage />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<PosLayout />}>
        <Route index element={<Navigate to="/tables" replace />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/order/:tableId?" element={<OrderPage />} />
        <Route path="/customers" element={<PosCustomersPage />} />
        <Route path="/purchasing" element={<PosPurchasingPage />} />
        <Route path="/finance" element={<PosFinancePage />} />
        <Route path="/pre-ready" element={<PosPreReadyPage />} />
        <Route path="/reservations" element={<PosReservationsPage />} />
        <Route path="/kitchen" element={<KitchenPage />} />
        <Route path="/reports/sales" element={<SalesReportPage />} />
      </Route>
    </Routes>
  );
}

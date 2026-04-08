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

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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
        <Route path="/kitchen" element={<KitchenPage />} />
        <Route path="/reports/sales" element={<SalesReportPage />} />
      </Route>
    </Routes>
  );
}

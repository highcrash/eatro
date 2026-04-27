import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { useAuthStore } from './store/auth.store';
import LoginPage from './pages/LoginPage';
import InstallWizard from './install/InstallWizard';
import { installApi } from './install/install-api';
import AdminLayout from './layouts/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import MenuPage from './pages/MenuPage';
import TablesPage from './pages/TablesPage';
import StaffPage from './pages/StaffPage';
import OrdersPage from './pages/OrdersPage';
import SuppliersPage from './pages/SuppliersPage';
import InventoryPage from './pages/InventoryPage';
import RecipesPage from './pages/RecipesPage';
import PurchasingPage from './pages/PurchasingPage';
import ShoppingListPage from './pages/ShoppingListPage';
import QrCodesPage from './pages/QrCodesPage';
import ReportsPage from './pages/ReportsPage';
import AttendancePage from './pages/AttendancePage';
import PayrollPage from './pages/PayrollPage';
import WastePage from './pages/WastePage';
import ExpensesPage from './pages/ExpensesPage';
import AccountsPage from './pages/AccountsPage';
import LiabilitiesPage from './pages/LiabilitiesPage';
import PreReadyPage from './pages/PreReadyPage';
import LeavePage from './pages/LeavePage';
import SettingsPage from './pages/SettingsPage';
import CookingStationsPage from './pages/CookingStationsPage';
import SalesReportPage from './pages/SalesReportPage';
import DailyReportsPage from './pages/DailyReportsPage';
import VoidReportPage from './pages/VoidReportPage';
import ItemsSoldReportPage from './pages/ItemsSoldReportPage';
import PerformanceReportPage from './pages/PerformanceReportPage';
import SuppliesReportPage from './pages/SuppliesReportPage';
import MushakRegisterPage from './pages/MushakRegisterPage';
import MushakInvoiceView from './pages/MushakInvoiceView';
import BranchesPage from './pages/BranchesPage';
import CashierPermissionsPage from './pages/CashierPermissionsPage';
import RolesPage from './pages/RolesPage';
import WebsitePage from './pages/WebsitePage';
import DiscountsPage from './pages/DiscountsPage';
import CustomersPage from './pages/CustomersPage';
import DataCleanupPage from './pages/DataCleanupPage';
import BackupPage from './pages/BackupPage';
import SmsPage from './pages/SmsPage';
import LicensePage from './pages/LicensePage';
import UpdatesPage from './pages/UpdatesPage';
import DevicesPage from './pages/DevicesPage';
import ReservationsPage from './pages/ReservationsPage';

export default function AdminApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Install-wizard takeover. On every app boot we ping /install/status
  // BEFORE showing login — if the DB has no config row yet, we flip
  // the whole UI to the wizard instead. Status is @Public() so it
  // works even when the license gate is locked (which it always is
  // on a fresh install). Uses lightweight state rather than React
  // Query so the check runs without the TanStack provider context
  // that wraps the rest of the admin shell lower in the tree.
  const [needsInstall, setNeedsInstall] = useState<boolean | null>(null);
  useEffect(() => {
    installApi
      .status()
      .then((s) => setNeedsInstall(s.needsInstall))
      .catch(() => setNeedsInstall(false)); // fail-open on transient error
  }, []);
  if (needsInstall === null) {
    // First paint. Intentionally blank — the wizard and login both
    // have their own visuals; a loading spinner here would flash and
    // look broken on fast networks. Browser shows the root html bg.
    return null;
  }
  if (needsInstall) {
    return <InstallWizard />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/pre-ready" element={<PreReadyPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/shopping-list" element={<ShoppingListPage />} />
        <Route path="/qr-codes" element={<QrCodesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/sales" element={<SalesReportPage />} />
        <Route path="/reports/daily" element={<DailyReportsPage />} />
        <Route path="/reports/voids" element={<VoidReportPage />} />
        <Route path="/reports/items" element={<ItemsSoldReportPage />} />
        <Route path="/reports/performance" element={<PerformanceReportPage />} />
        <Route path="/reports/supplies" element={<SuppliesReportPage />} />
        <Route path="/reports/mushak" element={<MushakRegisterPage />} />
        <Route path="/mushak/invoices/:id" element={<MushakInvoiceView />} />
        <Route path="/mushak/notes/:id" element={<MushakInvoiceView />} />
        <Route path="/discounts" element={<DiscountsPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/waste" element={<WastePage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/liabilities" element={<LiabilitiesPage />} />
        <Route path="/cooking-stations" element={<CookingStationsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/cashier-permissions" element={<CashierPermissionsPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/website" element={<WebsitePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/data-cleanup" element={<DataCleanupPage />} />
        <Route path="/backups" element={<BackupPage />} />
        <Route path="/sms" element={<SmsPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/license" element={<LicensePage />} />
        <Route path="/updates" element={<UpdatesPage />} />
      </Route>
    </Routes>
  );
}

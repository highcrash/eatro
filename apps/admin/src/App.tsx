import { Routes, Route, Navigate } from 'react-router-dom';

import { useAuthStore } from './store/auth.store';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import MenuPage from './pages/MenuPage';
import CustomMenuPage from './pages/CustomMenuPage';
import ActivityLogPage from './pages/ActivityLogPage';
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
import DevicesPage from './pages/DevicesPage';
import ReservationsPage from './pages/ReservationsPage';

export default function AdminApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/menu/custom" element={<CustomMenuPage />} />
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
        <Route path="/reports/activity-log" element={<ActivityLogPage />} />
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
      </Route>
    </Routes>
  );
}

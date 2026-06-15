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
import StockWatcherPage from './pages/StockWatcherPage';
import StockReconciliationPage from './pages/StockReconciliationPage';
import RecipesPage from './pages/RecipesPage';
import PurchasingPage from './pages/PurchasingPage';
import ShoppingListPage from './pages/ShoppingListPage';
import QrCodesPage from './pages/QrCodesPage';
import ReportsPage from './pages/ReportsPage';
import AttendancePage from './pages/AttendancePage';
import PayrollStaffListPage from './pages/PayrollStaffListPage';
import PayrollStaffDetailPage from './pages/PayrollStaffDetailPage';
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
import AggregatorPnLPage from './pages/AggregatorPnLPage';
import MushakRegisterPage from './pages/MushakRegisterPage';
import MushakInvoiceView from './pages/MushakInvoiceView';
import BranchesPage from './pages/BranchesPage';
import CashierPermissionsPage from './pages/CashierPermissionsPage';
import RolesPage from './pages/RolesPage';
import WebsitePage from './pages/WebsitePage';
import DiscountsPage from './pages/DiscountsPage';
import CustomersPage from './pages/CustomersPage';
import ReviewsPage from './pages/ReviewsPage';
import SalaryStructuresPage from './pages/SalaryStructuresPage';
import LeaveRulesPage from './pages/LeaveRulesPage';
import CouponCampaignsPage from './pages/CouponCampaignsPage';
import LoyaltyPage from './pages/LoyaltyPage';
import DataCleanupPage from './pages/DataCleanupPage';
import BackupPage from './pages/BackupPage';
import SmsPage from './pages/SmsPage';
import DevicesPage from './pages/DevicesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import ReservationsPage from './pages/ReservationsPage';
import MobileShoppingRequestPage from './pages/MobileShoppingRequestPage';
import MobileShoppingHistoryPage from './pages/MobileShoppingHistoryPage';
import ShoppingRequestsPage from './pages/ShoppingRequestsPage';
import MiscalculationReportPage from './pages/MiscalculationReportPage';

export default function AdminApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      {/* Mobile shopping flow — rendered OUTSIDE AdminLayout so it
          looks like a phone app and KITCHEN role can use it without
          drowning in admin-only sidebar items. */}
      <Route path="/mobile/shopping" element={<MobileShoppingRequestPage />} />
      <Route path="/mobile/shopping/history" element={<MobileShoppingHistoryPage />} />

      <Route element={<AdminLayout />}>
        {/* KITCHEN role default-lands on the mobile shopping page —
            most admin nav items are hidden for them anyway. */}
        <Route index element={<Navigate to={role === 'KITCHEN' ? '/mobile/shopping' : '/dashboard'} replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/menu/custom" element={<CustomMenuPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/stock-watcher" element={<StockWatcherPage />} />
        <Route path="/stock-reconciliation" element={<StockReconciliationPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/pre-ready" element={<PreReadyPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/shopping-list" element={<ShoppingListPage />} />
        <Route path="/shopping-requests" element={<ShoppingRequestsPage />} />
        <Route path="/qr-codes" element={<QrCodesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/sales" element={<SalesReportPage />} />
        <Route path="/reports/daily" element={<DailyReportsPage />} />
        <Route path="/reports/voids" element={<VoidReportPage />} />
        <Route path="/reports/items" element={<ItemsSoldReportPage />} />
        <Route path="/reports/performance" element={<PerformanceReportPage />} />
        <Route path="/reports/supplies" element={<SuppliesReportPage />} />
        <Route path="/reports/miscalculation" element={<MiscalculationReportPage />} />
        <Route path="/reports/aggregator-pnl" element={<AggregatorPnLPage />} />
        <Route path="/reports/mushak" element={<MushakRegisterPage />} />
        <Route path="/reports/activity-log" element={<ActivityLogPage />} />
        <Route path="/mushak/invoices/:id" element={<MushakInvoiceView />} />
        <Route path="/mushak/notes/:id" element={<MushakInvoiceView />} />
        <Route path="/discounts" element={<DiscountsPage />} />
        <Route path="/marketing/campaigns" element={<CouponCampaignsPage />} />
        <Route path="/marketing/loyalty" element={<LoyaltyPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/payroll" element={<PayrollStaffListPage />} />
        <Route path="/payroll/staff/:staffId" element={<PayrollStaffDetailPage />} />
        <Route path="/salary-structures" element={<SalaryStructuresPage />} />
        <Route path="/leave-rules" element={<LeaveRulesPage />} />
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
        <Route path="/integrations" element={<IntegrationsPage />} />
      </Route>
    </Routes>
  );
}

import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  ShoppingCart,
  ChefHat,
  Users,
  BarChart3,
  LogOut,
  Home,
  Truck,
  Wallet,
  Flame,
  Calendar,
} from 'lucide-react';

import { useAuthStore } from '../store/auth.store';
import { useBranding, useApplyPosTheme, resolveLogoUrl } from '../lib/branding';
import { useCashierPermissions } from '../lib/permissions';
import NotificationBell from '../components/NotificationBell';
import { useShortcuts } from '../lib/keyboard';
import { KeyboardHelp } from '../components/KeyboardHelp';
import { DesktopSidebarMenu, useDesktopBridge } from '../components/DesktopSidebarMenu';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof Home;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/tables',        label: 'Home',      Icon: Home },
  { to: '/order',         label: 'Cashier',   Icon: ShoppingCart },
  { to: '/customers',     label: 'Customers', Icon: Users },
  { to: '/kitchen',       label: 'Kitchen',   Icon: Flame },
  { to: '/reports/sales', label: 'Reports',   Icon: BarChart3 },
  { to: '/reservations', label: 'Bookings',  Icon: Calendar },
];

const PURCHASING_ITEM: NavItem = { to: '/purchasing', label: 'Purchasing', Icon: Truck };
const FINANCE_ITEM:    NavItem = { to: '/finance',    label: 'Finance',    Icon: Wallet };
const PREREADY_ITEM:   NavItem = { to: '/pre-ready',  label: 'Pre-Ready',  Icon: ChefHat };

export default function PosLayout() {
  const { user, clearAuth } = useAuthStore();
  const { data: branding } = useBranding();
  useApplyPosTheme(branding);
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const desktopBridge = useDesktopBridge();

  // Logout: in desktop, route through the paired-session flow so the terminal
  // returns to the cashier lock screen. In a browser, clearAuth is enough —
  // POS will show its LoginPage on the next render.
  const handleLogout = () => {
    if (desktopBridge) {
      desktopBridge.signOut();
    } else {
      clearAuth();
    }
  };

  // Global keyboard shortcuts. Alt chords fire even while typing (so the
  // cashier can jump from search-to-Purchasing without un-focusing); the
  // plain "?" opens help only when not typing.
  useShortcuts(
    {
      'alt+t': () => navigate('/tables'),
      'alt+n': () => navigate('/order'),
      'alt+c': () => navigate('/customers'),
      'alt+k': () => navigate('/kitchen'),
      'alt+r': () => navigate('/reports/sales'),
      'alt+b': () => navigate('/reservations'),
      'alt+p': () => navigate('/purchasing'),
      'alt+f': () => navigate('/finance'),
      'alt+y': () => navigate('/pre-ready'),
      '?':   () => setHelpOpen(true),
      'F1':  () => setHelpOpen(true),
      'Escape': () => setHelpOpen(false),
    },
    { allowInTyping: false },
  );

  const brandLogo = resolveLogoUrl(branding?.posLogoUrl ?? branding?.logoUrl);
  const brandName = branding?.name ?? 'Restro POS';
  const brandInitial = brandName.charAt(0).toUpperCase();

  // Show Purchasing / Finance nav entries only when at least one of their actions is enabled (and not Hidden).
  const { data: perms } = useCashierPermissions();
  const showPurchasing = !!perms && (
    (perms.createPurchaseOrder.enabled  && perms.createPurchaseOrder.approval !== 'NONE') ||
    (perms.receivePurchaseOrder.enabled && perms.receivePurchaseOrder.approval !== 'NONE') ||
    (perms.returnPurchaseOrder.enabled  && perms.returnPurchaseOrder.approval !== 'NONE') ||
    (perms.paySupplier.enabled          && perms.paySupplier.approval !== 'NONE')
  );
  const showFinance = !!perms && (
    (perms.createExpense.enabled && perms.createExpense.approval !== 'NONE') ||
    (perms.payPayroll.enabled    && perms.payPayroll.approval    !== 'NONE')
  );
  const showPreReady = !!perms && perms.createPreReadyKT.enabled && perms.createPreReadyKT.approval !== 'NONE';
  const navItems = [
    ...NAV_ITEMS,
    ...(showPurchasing ? [PURCHASING_ITEM] : []),
    ...(showFinance ? [FINANCE_ITEM] : []),
    ...(showPreReady ? [PREREADY_ITEM] : []),
  ];

  return (
    <div className="flex h-screen bg-theme-bg">
      {/* Sidebar */}
      <aside className="w-[88px] flex flex-col items-center py-5 bg-theme-sidebar border-r border-theme-border">
        {/* Logo mark */}
        <div className="mb-8">
          {brandLogo ? (
            <img src={brandLogo} alt="" className="w-12 h-12 object-contain rounded-theme" />
          ) : (
            <div className="w-12 h-12 bg-theme-accent flex items-center justify-center rounded-theme">
              <span className="text-white font-extrabold text-xl">{brandInitial}</span>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1 flex-1 w-full px-3">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-3 rounded-theme transition-colors ${
                  isActive
                    ? 'bg-theme-sidebar-active text-theme-sidebar-active-text'
                    : 'text-theme-sidebar-text hover:bg-theme-bg'
                }`
              }
            >
              <Icon size={20} />
              <span className="text-[10px] font-semibold">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-3 pt-4 border-t border-theme-border w-full px-3">
          {desktopBridge ? (
            // Desktop shell: the sidebar avatar opens a popover with desktop
            // actions (change pin, printers, sync, unpair, sign out, version).
            <DesktopSidebarMenu bridge={desktopBridge} userName={user?.name ?? ''} />
          ) : (
            // Web: the classic avatar + logout split.
            <>
              <div className="w-10 h-10 rounded-full bg-theme-bg flex items-center justify-center">
                <span className="text-theme-text-muted text-sm font-bold">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
              </div>
              <button
                onClick={handleLogout}
                title="Logout"
                className="flex flex-col items-center justify-center gap-1 py-3 w-full rounded-theme text-theme-sidebar-text hover:bg-theme-bg hover:text-theme-danger transition-colors"
              >
                <LogOut size={18} />
                <span className="text-[10px] font-semibold">Logout</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden bg-theme-bg relative">
        <Outlet />
      </main>

      {/* Global notification bell — fixed top-right, mounted once */}
      <NotificationBell />

      {/* Keyboard shortcut cheat-sheet (? / F1) */}
      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

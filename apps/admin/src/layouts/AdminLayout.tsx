import { NavLink, Outlet } from 'react-router-dom';
import { useBranding, resolveLogoUrl } from '../lib/branding';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Grid3X3,
  Users,
  ClipboardList,
  LogOut,
  Truck,
  Package,
  BookOpen,
  ShoppingCart,
  ListChecks,
  QrCode,
  BarChart2,
  Clock,
  Wallet,
  Trash2,
  Receipt,
  Landmark,
  Settings,
  ChefHat,
  CalendarDays,
  Printer,
  Building2,
  ChevronDown,
  ShieldCheck,
  Globe,
} from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Branch, LoginResponse } from '@restora/types';
import { api } from '../lib/api';

import { useAuthStore } from '../store/auth.store';

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'RESTAURANT',
    items: [
      { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
      { to: '/tables', icon: Grid3X3, label: 'Tables' },
      { to: '/orders', icon: ClipboardList, label: 'Orders' },
      { to: '/recipes', icon: BookOpen, label: 'Recipes' },
      { to: '/pre-ready', icon: ChefHat, label: 'Pre-Ready' },
      { to: '/reservations', icon: CalendarDays, label: 'Reservations' },
      { to: '/qr-codes', icon: QrCode, label: 'QR Codes' },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { to: '/inventory', icon: Package, label: 'Inventory' },
      { to: '/suppliers', icon: Truck, label: 'Suppliers' },
      { to: '/purchasing', icon: ShoppingCart, label: 'Purchasing' },
      { to: '/shopping-list', icon: ListChecks, label: 'Shopping List' },
      { to: '/waste', icon: Trash2, label: 'Waste' },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { to: '/reports', icon: BarChart2, label: 'Reports' },
      { to: '/reports/sales', icon: BarChart2, label: 'Sales Report' },
      { to: '/reports/daily', icon: BarChart2, label: 'Daily Reports' },
      { to: '/discounts', icon: BarChart2, label: 'Discounts & Coupons' },
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/accounts', icon: Landmark, label: 'Accounts' },
    ],
  },
  {
    label: 'PEOPLE',
    items: [
      { to: '/customers', icon: Users, label: 'Customers' },
      { to: '/staff', icon: Users, label: 'Staff' },
      { to: '/attendance', icon: Clock, label: 'Attendance' },
      { to: '/payroll', icon: Wallet, label: 'Payroll' },
      { to: '/leave', icon: CalendarDays, label: 'Leave' },
    ],
  },
  {
    label: null,
    items: [
      { to: '/cooking-stations', icon: Printer, label: 'Printers' },
      { to: '/branches', icon: Building2, label: 'Branches' },
      { to: '/cashier-permissions', icon: ShieldCheck, label: 'Cashier Perms' },
      { to: '/website', icon: Globe, label: 'Website' },
      { to: '/settings', icon: Settings, label: 'Settings' },
      { to: '/data-cleanup', icon: Trash2, label: 'Data Cleanup' },
    ],
  },
];

export default function AdminLayout() {
  const { user, setAuth, clearAuth } = useAuthStore();
  const { data: branding } = useBranding();
  const brandName = branding?.name ?? 'Restora';
  const brandInitial = brandName.charAt(0).toUpperCase();
  const logoUrl = resolveLogoUrl(branding?.logoUrl);
  const qc = useQueryClient();
  const [switching, setSwitching] = useState(false);

  const isOwner = user?.role === 'OWNER';

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches'),
    enabled: isOwner,
  });

  const handleSwitchBranch = async (branchId: string) => {
    if (branchId === user?.branchId) { setSwitching(false); return; }
    try {
      const res = await api.post<LoginResponse>('/auth/switch-branch', { branchId });
      setAuth(res.user, res.accessToken, res.refreshToken);
      // Hard refresh all data so it reloads scoped to the new branch
      qc.clear();
      setSwitching(false);
    } catch (e) {
      console.error('Switch failed', e);
      setSwitching(false);
    }
  };

  return (
    <div className="h-screen flex bg-[#0D0D0D]">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 bg-[#111] border-r border-[#2A2A2A] flex flex-col overflow-hidden">
        {/* Logo — pinned top */}
        <div className="px-4 py-4 border-b border-[#2A2A2A] flex items-center gap-2.5 shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-7 h-7 object-contain shrink-0" />
          ) : (
            <div className="w-7 h-7 bg-[#D62B2B] flex items-center justify-center shrink-0">
              <span className="font-display text-white text-xs tracking-wider">{brandInitial}</span>
            </div>
          )}
          <span className="font-display text-white text-base tracking-widest truncate">{brandName.toUpperCase()}</span>
        </div>

        {/* Nav — scrollable, hidden scrollbar */}
        <nav className="flex-1 py-2 px-2 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
          {NAV_GROUPS.map((group, gIdx) => (
            <div key={gIdx} className={gIdx > 0 ? 'mt-3' : ''}>
              {group.label && (
                <p className="px-2.5 mb-1 text-[9px] font-body font-medium tracking-[0.2em] text-[#444] uppercase">{group.label}</p>
              )}
              <div className="space-y-px">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 py-1.5 text-[12px] font-body transition-colors ${
                      isActive ? 'bg-[#D62B2B] text-white font-medium' : 'text-[#777] hover:bg-[#1A1A1A] hover:text-white'
                    }`
                  }>
                    <Icon size={14} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Branch switcher (OWNER only) + User + Logout — pinned bottom */}
        <div className="border-t border-[#2A2A2A] px-4 py-3 shrink-0">
          {/* Branch */}
          {isOwner && branches.length > 1 ? (
            <div className="relative mb-3">
              <button
                onClick={() => setSwitching((s) => !s)}
                className="w-full flex items-center justify-between gap-2 bg-[#161616] border border-[#2A2A2A] px-2.5 py-1.5 hover:border-[#D62B2B] transition-colors"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Building2 size={12} className="text-[#D62B2B] shrink-0" />
                  <span className="text-[10px] font-body text-white truncate">{user?.branchName}</span>
                </span>
                <ChevronDown size={11} className="text-[#666] shrink-0" />
              </button>
              {switching && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0D0D0D] border border-[#2A2A2A] shadow-2xl max-h-60 overflow-auto z-20">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => void handleSwitchBranch(b.id)}
                      className={`w-full text-left px-3 py-2 text-[10px] font-body hover:bg-[#161616] border-b border-[#1F1F1F] last:border-0 ${
                        b.id === user?.branchId ? 'bg-[#161616] text-[#D62B2B]' : 'text-[#DDD9D3]'
                      }`}
                    >
                      <span className="font-medium">{b.name}</span>
                      <span className="block text-[#666] text-[9px]">{b.address}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] font-body text-[#666] mb-3 flex items-center gap-1">
              <Building2 size={10} /> {user?.branchName}
            </p>
          )}

          <p className="text-xs font-body text-white font-medium truncate">{user?.name}</p>
          <p className="text-[10px] font-body text-[#666] mb-2">{user?.role}</p>
          <button
            onClick={clearAuth}
            className="flex items-center gap-2 text-[10px] font-body text-[#666] hover:text-[#D62B2B] transition-colors tracking-widest uppercase"
          >
            <LogOut size={11} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content — always has padding */}
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}

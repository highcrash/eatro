import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  UtensilsCrossed,
  Grid3X3,
  Users,
  ClipboardList,
  Package,
  BarChart2,
  AlertTriangle,
} from 'lucide-react';

import type { Order, DiningTable, Ingredient } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

const STATUS_COLOR: Record<string, string> = {
  PAID: 'text-green-600',
  VOID: 'text-[#D62B2B]',
  PENDING: 'text-amber-500',
  CONFIRMED: 'text-blue-500',
  PREPARING: 'text-blue-500',
  READY: 'text-purple-500',
  SERVED: 'text-[#999]',
};

const QUICK_LINKS = [
  { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
  { to: '/tables', icon: Grid3X3, label: 'Tables' },
  { to: '/orders', icon: ClipboardList, label: 'Orders' },
  { to: '/staff', icon: Users, label: 'Staff' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/reports', icon: BarChart2, label: 'Reports' },
];

export default function DashboardPage() {
  const { data: orders = [] } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => api.get<Order[]>('/orders'),
  });

  const { data: tables = [] } = useQuery<DiningTable[]>({
    queryKey: ['tables'],
    queryFn: () => api.get<DiningTable[]>('/tables'),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get<Ingredient[]>('/ingredients'),
  });

  const today = new Date().toDateString();
  const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === today);
  const paidToday = todayOrders.filter((o) => o.status === 'PAID');
  const revenue = paidToday.reduce((s, o) => s + Number(o.totalAmount), 0);
  const avgOrderValue = paidToday.length > 0 ? revenue / paidToday.length : 0;
  const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;
  const voidedToday = todayOrders.filter((o) => o.status === 'VOID').length;

  const lowStock = ingredients.filter(
    (i) => i.isActive && i.currentStock <= i.minimumStock,
  );

  const stats = [
    { label: "Today's Orders", value: String(todayOrders.length), sub: `${paidToday.length} paid` },
    { label: 'Revenue', value: formatCurrency(revenue), sub: 'today' },
    { label: 'Avg Order Value', value: formatCurrency(avgOrderValue), sub: `${paidToday.length} paid orders` },
    { label: 'Active Tables', value: `${occupiedTables}/${tables.length}`, sub: 'occupied' },
    { label: 'Voided', value: String(voidedToday), sub: 'today' },
    { label: 'Low Stock', value: String(lowStock.length), sub: 'ingredients', alert: lowStock.length > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Overview</p>
        <h1 className="font-display text-4xl text-white tracking-wide">DASHBOARD</h1>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`bg-[#161616] border p-5 ${s.alert ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'}`}
          >
            <p className="text-xs font-body text-[#999] tracking-widest uppercase mb-2">{s.label}</p>
            <p className={`font-display text-3xl tracking-wide ${s.alert ? 'text-[#D62B2B]' : 'text-white'}`}>
              {s.value}
            </p>
            <p className="text-xs font-body text-[#999] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Recent orders */}
        <div className="col-span-2 bg-[#161616] border border-[#2A2A2A]">
          <div className="px-5 py-4 border-b border-[#2A2A2A]">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Recent Orders</p>
          </div>
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
                <th className="px-5 py-3 font-medium">Order</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Table</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 10).map((o) => (
                <tr key={o.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-5 py-3 font-medium text-white">{o.orderNumber}</td>
                  <td className="px-5 py-3 text-[#999]">{o.type}</td>
                  <td className="px-5 py-3 text-[#999]">{o.tableNumber ?? '—'}</td>
                  <td className="px-5 py-3 text-white">{formatCurrency(Number(o.totalAmount))}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium tracking-widest uppercase ${STATUS_COLOR[o.status] ?? 'text-[#999]'}`}>
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Low stock warnings */}
          <div className="bg-[#161616] border border-[#2A2A2A] flex-1">
            <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center gap-2">
              {lowStock.length > 0 && <AlertTriangle size={14} className="text-[#D62B2B] shrink-0" />}
              <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Low Stock</p>
            </div>
            {lowStock.length === 0 ? (
              <div className="px-5 py-6 text-xs font-body text-[#999] text-center">
                All ingredients stocked
              </div>
            ) : (
              <div className="divide-y divide-[#2A2A2A]">
                {lowStock.slice(0, 8).map((ing) => (
                  <div key={ing.id} className="px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-body text-white truncate">{ing.name}</p>
                      <p className="text-xs font-body text-[#999]">
                        Min: {ing.minimumStock} {ing.unit}
                      </p>
                    </div>
                    <span className="text-sm font-body font-medium text-[#D62B2B] ml-3 shrink-0">
                      {ing.currentStock} {ing.unit}
                    </span>
                  </div>
                ))}
                {lowStock.length > 8 && (
                  <div className="px-5 py-2 text-xs font-body text-[#999] text-center">
                    +{lowStock.length - 8} more
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="bg-[#161616] border border-[#2A2A2A]">
            <div className="px-5 py-4 border-b border-[#2A2A2A]">
              <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Quick Links</p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#0D0D0D]">
              {QUICK_LINKS.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className="bg-[#161616] px-4 py-3 flex items-center gap-2 text-sm font-body text-[#999] hover:text-[#D62B2B] hover:bg-[#1F1F1F] transition-colors"
                >
                  <Icon size={14} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

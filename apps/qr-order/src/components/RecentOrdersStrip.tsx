import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency, shortOrderCode } from '@restora/utils';
import { useSessionStore } from '../store/session.store';
import { useCartStore } from '../store/cart.store';
import { qrFetch } from '../lib/api';

interface OrderRow {
  id: string;
  totalAmount: number;
  paidAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    notes: string | null;
  }>;
}

interface OrderHistoryResponse {
  customer: { totalSpent: number; totalOrders: number; lastVisit: string | null } | null;
  orders: OrderRow[];
}

/**
 * "Your recent orders" strip — only renders when a customer is
 * logged in. Reuses the order-history endpoint with limit:3 so we
 * don't add a second query path. Each card has a Reorder button
 * that pushes the line items into the cart and navigates to /cart.
 *
 * Hides itself entirely when the customer has no past orders so
 * brand-new customers don't see an empty heading on their first
 * visit.
 */
export default function RecentOrdersStrip() {
  const navigate = useNavigate();
  const customer = useSessionStore((s) => s.customer);
  const branchId = useSessionStore((s) => s.branchId);
  const addItem = useCartStore((s) => s.addItem);

  // Cached menu — same query key as MenuPage so this doesn't refetch.
  const { data: menu } = useQuery<{ items: MenuItem[] }>({
    queryKey: ['qr-menu', branchId],
    enabled: !!branchId,
  });
  const allMenuItems = menu?.items ?? [];

  const { data } = useQuery<OrderHistoryResponse>({
    queryKey: ['recent-orders', customer?.id],
    queryFn: () => qrFetch('/customers/auth/order-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
      body: JSON.stringify({ customerId: customer!.id, limit: 3 }),
    }).then((r) => r.json() as Promise<OrderHistoryResponse>),
    enabled: !!customer && !!branchId,
    staleTime: 60_000,
  });

  if (!customer) return null;
  const orders = data?.orders ?? [];
  if (orders.length === 0) return null;

  const reorder = (order: OrderRow) => {
    if (!allMenuItems.length) return;
    let added = 0;
    for (const line of order.items) {
      const fresh = allMenuItems.find((m) => m.id === line.menuItemId && m.isAvailable);
      if (!fresh) continue;
      addItem(fresh, { quantity: line.quantity, notes: line.notes ?? undefined });
      added++;
    }
    if (added > 0) navigate('/cart');
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between px-5 mb-2">
        <p className="font-body text-xs text-[#888] tracking-widest uppercase">Your recent orders</p>
        <button
          onClick={() => navigate('/account')}
          className="text-[10px] font-body text-[#29B6F6] hover:text-white tracking-widest uppercase"
        >
          View all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto px-5 pb-1 snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
        {orders.map((order) => {
          const dateLabel = order.paidAt ? new Date(order.paidAt).toLocaleDateString() : new Date(order.createdAt).toLocaleDateString();
          const summary = order.items.slice(0, 2).map((it) => `${it.quantity}× ${it.menuItemName}`).join(' · ');
          const more = order.items.length > 2 ? ` +${order.items.length - 2} more` : '';
          return (
            <div
              key={order.id}
              className="flex-shrink-0 w-64 bg-[#1A1A1A] border border-[#2A2A2A] p-3 snap-start"
            >
              <div className="flex items-center justify-between">
                <p className="font-body text-xs text-white">{dateLabel}</p>
                <p className="font-mono text-[10px] text-[#666] tracking-widest uppercase">{shortOrderCode(order.id)}</p>
              </div>
              <p className="font-body text-[11px] text-[#999] mt-1 leading-tight line-clamp-2 min-h-[28px]">
                {summary}{more}
              </p>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#2A2A2A]">
                <span className="font-display text-sm text-[#C8FF00]">{formatCurrency(Number(order.totalAmount))}</span>
                <button
                  onClick={() => reorder(order)}
                  className="flex items-center gap-1 bg-[#C8FF00] text-[#0D0D0D] font-body font-bold text-[10px] tracking-widest uppercase px-2.5 py-1.5 hover:opacity-90"
                >
                  <Repeat size={10} />
                  Reorder
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

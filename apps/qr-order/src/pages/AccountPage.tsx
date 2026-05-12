import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LogOut, Star, RefreshCw, ChevronDown, ChevronUp, Repeat } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency, shortOrderCode } from '@restora/utils';
import { useSessionStore } from '../store/session.store';
import { useCartStore } from '../store/cart.store';
import { apiUrl, qrFetch } from '../lib/api';
import { formatBranchDate } from '../lib/time';

interface OrderHistoryItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
}

interface OrderHistoryReview {
  id: string;
  foodScore: number;
  serviceScore: number;
  atmosphereScore: number;
  priceScore: number;
  notes: string | null;
  createdAt: string;
}

interface OrderHistoryRow {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  paidAt: string | null;
  createdAt: string;
  items: OrderHistoryItem[];
  review: OrderHistoryReview | null;
}

interface OrderHistoryResponse {
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    totalSpent: number;
    totalOrders: number;
    lastVisit: string | null;
    loyaltyPoints: number;
    loyaltyExpiresAt: string | null;
  } | null;
  orders: OrderHistoryRow[];
}

interface CustomerReview {
  id: string;
  foodScore: number;
  serviceScore: number;
  atmosphereScore: number;
  priceScore: number;
  notes: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; paidAt: string | null };
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

function StarRow({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? 'fill-[#FFA726] text-[#FFA726]' : 'text-[#333]'}
        />
      ))}
    </div>
  );
}

export default function AccountPage() {
  const navigate = useNavigate();
  const customer = useSessionStore((s) => s.customer);
  const setCustomer = useSessionStore((s) => s.setCustomer);
  const branchId = useSessionStore((s) => s.branchId);
  const setActiveOrder = useSessionStore((s) => s.setActiveOrder);
  const addItem = useCartStore((s) => s.addItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const qc = useQueryClient();

  // Bounce to login if not signed in. Same redirect-with-?next pattern
  // the rest of the app uses.
  useEffect(() => {
    if (!customer) navigate('/login?next=/account', { replace: true });
  }, [customer, navigate]);

  const [editName, setEditName] = useState(customer?.name ?? '');
  const [editEmail, setEditEmail] = useState(customer?.email ?? '');
  const [savedFlash, setSavedFlash] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [reorderToast, setReorderToast] = useState<string | null>(null);

  // Order history + customer snapshot (single round-trip drives both
  // the lifetime stats strip + the order list).
  const { data: history } = useQuery<OrderHistoryResponse>({
    queryKey: ['account-history', customer?.id],
    queryFn: () => qrFetch('/customers/auth/order-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
      body: JSON.stringify({ customerId: customer!.id, limit: 30 }),
    }).then((r) => r.json() as Promise<OrderHistoryResponse>),
    enabled: !!customer && !!branchId,
  });

  // Customer's own reviews — chronological. Drives the My Reviews
  // section and provides the "★ Reviewed" badge data on order rows.
  const { data: reviews = [] } = useQuery<CustomerReview[]>({
    queryKey: ['account-reviews', customer?.id],
    queryFn: () => qrFetch('/customers/auth/customer-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
      body: JSON.stringify({ customerId: customer!.id }),
    }).then((r) => r.json() as Promise<CustomerReview[]>),
    enabled: !!customer && !!branchId,
  });

  // Cached menu — used by the reorder helper to look up fresh menu
  // item rows. Reuses the same query key the MenuPage uses so we
  // don't refetch.
  const { data: menu } = useQuery<{ items: MenuItem[] }>({
    queryKey: ['qr-menu', branchId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/menu/${branchId}`));
      if (!res.ok) throw new Error('Menu fetch failed');
      return res.json();
    },
    enabled: !!branchId,
  });
  const allMenuItems = menu?.items ?? [];

  const profileMut = useMutation({
    mutationFn: async () => {
      const res = await qrFetch('/customers/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer!.id,
          name: editName.trim() || undefined,
          email: editEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to save' })) as { message?: string };
        throw new Error(err.message ?? 'Failed to save');
      }
      return (await res.json()) as { id: string; name: string; phone: string; email: string | null };
    },
    onSuccess: (saved) => {
      setCustomer({ id: saved.id, name: saved.name, phone: saved.phone, email: saved.email });
      void qc.invalidateQueries({ queryKey: ['account-history', customer?.id] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  const stats = history?.customer;

  const reorder = (order: OrderHistoryRow) => {
    if (!allMenuItems.length) return;
    const skipped: string[] = [];
    let added = 0;
    for (const line of order.items) {
      const fresh = allMenuItems.find((m) => m.id === line.menuItemId && m.isAvailable);
      if (!fresh) { skipped.push(line.menuItemName); continue; }
      addItem(fresh, { quantity: line.quantity, notes: line.notes ?? undefined });
      added++;
    }
    if (added > 0) {
      const msg = skipped.length > 0
        ? `${added} item${added === 1 ? '' : 's'} added. Skipped: ${skipped.join(', ')}`
        : `${added} item${added === 1 ? '' : 's'} added to your cart`;
      setReorderToast(msg);
      setTimeout(() => navigate('/cart'), 600);
    } else if (skipped.length > 0) {
      setReorderToast(`None of those items are available right now.`);
      setTimeout(() => setReorderToast(null), 3500);
    }
  };

  const signOut = () => {
    setCustomer(null);
    setActiveOrder(null);
    clearCart();
    navigate('/menu', { replace: true });
  };

  // Map orderId → review for fast "did I review this?" checks.
  const reviewByOrderId = useMemo(() => {
    const m = new Map<string, CustomerReview>();
    for (const r of reviews) m.set(r.order.id, r);
    return m;
  }, [reviews]);

  if (!customer) return null; // Redirecting via the effect above.

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D] px-5 py-4 flex items-center justify-between border-b border-[#1F1F1F]">
        <button
          onClick={() => navigate('/menu')}
          className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white"
          aria-label="Back to menu"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="text-center">
          <h1 className="font-display text-xl text-white tracking-wider">MY ACCOUNT</h1>
          <p className="text-[10px] font-body text-[#888] tracking-widest uppercase">{customer.phone}</p>
        </div>
        <div className="w-9" />
      </div>

      {reorderToast && (
        <div className="mx-5 mt-3 bg-[#C8FF00]/10 border border-[#C8FF00]/40 px-4 py-3">
          <p className="text-xs font-body text-[#C8FF00]">{reorderToast}</p>
        </div>
      )}

      {/* ── Lifetime stats strip ─────────────────────────────────── */}
      {stats && (
        <div className="px-5 mt-5">
          <div className="grid grid-cols-3 bg-[#1A1A1A] border border-[#2A2A2A]">
            <div className="px-3 py-4 text-center border-r border-[#2A2A2A]">
              <p className="text-[9px] text-[#666] font-body tracking-widest uppercase mb-1">Total spent</p>
              <p className="font-display text-lg text-[#C8FF00]">{formatCurrency(Number(stats.totalSpent))}</p>
            </div>
            <div className="px-3 py-4 text-center border-r border-[#2A2A2A]">
              <p className="text-[9px] text-[#666] font-body tracking-widest uppercase mb-1">Orders</p>
              <p className="font-display text-lg text-white">{stats.totalOrders}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-[9px] text-[#666] font-body tracking-widest uppercase mb-1">Last visit</p>
              <p className="font-body text-xs text-white pt-1">{formatRelative(stats.lastVisit)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Loyalty balance card ─────────────────────────────────────
          Only shown when the customer has earned points (so a brand
          new account doesn't see an empty zero-balance card). The
          expiry sub-line resets every paid order on the server, so
          active visitors always see a future date. Redemption itself
          happens on the order screen via apply-loyalty — the copy
          here is informational + a prompt to use them next visit. */}
      {stats && stats.loyaltyPoints > 0 && (
        <div className="px-5 mt-3">
          <div className="bg-gradient-to-br from-[#1F2A00] to-[#1A1A1A] border border-[#C8FF00]/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] text-[#C8FF00] font-body tracking-widest uppercase mb-1">Loyalty balance</p>
                <p className="font-display text-3xl text-[#C8FF00] tracking-wide">
                  {stats.loyaltyPoints.toLocaleString()} <span className="text-base text-[#888]">pt</span>
                </p>
              </div>
              <div className="text-right">
                {stats.loyaltyExpiresAt ? (
                  <>
                    <p className="text-[9px] text-[#666] font-body tracking-widest uppercase">Expires</p>
                    <p className="text-xs font-body text-white mt-1">
                      {new Date(stats.loyaltyExpiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[10px] font-body text-[#888] mt-0.5">Resets each visit</p>
                  </>
                ) : (
                  <p className="text-[10px] font-body text-[#888]">No expiry</p>
                )}
              </div>
            </div>
            <p className="text-[11px] font-body text-[#aaa] mt-3 leading-relaxed">
              Redeem points at checkout to lower your bill. Your balance grows automatically with every paid order.
            </p>
          </div>
        </div>
      )}

      {/* ── Profile editor ───────────────────────────────────────── */}
      <div className="px-5 mt-5">
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-4 space-y-3">
          <p className="text-[10px] text-[#666] font-body tracking-widest uppercase">Profile</p>
          <div className="space-y-2">
            <label className="text-[10px] font-body text-[#888]">Name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2.5 text-sm font-body text-white outline-none focus:border-[#C8FF00]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-body text-[#888]">Email (optional)</label>
            <input
              type="email"
              value={editEmail ?? ''}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2.5 text-sm font-body text-white outline-none focus:border-[#C8FF00]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-body text-[#888]">Phone (locked)</label>
            <input
              value={customer.phone}
              disabled
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2.5 text-sm font-body text-[#666] outline-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => profileMut.mutate()}
              disabled={profileMut.isPending}
              className="bg-[#C8FF00] text-[#0D0D0D] font-body font-bold text-xs tracking-widest uppercase px-4 py-2.5 hover:opacity-90 disabled:opacity-40"
            >
              {profileMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={signOut}
              className="ml-auto flex items-center gap-1.5 text-[#F03535] hover:text-white border border-[#F03535]/40 hover:border-white text-xs font-body font-medium tracking-widest uppercase px-3 py-2.5 transition-colors"
            >
              <LogOut size={12} />
              Sign out
            </button>
            {savedFlash && <span className="text-xs font-body text-[#4CAF50]">Saved ✓</span>}
            {profileMut.isError && (
              <span className="text-xs font-body text-[#F03535]">{(profileMut.error as Error).message}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Recent orders ────────────────────────────────────────── */}
      <div className="px-5 mt-6">
        <p className="font-body text-xs text-[#888] tracking-widest uppercase mb-2">Recent orders</p>
        {history?.orders.length === 0 && (
          <p className="text-xs text-[#666] font-body py-4 text-center bg-[#1A1A1A] border border-[#2A2A2A]">
            You haven't placed any orders yet.
          </p>
        )}
        <div className="space-y-2">
          {history?.orders.map((order) => {
            const expanded = expandedOrderId === order.id;
            const review = reviewByOrderId.get(order.id);
            const dateLabel = formatBranchDate(order.paidAt ?? order.createdAt);
            return (
              <div key={order.id} className="bg-[#1A1A1A] border border-[#2A2A2A]">
                <button
                  onClick={() => setExpandedOrderId(expanded ? null : order.id)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left"
                >
                  <div>
                    <p className="font-body text-sm text-white">{dateLabel}</p>
                    <p className="text-[11px] font-body text-[#666] tracking-widest uppercase font-mono">
                      {shortOrderCode(order.id)} · {order.items.length} item{order.items.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-display text-sm text-white">{formatCurrency(Number(order.totalAmount))}</span>
                    {expanded ? <ChevronUp size={14} className="text-[#888]" /> : <ChevronDown size={14} className="text-[#888]" />}
                  </div>
                </button>
                {expanded && (
                  <div className="border-t border-[#2A2A2A] px-4 py-3 space-y-3">
                    <div className="space-y-1">
                      {order.items.map((it) => (
                        <div key={it.id} className="flex justify-between text-xs font-body">
                          <span className="text-white">{it.quantity}× {it.menuItemName}</span>
                          <span className="text-[#888]">{formatCurrency(Number(it.totalPrice))}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => reorder(order)}
                        className="flex items-center gap-1.5 bg-[#C8FF00] text-[#0D0D0D] font-body font-bold text-[11px] tracking-widest uppercase px-3 py-2 hover:opacity-90"
                      >
                        <Repeat size={12} />
                        Reorder
                      </button>
                      {review ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-body text-[#FFA726]">
                          <StarRow value={review.foodScore} />
                          <span>Reviewed</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => navigate(`/review/${order.id}`)}
                          className="ml-auto text-[11px] font-body text-[#29B6F6] hover:text-white tracking-widest uppercase"
                        >
                          Leave a review
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── My reviews ───────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <div className="px-5 mt-6">
          <p className="font-body text-xs text-[#888] tracking-widest uppercase mb-2">My reviews</p>
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="bg-[#1A1A1A] border border-[#2A2A2A] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-body text-[#666] tracking-widest uppercase">
                    {formatBranchDate(r.order.paidAt ?? r.createdAt)}
                  </p>
                  <p className="font-mono text-[11px] text-[#888]">{shortOrderCode(r.order.id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-body">
                  <div className="flex items-center gap-2"><span className="text-[#666] w-16">Food</span><StarRow value={r.foodScore} /></div>
                  <div className="flex items-center gap-2"><span className="text-[#666] w-16">Service</span><StarRow value={r.serviceScore} /></div>
                  <div className="flex items-center gap-2"><span className="text-[#666] w-16">Atmos.</span><StarRow value={r.atmosphereScore} /></div>
                  <div className="flex items-center gap-2"><span className="text-[#666] w-16">Price</span><StarRow value={r.priceScore} /></div>
                </div>
                {r.notes && (
                  <p className="text-xs font-body text-[#aaa] italic border-t border-[#2A2A2A] pt-2">"{r.notes}"</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Refresh footer */}
      <div className="px-5 mt-6 text-center">
        <button
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ['account-history', customer.id] });
            void qc.invalidateQueries({ queryKey: ['account-reviews', customer.id] });
          }}
          className="inline-flex items-center gap-1.5 text-[10px] font-body text-[#666] hover:text-white tracking-widest uppercase"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import type { Order } from '@restora/types';
import { formatCurrency, formatDateTime } from '@restora/utils';
import { api } from '../lib/api';

const STATUS_OPTIONS = ['ALL', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'PAID', 'VOID'] as const;
const TYPE_OPTIONS = ['ALL', 'DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;

const STATUS_TONE: Record<string, string> = {
  PENDING:    'bg-theme-warn/20 text-theme-warn',
  CONFIRMED:  'bg-theme-info/20 text-theme-info',
  PREPARING:  'bg-theme-info/20 text-theme-info',
  READY:      'bg-theme-pop/20 text-theme-pop',
  SERVED:     'bg-theme-pop/20 text-theme-pop',
  PAID:       'bg-theme-pop/20 text-theme-pop',
  VOID:       'bg-theme-danger/20 text-theme-danger',
};

// ─── Order Detail Modal ─────────────────────────────────────────────────────

function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const activeItems = order.items.filter((i) => !i.voidedAt);
  const voidedItems = order.items.filter((i) => i.voidedAt);
  const subtotal = Number(order.subtotal);
  const tax = Number(order.taxAmount);
  const discount = Number(order.discountAmount);
  const total = Number(order.totalAmount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-theme-surface rounded-theme border border-theme-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-accent">
              Order
            </p>
            <h2 className="font-display text-2xl tracking-wide text-theme-text">
              #{order.orderNumber}
            </h2>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4 text-sm">
          <div className="flex flex-wrap gap-3 items-center text-xs text-theme-text-muted">
            <span>{formatDateTime(order.createdAt)}</span>
            <span>•</span>
            <span>{order.type.replace('_', ' ')}</span>
            {order.tableNumber && (<><span>•</span><span>Table {order.tableNumber}</span></>)}
            <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 tracking-widest uppercase ${STATUS_TONE[order.status] ?? 'bg-theme-border text-theme-text-muted'}`}>
              {order.status}
            </span>
          </div>

          <div>
            <div className="grid grid-cols-[auto_1fr_60px_110px_110px] gap-3 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted pb-2 border-b border-theme-border">
              <span>#</span><span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit</span>
              <span className="text-right">Total</span>
            </div>
            {activeItems.map((it, idx) => (
              <div key={it.id} className="grid grid-cols-[auto_1fr_60px_110px_110px] gap-3 py-2 border-b border-theme-border text-theme-text">
                <span className="text-theme-text-muted">{idx + 1}</span>
                <div>
                  <p>{it.menuItemName}</p>
                  {it.notes && <p className="text-[11px] text-theme-text-muted italic mt-0.5">→ {it.notes}</p>}
                </div>
                <span className="text-right">{Number(it.quantity)}</span>
                <span className="text-right">{formatCurrency(Number(it.unitPrice))}</span>
                <span className="text-right font-semibold">{formatCurrency(Number(it.totalPrice))}</span>
              </div>
            ))}
            {voidedItems.length > 0 && (
              <>
                <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-theme-danger">Voided</div>
                {voidedItems.map((it) => (
                  <div key={it.id} className="grid grid-cols-[auto_1fr_60px_110px_110px] gap-3 py-1.5 border-b border-theme-border text-theme-text-muted line-through">
                    <span>—</span>
                    <span>{it.menuItemName}</span>
                    <span className="text-right">{Number(it.quantity)}</span>
                    <span className="text-right">{formatCurrency(Number(it.unitPrice))}</span>
                    <span className="text-right">{formatCurrency(Number(it.totalPrice))}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="border-t border-theme-border pt-3 space-y-1 text-theme-text-muted">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-theme-pop"><span>Discount</span><span>-{formatCurrency(discount)}</span></div>
            )}
            <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(tax)}</span></div>
            <div className="flex justify-between pt-1 text-theme-text font-bold text-lg"><span>Total</span><span>{formatCurrency(total)}</span></div>
          </div>

          {order.paymentMethod && (
            <div className="text-xs text-theme-text-muted">
              Paid via <span className="uppercase font-semibold text-theme-text">{order.paymentMethod}</span>
              {order.paidAt && <> at {new Date(order.paidAt).toLocaleTimeString()}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Orders Page ────────────────────────────────────────────────────────────

export default function PosOrdersPage() {
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['pos-orders', dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      return api.get<Order[]>(`/orders?${params.toString()}`);
    },
  });

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== 'ALL') rows = rows.filter((o) => o.status === statusFilter);
    if (typeFilter !== 'ALL') rows = rows.filter((o) => o.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter((o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        (o.tableNumber || '').toLowerCase().includes(q) ||
        o.items.some((i) => i.menuItemName.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [orders, statusFilter, typeFilter, search]);

  const totalSales = filtered.reduce((s, o) => s + (o.status === 'VOID' ? 0 : Number(o.totalAmount)), 0);

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      <div className="px-8 py-5 border-b border-theme-border flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-theme-accent text-xs font-bold tracking-widest uppercase">Cashier</p>
          <h1 className="font-display text-theme-text text-4xl tracking-wide">ORDERS</h1>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Total Sales</p>
          <p className="text-2xl font-extrabold text-theme-text">{formatCurrency(totalSales)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-8 py-4 border-b border-theme-border flex flex-wrap gap-3 items-center bg-theme-surface">
        <FilterField label="From">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="filter-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="filter-input" />
        </FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-input">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FilterField>
        <FilterField label="Type">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="filter-input">
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </FilterField>
        <FilterField label="Search" wide>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order #, table, or item…"
            className="filter-input"
          />
        </FilterField>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-8 py-4">
        {isLoading ? (
          <p className="text-theme-text-muted text-sm py-12 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-theme-text-muted text-sm py-12 text-center">No orders in this range.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className="text-left bg-theme-surface rounded-theme border border-theme-border hover:border-theme-accent transition-colors p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-theme-text-muted">Order</p>
                    <p className="font-display text-xl text-theme-text">#{o.orderNumber}</p>
                  </div>
                  <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 ${STATUS_TONE[o.status] ?? 'bg-theme-border text-theme-text-muted'}`}>
                    {o.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-theme-text-muted">
                  <span>{new Date(o.createdAt).toLocaleTimeString()}</span>
                  <span>•</span>
                  <span>{o.type.replace('_', ' ')}</span>
                  {o.tableNumber && (<><span>•</span><span>Table {o.tableNumber}</span></>)}
                </div>
                <p className="text-xs text-theme-text-muted line-clamp-2 min-h-[32px]">
                  {o.items.filter((i) => !i.voidedAt).map((i) => `${Number(i.quantity)}× ${i.menuItemName}`).join(', ')}
                </p>
                <div className="flex items-center justify-between pt-1 border-t border-theme-border">
                  <span className="text-xs text-theme-text-muted">{o.paymentMethod ?? '—'}</span>
                  <span className="font-bold text-theme-text">{formatCurrency(Number(o.totalAmount))}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <OrderDetailModal order={selected} onClose={() => setSelected(null)} />}

      <style>{`
        .filter-input {
          background: var(--theme-surface);
          border: 1px solid var(--theme-border);
          color: var(--theme-text);
          padding: 0.5rem 0.75rem;
          font-size: 0.8rem;
          border-radius: var(--theme-radius);
          outline: none;
          min-width: 120px;
        }
        .filter-input:focus { border-color: var(--theme-accent); }
      `}</style>
    </div>
  );
}

function FilterField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'flex-1 min-w-[180px]' : ''}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">{label}</span>
      {children}
    </div>
  );
}

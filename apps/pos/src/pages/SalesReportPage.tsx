import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Wrench, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type { CorrectPaymentDto, ItemsSoldReport } from '@restora/types';
import { formatCurrency, renderMushakSlipHtml, shortOrderCode, type MushakSnapshot } from '@restora/utils';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

interface SalesItem {
  name: string;
  quantity: number;
  total: number;
}

interface SalesOrder {
  id: string;
  orderNumber: string;
  paidAt: string;
  createdAt: string;
  type: string;
  tableNumber: string | null;
  items: SalesItem[];
  subtotal: number;
  discountAmount: number;
  sdAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  // Mushak 6.3 invoice — present once the branch is BIN-enabled and
  // the order is PAID. The serial doubles as the Mushak Register
  // Serial Number; clicking it reprints the invoice slip.
  mushakInvoice: { id: string; serial: string; sdAmount: number } | null;
}

interface SalesData {
  from: string;
  to: string;
  orders: SalesOrder[];
}

// shortCode moved to @restora/utils as shortOrderCode so the receipt
// print + sales report show the same opaque order code.

// Pick ~10% random orders per month from a list, seeded by month for consistency
function sampleByMonth(orders: SalesOrder[]): SalesOrder[] {
  const byMonth: Record<string, SalesOrder[]> = {};
  for (const o of orders) {
    const key = o.paidAt.slice(0, 7); // YYYY-MM
    (byMonth[key] ??= []).push(o);
  }

  const result: SalesOrder[] = [];
  for (const [, monthOrders] of Object.entries(byMonth)) {
    const count = Math.max(1, Math.ceil(monthOrders.length * 0.1));
    // Deterministic shuffle using order IDs
    const shuffled = [...monthOrders].sort((a, b) => {
      const ha = a.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      const hb = b.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      return ha - hb;
    });
    result.push(...shuffled.slice(0, count));
  }

  return result.sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`;
}

// ─── Correct Payment Dialog (POS) ────────────────────────────────────────────

interface PMOption { id: string; code: string; name: string; isActive: boolean; isDefault: boolean }
interface PMCategory { id: string; code: string; name: string; isActive: boolean; options: PMOption[] }

function PosCorrectPaymentDialog({ orderId, orderNumber, total, currentMethod, onClose }: {
  orderId: string;
  orderNumber: string;
  total: number;
  currentMethod: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data: categories = [] } = useQuery<PMCategory[]>({
    queryKey: ['payment-methods'],
    queryFn: () => api.get('/payment-methods'),
    select: (d) => d.filter((c) => c.isActive && c.options.some((o) => o.isActive)),
  });
  const allOptions = categories.flatMap((c) => c.options.filter((o) => o.isActive).map((o) => ({ code: o.code, name: o.name, catCode: c.code })));

  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [method, setMethod] = useState<string>(currentMethod || '');
  const [splits, setSplits] = useState<{ method: string; amount: number; reference?: string }[]>([
    { method: 'CASH', amount: Math.round(total / 2) },
    { method: 'CASH', amount: total - Math.round(total / 2) },
  ]);
  const [approverPin, setApproverPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const splitTotal = splits.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
  const splitDelta = splitTotal - total;

  const mutation = useMutation({
    mutationFn: (dto: CorrectPaymentDto) => api.post(`/orders/${orderId}/correct-payment`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-detail'] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Correction failed'),
  });

  const submit = () => {
    setError(null);
    if (mode === 'single') {
      if (!method) { setError('Pick a payment method'); return; }
      mutation.mutate({ method, approverPin: approverPin || undefined, reason: reason || undefined });
    } else {
      if (splits.some((s) => !s.method) || splits.length < 2) { setError('Each split needs a method'); return; }
      if (Math.abs(splitDelta) > 1) { setError(`Split sum must equal ${formatCurrency(total)}`); return; }
      mutation.mutate({ method: 'SPLIT', splits, approverPin: approverPin || undefined, reason: reason || undefined });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Correct Payment</p>
            <p className="text-sm text-theme-text mt-0.5">Order #{orderNumber} • {formatCurrency(total)}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={14} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <div className="bg-theme-bg rounded-theme px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Currently recorded as</p>
            <p className="text-sm text-theme-text mt-0.5">{currentMethod || '—'}</p>
          </div>

          <div className="flex gap-1 bg-theme-bg rounded-theme p-1">
            {(['single', 'split'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} type="button"
                className={`flex-1 py-1.5 text-xs rounded-theme transition-colors ${
                  mode === m ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-semibold hover:text-theme-text'
                }`}
              >{m === 'single' ? 'Single Method' : 'Split'}</button>
            ))}
          </div>

          {mode === 'single' ? (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">New Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent">
                <option value="">Select payment method…</option>
                {allOptions.map((o) => (
                  <option key={o.code} value={o.code}>{o.name} ({o.catCode})</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Splits</label>
              {splits.map((sp, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select value={sp.method}
                    onChange={(e) => setSplits(splits.map((x, i) => i === idx ? { ...x, method: e.target.value } : x))}
                    className="flex-1 bg-theme-bg border border-theme-border rounded-theme px-2 py-2 text-sm text-theme-text outline-none focus:border-theme-accent">
                    <option value="">Method…</option>
                    {allOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                  </select>
                  <input type="number" step="0.01" value={(sp.amount / 100).toFixed(2)}
                    onChange={(e) => setSplits(splits.map((x, i) => i === idx ? { ...x, amount: Math.round((Number(e.target.value) || 0) * 100) } : x))}
                    className="w-28 bg-theme-bg border border-theme-border rounded-theme px-2 py-2 text-sm text-theme-text outline-none focus:border-theme-accent text-right" />
                  {splits.length > 2 && (
                    <button onClick={() => setSplits(splits.filter((_, i) => i !== idx))} type="button" className="text-theme-danger p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
              <div className="flex justify-between items-center pt-1">
                <button onClick={() => setSplits([...splits, { method: '', amount: 0 }])} type="button" className="text-[10px] font-bold uppercase tracking-wider text-theme-accent">+ Add split</button>
                <span className={`text-xs ${Math.abs(splitDelta) > 1 ? 'text-theme-danger' : 'text-green-600'}`}>
                  {splitTotal === total ? 'Balanced' : `${splitDelta > 0 ? '+' : ''}${formatCurrency(splitDelta)}`}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Tapped CASH instead of bKash"
              className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Approver PIN (optional)</label>
            <input type="password" value={approverPin} onChange={(e) => setApproverPin(e.target.value)}
              placeholder="Owner / Manager password"
              className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
          </div>

          {error && <div className="bg-theme-danger/10 border border-theme-danger/30 rounded-theme px-3 py-2 text-xs text-theme-danger">{error}</div>}

          <div className="flex gap-2">
            <button onClick={onClose} type="button" disabled={mutation.isPending}
              className="flex-1 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
            <button onClick={submit} type="button" disabled={mutation.isPending}
              className="flex-1 bg-theme-accent hover:opacity-90 text-white font-bold px-4 py-2.5 rounded-theme text-sm disabled:opacity-50">
              {mutation.isPending ? 'Correcting…' : 'Correct Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SalesReportPage() {
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split('T')[0];
  const [mode, setMode] = useState<'today' | 'range'>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  // In range mode, always exclude today — cap 'to' at yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const queryFrom = mode === 'today' ? undefined : from;
  const queryTo = mode === 'today' ? undefined : (to >= today ? yesterday : to);

  const { data, isLoading } = useQuery<SalesData>({
    queryKey: ['sales-detail', mode, queryFrom, queryTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (queryFrom) params.set('from', queryFrom);
      if (queryTo) params.set('to', queryTo);
      const qs = params.toString();
      return api.get<SalesData>(`/reports/sales-detail${qs ? `?${qs}` : ''}`);
    },
  });

  // Sales / Items / Expense tab selector
  const [tab, setTab] = useState<'sales' | 'items' | 'expense'>('sales');
  const [correcting, setCorrecting] = useState<SalesOrder | null>(null);
  const role = useAuthStore((s) => s.user?.role);
  const canCorrectPayment = role === 'OWNER' || role === 'MANAGER';

  // Items-Sold report — POS limits to today only.
  const { data: itemsSold, isLoading: itemsLoading } = useQuery<ItemsSoldReport>({
    queryKey: ['items-sold', 'today'],
    queryFn: () => api.get<ItemsSoldReport>(`/reports/items-sold?from=${today}&to=${today}`),
    enabled: tab === 'items',
  });

  // Expense list — pinned to TODAY only for now (date range disabled).
  const expFrom = today;
  const expTo = today;
  interface ExpenseRow {
    id: string;
    category: string;
    description: string;
    amount: number;
    paymentMethod: string;
    reference: string | null;
    date: string;
    notes: string | null;
    recordedBy?: { name: string };
  }
  const { data: expenses = [] } = useQuery<ExpenseRow[]>({
    queryKey: ['expenses-list', expFrom, expTo],
    queryFn: () => api.get(`/expenses?from=${expFrom}&to=${expTo}`),
    enabled: tab === 'expense',
  });

  // Apply the display rules
  const displayOrders = useMemo(() => {
    if (!data) return [];
    const allOrders = data.orders;

    if (mode === 'today') {
      // Today: show all orders
      return allOrders;
    }

    // Date range: skip today's data, show 10% random per month
    const todayStr = today;
    const filtered = allOrders.filter((o) => !o.paidAt.startsWith(todayStr));
    return sampleByMonth(filtered);
  }, [data, mode, today]);

  const isToday = mode === 'today';

  // Grand totals of displayed orders
  const grandSubtotal = displayOrders.reduce((s, o) => s + o.subtotal, 0);
  const grandDiscount = displayOrders.reduce((s, o) => s + o.discountAmount, 0);
  const grandSd = displayOrders.reduce((s, o) => s + (o.sdAmount ?? 0), 0);
  const grandTax = displayOrders.reduce((s, o) => s + o.taxAmount, 0);
  const grandTotal = displayOrders.reduce((s, o) => s + o.totalAmount, 0);

  // Open the Mushak 6.3 invoice slip for an order in a popup window so
  // the cashier can reprint it. Hits the existing
  // `/mushak/invoices/by-order/:orderId` endpoint, then renders the
  // snapshot via the shared utility (same path RefundOrderDialog uses
  // for its 6.8 credit-note slip).
  const openMushakInvoice = async (orderId: string) => {
    try {
      const inv = await api.get<{ snapshot: MushakSnapshot } | null>(`/mushak/invoices/by-order/${orderId}`);
      if (!inv?.snapshot) {
        alert('Mushak invoice not found for this order.');
        return;
      }
      const w = window.open('', '_blank', 'width=360,height=700');
      if (!w) {
        alert('Popup blocked. Allow popups to print the Mushak invoice.');
        return;
      }
      w.document.write(renderMushakSlipHtml(inv.snapshot));
      w.document.close();
    } catch (e) {
      alert(`Failed to load Mushak invoice: ${(e as Error).message}`);
    }
  };

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<html><head>
      <title>Sales Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'DM Sans', Arial, sans-serif; font-size: 11px; color: #111; padding: 20px; }
        h1 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 2px; margin-bottom: 4px; }
        .meta { font-size: 10px; color: #666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #666; border-bottom: 1px solid #DDD; padding: 6px 4px; font-weight: 600; }
        td { padding: 5px 4px; border-bottom: 1px solid #F2F1EE; font-size: 10px; vertical-align: top; }
        .text-right { text-align: right; }
        .font-medium { font-weight: 500; }
        .total-row td { border-top: 2px solid #111; font-weight: 600; font-size: 11px; padding-top: 8px; }
        .items { font-size: 9px; color: #666; }
        @media print { body { padding: 10mm; } }
      </style>
    </head><body>${el.innerHTML}
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
  };

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Top bar */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <button
          onClick={() => void navigate('/tables')}
          className="text-theme-text-muted hover:text-theme-accent flex items-center gap-1 text-sm font-semibold transition-colors"
        >
          <ArrowLeft size={16} /> Tables
        </button>
        <div className="h-8 w-px bg-theme-border" />
        <h1 className="text-xl font-extrabold text-theme-text">Reports</h1>
        <div className="flex gap-1 bg-theme-bg rounded-theme p-1 ml-2">
          <button
            onClick={() => setTab('sales')}
            className={`px-4 py-1.5 text-xs rounded-theme transition-colors ${
              tab === 'sales' ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-semibold hover:text-theme-text'
            }`}
          >
            Sales
          </button>
          <button
            onClick={() => setTab('items')}
            className={`px-4 py-1.5 text-xs rounded-theme transition-colors ${
              tab === 'items' ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-semibold hover:text-theme-text'
            }`}
          >
            Items Sold
          </button>
          <button
            onClick={() => setTab('expense')}
            className={`px-4 py-1.5 text-xs rounded-theme transition-colors ${
              tab === 'expense' ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-semibold hover:text-theme-text'
            }`}
          >
            Expense
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2 rounded-theme text-sm transition-colors"
        >
          <Printer size={14} /> Print / PDF
        </button>
      </header>

      {/* Controls — date range only available on the Sales tab for now */}
      {tab === 'sales' ? (
        <div className="px-6 py-4 flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border">
            <button
              onClick={() => setMode('today')}
              className={`px-5 py-2 text-sm rounded-theme transition-colors ${
                mode === 'today' ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setMode('range')}
              className={`px-5 py-2 text-sm rounded-theme transition-colors ${
                mode === 'range' ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'
              }`}
            >
              Date Range
            </button>
          </div>
          {mode === 'range' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-theme-surface border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent"
              />
              <span className="text-theme-text-muted text-xs">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-theme-surface border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent"
              />
            </div>
          )}
          <span className="text-xs text-theme-text-muted ml-auto font-semibold">
            {displayOrders.length} order{displayOrders.length !== 1 ? 's' : ''}
            {!isToday && data ? ` (sampled from ${data.orders.filter((o) => !o.paidAt.startsWith(today)).length})` : ''}
          </span>
        </div>
      ) : (
        <div className="px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border">
            <span className="px-5 py-2 text-sm rounded-theme font-semibold text-theme-accent border-2 border-theme-accent">
              Today
            </span>
          </div>
          {tab === 'items' && itemsSold && (
            <span className="text-xs text-theme-text-muted ml-auto font-semibold">
              {itemsSold.rows.length} item{itemsSold.rows.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Items-Sold table — today only (POS) */}
      {tab === 'items' && (
        <div className="flex-1 overflow-auto px-6 pb-6">
          <div className="bg-theme-surface rounded-theme border border-theme-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-theme-bg">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {itemsLoading ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-theme-text-muted text-sm">Loading…</td></tr>
                ) : !itemsSold || itemsSold.rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-theme-text-muted text-sm">No items sold today yet.</td></tr>
                ) : (
                  <>
                    {itemsSold.rows.map((r, idx) => (
                      <tr key={`${r.menuItemId}-${r.unitPrice}`} className="border-t border-theme-border hover:bg-theme-bg/40">
                        <td className="px-4 py-3 text-theme-text-muted text-xs">{idx + 1}</td>
                        <td className="px-4 py-3 text-theme-text">{r.name}</td>
                        <td className="px-4 py-3 text-right text-theme-text-muted">{r.quantity}×</td>
                        <td className="px-4 py-3 text-right text-theme-text-muted">{formatCurrency(Number(r.unitPrice))}</td>
                        <td className="px-4 py-3 text-right font-bold text-theme-text">{formatCurrency(Number(r.totalRevenue))}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
              {itemsSold && itemsSold.rows.length > 0 && (
                <tfoot className="bg-theme-bg">
                  <tr className="text-sm font-bold border-t-2 border-theme-border">
                    <td className="px-4 py-3 text-theme-text-muted uppercase tracking-wider text-[11px]" colSpan={2}>Grand Total</td>
                    <td className="px-4 py-3 text-right">{itemsSold.totals.quantity}×</td>
                    <td></td>
                    <td className="px-4 py-3 text-right text-theme-accent text-base">{formatCurrency(Number(itemsSold.totals.revenue))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Expense table */}
      {tab === 'expense' && (
        <div className="flex-1 overflow-auto px-6 pb-6">
          <div className="bg-theme-surface rounded-theme border border-theme-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-theme-bg">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
                  <th className="px-4 py-3 text-left">Date · Time</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Method</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const dt = new Date(e.date);
                  const dateStr = dt.toLocaleDateString();
                  const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <tr key={e.id} className="border-t border-theme-border hover:bg-theme-bg/40">
                      <td className="px-4 py-3 text-theme-text-muted whitespace-nowrap">
                        {dateStr} · <span className="text-theme-text-muted/80">{timeStr}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-theme-accent bg-theme-accent-soft px-2 py-0.5 rounded">
                          {e.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-theme-text">{e.description}</td>
                      <td className="px-4 py-3 text-right font-bold text-theme-text">{formatCurrency(Number(e.amount))}</td>
                      <td className="px-4 py-3 text-theme-text-muted">{e.paymentMethod}</td>
                    </tr>
                  );
                })}
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-theme-text-muted text-sm">
                      No expenses in this period
                    </td>
                  </tr>
                )}
              </tbody>
              {expenses.length > 0 && (
                <tfoot className="bg-theme-bg">
                  <tr className="text-sm font-bold border-t-2 border-theme-border">
                    <td className="px-4 py-3 text-theme-text-muted uppercase tracking-wider text-[11px]" colSpan={3}>Total · {expenses.length} entries</td>
                    <td className="px-4 py-3 text-right text-theme-danger text-base">
                      {formatCurrency(expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Sales table */}
      {tab === 'sales' && (
      <div className="flex-1 overflow-auto px-6 pb-6 [&_table]:bg-theme-surface [&_table]:rounded-theme [&_table]:border [&_table]:border-theme-border">
        {isLoading ? (
          <p className="text-sm text-theme-text-muted font-theme-body py-8 text-center">Loading...</p>
        ) : (
          <div ref={printRef}>
            <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 2, marginBottom: 4 }}>
              SALES REPORT
            </h1>
            <p className="meta" style={{ fontSize: 10, color: '#666', marginBottom: 16 }}>
              {isToday
                ? `Today — ${formatDate(new Date().toISOString())}`
                : `${formatDate(from)} — ${formatDate(to)}`
              }
              {' '} | {displayOrders.length} orders
            </p>

            <table className="w-full text-xs font-theme-body" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr className="text-left">
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>#</th>
                  {/* Order # — server-generated, persisted on the row,
                      identical to what prints on the receipt. Always
                      shown so a row in the report can be matched 1:1
                      to a printed receipt across both Today + Date
                      Range views. */}
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Order #</th>
                  {/* "Mushak Register Serial #" — only meaningful when
                      cashiers are reprinting today's invoices from the
                      register. Hidden in the Date Range view (Mushak
                      reprints aren't part of historical reporting). */}
                  {isToday && (
                    <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Mushak Serial #</th>
                  )}
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>{isToday ? 'Time' : 'Date & Time'}</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Type</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Table</th>
                  {/* Items column intentionally hidden — register report only needs amounts. */}
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Subtotal</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Discount</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>SD</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>VAT</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Total</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Payment</th>
                  {canCorrectPayment && isToday && (
                    <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Fix</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayOrders.map((order, idx) => (
                  <tr key={order.id}>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>{idx + 1}</td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>
                      {shortOrderCode(order.id)}
                    </td>
                    {isToday && (
                      <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>
                        {order.mushakInvoice ? (
                          <button
                            onClick={() => void openMushakInvoice(order.id)}
                            title="Reprint Mushak 6.3 invoice"
                            className="text-theme-accent hover:underline"
                            style={{ background: 'none', border: 0, padding: 0, fontFamily: 'monospace', letterSpacing: 1, cursor: 'pointer' }}
                          >
                            {order.mushakInvoice.serial}
                          </button>
                        ) : (
                          <span style={{ color: '#999' }}>—</span>
                        )}
                      </td>
                    )}
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {isToday ? formatTime(order.paidAt) : formatDateTime(order.paidAt)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {order.type === 'DINE_IN' ? 'Dine In' : order.type === 'TAKEAWAY' ? 'T/A' : order.type}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {order.tableNumber || '—'}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right' }}>
                      {formatCurrency(order.subtotal)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right', color: order.discountAmount > 0 ? '#2e7d32' : '#666' }}>
                      {order.discountAmount > 0 ? `-${formatCurrency(order.discountAmount)}` : '—'}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right' }}>
                      {(order.sdAmount ?? 0) > 0 ? formatCurrency(order.sdAmount) : '—'}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right' }}>
                      {formatCurrency(order.taxAmount)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right', fontWeight: 500 }}>
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {order.paymentMethod}
                    </td>
                    {canCorrectPayment && isToday && (
                      <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                        <button onClick={() => setCorrecting(order)} title="Correct payment method"
                          className="text-theme-accent hover:underline inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                          <Wrench size={11} /> Fix
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {/* Grand total row — colSpan covers #, Order #,
                    (Mushak Serial), Time, Type, Table. That's 6 cols
                    on Today, 5 on Date Range (Mushak hidden there).
                    Then Subtotal, Discount, SD, VAT, Total, Payment,
                    (Fix). */}
                {displayOrders.length > 0 && (
                  <tr>
                    <td colSpan={isToday ? 6 : 5} style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, padding: '8px 4px' }}>
                      GRAND TOTAL
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandSubtotal)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px', color: grandDiscount > 0 ? '#2e7d32' : undefined }}>
                      {grandDiscount > 0 ? `-${formatCurrency(grandDiscount)}` : '—'}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {grandSd > 0 ? formatCurrency(grandSd) : '—'}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandTax)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandTotal)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', padding: '8px 4px' }}></td>
                    {canCorrectPayment && isToday && (
                      <td style={{ borderTop: '2px solid #111', padding: '8px 4px' }}></td>
                    )}
                  </tr>
                )}
              </tbody>
            </table>

            {displayOrders.length === 0 && (
              <p style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: '40px 0' }}>No orders found for this period.</p>
            )}
          </div>
        )}
      </div>
      )}

      {correcting && (
        <PosCorrectPaymentDialog
          orderId={correcting.id}
          orderNumber={correcting.orderNumber}
          total={correcting.totalAmount}
          currentMethod={correcting.paymentMethod}
          onClose={() => setCorrecting(null)}
        />
      )}
    </div>
  );
}

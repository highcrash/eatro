import { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

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
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
}

interface SalesData {
  from: string;
  to: string;
  orders: SalesOrder[];
}

// Generate a short random code for display instead of actual order number
function shortCode(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  let h = Math.abs(hash);
  for (let i = 0; i < 6; i++) {
    result += chars[h % chars.length];
    h = Math.floor(h / chars.length) + i;
  }
  return result;
}

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

  // Sales / Expense tab selector
  const [tab, setTab] = useState<'sales' | 'expense'>('sales');

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
  const grandTax = displayOrders.reduce((s, o) => s + o.taxAmount, 0);
  const grandTotal = displayOrders.reduce((s, o) => s + o.totalAmount, 0);

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
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Ref</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>{isToday ? 'Time' : 'Date & Time'}</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Type</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Table</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Items</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Subtotal</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Discount</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>VAT</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Total</th>
                  <th style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#666', borderBottom: '1px solid #DDD', padding: '6px 4px', fontWeight: 600 }}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {displayOrders.map((order, idx) => (
                  <tr key={order.id}>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>{idx + 1}</td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>{shortCode(order.id)}</td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {isToday ? formatTime(order.paidAt) : formatDateTime(order.paidAt)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {order.type === 'DINE_IN' ? 'Dine In' : order.type === 'TAKEAWAY' ? 'T/A' : order.type}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10 }}>
                      {order.tableNumber || '—'}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 9, color: '#666' }}>
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right' }}>
                      {formatCurrency(order.subtotal)}
                    </td>
                    <td style={{ padding: '5px 4px', borderBottom: '1px solid #F2F1EE', fontSize: 10, textAlign: 'right', color: order.discountAmount > 0 ? '#2e7d32' : '#666' }}>
                      {order.discountAmount > 0 ? `-${formatCurrency(order.discountAmount)}` : '—'}
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
                  </tr>
                ))}
                {/* Grand total row */}
                {displayOrders.length > 0 && (
                  <tr>
                    <td colSpan={6} style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, padding: '8px 4px' }}>
                      GRAND TOTAL
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandSubtotal)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px', color: grandDiscount > 0 ? '#2e7d32' : undefined }}>
                      {grandDiscount > 0 ? `-${formatCurrency(grandDiscount)}` : '—'}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandTax)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', fontWeight: 600, fontSize: 11, paddingTop: 8, textAlign: 'right', padding: '8px 4px' }}>
                      {formatCurrency(grandTotal)}
                    </td>
                    <td style={{ borderTop: '2px solid #111', padding: '8px 4px' }}></td>
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
    </div>
  );
}

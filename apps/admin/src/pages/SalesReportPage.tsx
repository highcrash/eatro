import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Search, X, Wrench } from 'lucide-react';

import type { Order, MushakInvoice, CorrectPaymentDto } from '@restora/types';
import { formatCurrency, formatDateTime, renderMushakSlipHtml, type MushakSnapshot } from '@restora/utils';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

/**
 * Renders the Mushak-6.3 column cell. Fetches-on-demand (enabled only for
 * PAID / refunded rows) so the list isn't blocked by N+1 lookups on orders
 * that can't have an invoice anyway (PENDING, VOID, etc.).
 */
function MushakPrintCell({ orderId, status }: { orderId: string; status: string }) {
  const canHaveInvoice = status === 'PAID' || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED';
  const { data } = useQuery<MushakInvoice | null>({
    queryKey: ['mushak-invoice-by-order', orderId],
    queryFn: async () => {
      try {
        return await api.get<MushakInvoice | null>(`/mushak/invoices/by-order/${orderId}`);
      } catch {
        return null;
      }
    },
    enabled: canHaveInvoice,
    staleTime: 60_000,
  });
  if (!canHaveInvoice) return <span className="text-[#555] text-xs">—</span>;
  if (!data) return <span className="text-[#666] text-xs">—</span>;
  const print = () => {
    const w = window.open('', '_blank', 'width=360,height=700');
    if (!w) return;
    w.document.write(renderMushakSlipHtml(data.snapshot as MushakSnapshot));
    w.document.close();
  };
  return (
    <button onClick={print} className="text-[#FFA726] hover:text-white text-xs font-mono tracking-tight transition-colors">
      {data.serial}
    </button>
  );
}

const STATUS_OPTIONS = ['ALL', 'PAID', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'VOID'] as const;
const TYPE_OPTIONS = ['ALL', 'DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;

// ─── Order Detail Modal ──────────────────────────────────────────────────────

function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const activeItems = order.items.filter((i) => !i.voidedAt);
  const voidedItems = order.items.filter((i) => i.voidedAt);
  const subtotal = Number(order.subtotal);
  const tax = Number(order.taxAmount);
  const discount = Number(order.discountAmount);
  const total = Number(order.totalAmount);

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Order ${order.orderNumber}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#111;padding:24px;max-width:800px;margin:0 auto}
        h1{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px}.meta{font-size:11px;color:#666;margin:4px 0 16px}.meta span{margin-right:16px}
        table{width:100%;border-collapse:collapse;margin:12px 0}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:8px 6px}
        td{padding:6px;border-bottom:1px solid #F2F1EE}.text-right{text-align:right}.total-section{margin-top:16px;border-top:2px solid #111;padding-top:12px}
        .total-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}.total-row.grand{font-weight:700;font-size:14px;border-top:1px solid #DDD;padding-top:8px;margin-top:4px}
        .voided{opacity:0.4;text-decoration:line-through}@media print{body{padding:10mm}}
      </style></head><body>
        <h1>ORDER #${order.orderNumber}</h1>
        <div class="meta">
          <span>${formatDateTime(order.createdAt)}</span><span>${order.type.replace('_', ' ')}</span>
          <span>${order.tableNumber ? 'Table ' + order.tableNumber : '—'}</span><span>Status: ${order.status}</span>
        </div>
        <table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th class="text-right">Unit Price</th><th class="text-right">Total</th><th>Kitchen</th></tr></thead>
        <tbody>
          ${activeItems.map((i, idx) => `<tr><td>${idx + 1}</td><td>${i.menuItemName}</td><td>${i.quantity}</td><td class="text-right">${formatCurrency(Number(i.unitPrice))}</td><td class="text-right">${formatCurrency(Number(i.totalPrice))}</td><td>${i.kitchenStatus}</td></tr>`).join('')}
          ${voidedItems.map((i) => `<tr class="voided"><td>—</td><td>${i.menuItemName}</td><td>${i.quantity}</td><td class="text-right">${formatCurrency(Number(i.unitPrice))}</td><td class="text-right">${formatCurrency(Number(i.totalPrice))}</td><td>VOIDED</td></tr>`).join('')}
        </tbody></table>
        <div class="total-section">
          <div class="total-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
          <div class="total-row"><span>VAT</span><span>${formatCurrency(tax)}</span></div>
          ${discount > 0 ? `<div class="total-row"><span>${(order as any).discountName || 'Discount'}${(order as any).couponCode ? ' (' + (order as any).couponCode + ')' : ''}</span><span style="color:#2e7d32">-${formatCurrency(discount)}</span></div>` : ''}
          <div class="total-row grand"><span>Grand Total</span><span>${formatCurrency(total)}</span></div>
        </div>
        <div class="meta" style="margin-top:16px">Payment: ${order.paymentMethod || '—'}${order.paidAt ? ' | Paid: ' + formatDateTime(order.paidAt) : ''}</div>
        <script>window.onload=function(){window.print();}<\/script>
      </body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[640px] max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-[#161616] px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between z-10">
          <div>
            <h3 className="font-display text-2xl text-white tracking-wide">ORDER #{order.orderNumber}</h3>
            <p className="text-xs font-body text-[#666] mt-0.5">{formatDateTime(order.createdAt)} • {order.type.replace('_', ' ')} • {order.tableNumber ? `Table ${order.tableNumber}` : '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="text-[#999] hover:text-white p-1.5" title="Print"><Printer size={16} /></button>
            <button onClick={onClose} className="text-[#999] hover:text-white p-1.5"><X size={16} /></button>
          </div>
        </div>
        <div className="px-6 py-3 border-b border-[#2A2A2A]">
          <span className={`text-xs font-body font-medium tracking-widest uppercase px-2 py-1 ${order.status === 'PAID' ? 'bg-green-600/20 text-green-500' : order.status === 'VOID' ? 'bg-[#D62B2B]/20 text-[#D62B2B]' : 'bg-[#2A2A2A] text-[#999]'}`}>{order.status}</span>
          {order.paymentMethod && <span className="ml-3 text-xs font-body text-[#666]">Payment: {order.paymentMethod}</span>}
          {order.paidAt && <span className="ml-3 text-xs font-body text-[#666]">Paid: {formatDateTime(order.paidAt)}</span>}
        </div>
        <div className="px-6 py-4">
          <table className="w-full text-sm font-body">
            <thead><tr className="text-left text-xs text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="pb-2 font-medium">#</th><th className="pb-2 font-medium">Item</th><th className="pb-2 font-medium text-center">Qty</th>
              <th className="pb-2 font-medium text-right">Unit Price</th><th className="pb-2 font-medium text-right">Total</th><th className="pb-2 font-medium">Status</th>
            </tr></thead>
            <tbody>
              {activeItems.map((item, idx) => (
                <tr key={item.id} className="border-b border-[#2A2A2A]/50">
                  <td className="py-2 text-[#666]">{idx + 1}</td><td className="py-2 text-white">{item.menuItemName}</td>
                  <td className="py-2 text-center text-[#999]">{item.quantity}</td><td className="py-2 text-right text-[#999]">{formatCurrency(Number(item.unitPrice))}</td>
                  <td className="py-2 text-right text-white font-medium">{formatCurrency(Number(item.totalPrice))}</td>
                  <td className="py-2"><span className={`text-[10px] tracking-widest uppercase ${item.kitchenStatus === 'DONE' ? 'text-green-500' : item.kitchenStatus === 'PREPARING' ? 'text-orange-400' : 'text-[#666]'}`}>{item.kitchenStatus}</span></td>
                </tr>
              ))}
              {voidedItems.map((item) => (
                <tr key={item.id} className="border-b border-[#2A2A2A]/50 opacity-40">
                  <td className="py-2">—</td><td className="py-2 text-white line-through">{item.menuItemName}</td>
                  <td className="py-2 text-center">{item.quantity}</td><td className="py-2 text-right">{formatCurrency(Number(item.unitPrice))}</td>
                  <td className="py-2 text-right line-through">{formatCurrency(Number(item.totalPrice))}</td>
                  <td className="py-2 text-[#D62B2B] text-[10px] tracking-widest uppercase">VOIDED</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-[#2A2A2A] space-y-1">
          <div className="flex justify-between text-sm font-body text-[#999]"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="flex justify-between text-sm font-body text-[#999]"><span>VAT</span><span>{formatCurrency(tax)}</span></div>
          {discount > 0 && <div className="flex justify-between text-sm font-body text-green-500"><span>{(order as any).discountName || 'Discount'}{(order as any).couponCode ? ` (${(order as any).couponCode})` : ''}</span><span>-{formatCurrency(discount)}</span></div>}
          <div className="flex justify-between text-sm font-body font-medium text-white pt-2 border-t border-[#2A2A2A]">
            <span>Grand Total</span><span className="font-display text-xl tracking-wide">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Correct Payment Dialog ──────────────────────────────────────────────────

interface PaymentOption { code: string; name: string; isActive: boolean; category?: { code: string; name: string } }

/**
 * Owner / manager-only dialog to fix a wrong payment method on a PAID
 * order. Posts to /orders/:id/correct-payment which reverses the old
 * account postings, rewrites the OrderPayment rows, refreshes the
 * Mushak-6.3 snapshot, and credits the new account.
 */
function CorrectPaymentDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const total = Number(order.totalAmount);

  const { data: paymentOpts = [] } = useQuery<PaymentOption[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
  });
  const activeOpts = paymentOpts.filter((o) => o.isActive);

  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [method, setMethod] = useState<string>(order.paymentMethod ?? '');
  const [splits, setSplits] = useState<{ method: string; amount: number; reference?: string }[]>([
    { method: '', amount: Math.round(total / 2) },
    { method: '', amount: total - Math.round(total / 2) },
  ]);
  const [approverPin, setApproverPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const splitTotal = splits.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
  const splitDelta = splitTotal - total;

  const mutation = useMutation({
    mutationFn: (dto: CorrectPaymentDto) => api.post(`/orders/${order.id}/correct-payment`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['mushak-invoice-by-order', order.id] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Correction failed'),
  });

  const submit = () => {
    setError(null);
    if (mode === 'single') {
      if (!method) { setError('Pick a payment method'); return; }
      const dto: CorrectPaymentDto = {
        method,
        approverPin: approverPin || undefined,
        reason: reason || undefined,
      };
      mutation.mutate(dto);
    } else {
      if (splits.some((s) => !s.method) || splits.length < 2) { setError('Each split needs a method'); return; }
      if (Math.abs(splitDelta) > 1) { setError(`Split sum must equal ${formatCurrency(total)}`); return; }
      const dto: CorrectPaymentDto = {
        method: 'SPLIT',
        splits: splits.map((sp) => ({ method: sp.method, amount: sp.amount, reference: sp.reference })),
        approverPin: approverPin || undefined,
        reason: reason || undefined,
      };
      mutation.mutate(dto);
    }
  };

  const oldSummary = order.payments && order.payments.length > 0
    ? order.payments.map((p) => `${p.method} ${formatCurrency(Number(p.amount))}`).join(' + ')
    : (order.paymentMethod ?? '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#161616] w-[520px] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <div>
            <h3 className="font-display text-2xl text-white tracking-wide">CORRECT PAYMENT</h3>
            <p className="text-xs font-body text-[#666] mt-0.5">Order #{order.orderNumber} • {formatCurrency(total)}</p>
          </div>
          <button onClick={onClose} className="text-[#999] hover:text-white p-1.5"><X size={16} /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2">
            <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Currently recorded as</p>
            <p className="text-sm font-body text-white mt-0.5">{oldSummary}</p>
          </div>

          <div className="flex gap-0 border-b border-[#2A2A2A]">
            {(['single', 'split'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} type="button"
                className={`px-3 py-2 text-[10px] font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${
                  mode === m ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666]'
                }`}
              >{m === 'single' ? 'Single Method' : 'Split'}</button>
            ))}
          </div>

          {mode === 'single' ? (
            <div>
              <label className="text-[10px] font-body text-[#666] tracking-widest uppercase block mb-1.5">New Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-2 text-sm font-body text-white outline-none focus:border-[#D62B2B]">
                <option value="">Select payment method…</option>
                {activeOpts.map((o) => (
                  <option key={o.code} value={o.code}>{o.name}{o.category ? ` (${o.category.name})` : ''}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] font-body text-[#666] tracking-widest uppercase block">Splits</label>
              {splits.map((sp, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select value={sp.method}
                    onChange={(e) => setSplits(splits.map((x, i) => i === idx ? { ...x, method: e.target.value } : x))}
                    className="flex-1 bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-2 text-sm font-body text-white outline-none focus:border-[#D62B2B]">
                    <option value="">Method…</option>
                    {activeOpts.filter((o) => o.code !== 'SPLIT').map((o) => (
                      <option key={o.code} value={o.code}>{o.name}</option>
                    ))}
                  </select>
                  <input type="number" step="0.01" value={(sp.amount / 100).toFixed(2)}
                    onChange={(e) => setSplits(splits.map((x, i) => i === idx ? { ...x, amount: Math.round((Number(e.target.value) || 0) * 100) } : x))}
                    className="w-32 bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-2 text-sm font-body text-white outline-none focus:border-[#D62B2B] text-right" />
                  {splits.length > 2 && (
                    <button onClick={() => setSplits(splits.filter((_, i) => i !== idx))} type="button"
                      className="text-[#D62B2B] hover:text-white p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
              <div className="flex justify-between items-center pt-1">
                <button onClick={() => setSplits([...splits, { method: '', amount: 0 }])} type="button"
                  className="text-[10px] font-body text-[#FFA726] hover:text-white tracking-widest uppercase">+ Add split</button>
                <span className={`text-xs font-body ${Math.abs(splitDelta) > 1 ? 'text-[#D62B2B]' : 'text-green-500'}`}>
                  {splitTotal === total ? 'Balanced' : `${splitDelta > 0 ? '+' : ''}${formatCurrency(splitDelta)}`}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-body text-[#666] tracking-widest uppercase block mb-1.5">Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cashier tapped CASH instead of bKash"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-2 text-sm font-body text-white outline-none focus:border-[#D62B2B]" />
          </div>

          <div>
            <label className="text-[10px] font-body text-[#666] tracking-widest uppercase block mb-1.5">Approver PIN (optional)</label>
            <input type="password" value={approverPin} onChange={(e) => setApproverPin(e.target.value)}
              placeholder="Your password to confirm"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-2 text-sm font-body text-white outline-none focus:border-[#D62B2B]" />
            <p className="text-[10px] font-body text-[#555] mt-1">Owner / Manager only. PIN is verified when provided.</p>
          </div>

          {error && <div className="bg-[#D62B2B]/10 border border-[#D62B2B]/30 px-3 py-2 text-xs font-body text-[#D62B2B]">{error}</div>}

          <div className="flex gap-2 pt-2 border-t border-[#2A2A2A]">
            <button onClick={onClose} type="button" disabled={mutation.isPending}
              className="flex-1 border border-[#2A2A2A] px-3 py-2 text-xs font-body text-[#999] hover:border-[#666] hover:text-white tracking-widest uppercase transition-colors">Cancel</button>
            <button onClick={submit} type="button" disabled={mutation.isPending}
              className="flex-1 bg-[#D62B2B] hover:bg-[#B71C1C] px-3 py-2 text-xs font-body text-white tracking-widest uppercase transition-colors disabled:opacity-50">
              {mutation.isPending ? 'Correcting…' : 'Correct Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sales Report Page ───────────────────────────────────────────────────────

export default function SalesReportPage() {
  const [statusFilter, setStatusFilter] = useState('PAID');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [itemSearch, setItemSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [correctingOrder, setCorrectingOrder] = useState<Order | null>(null);
  const role = useAuthStore((s) => s.user?.role);
  const canCorrectPayment = role === 'OWNER' || role === 'MANAGER';

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['orders', dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      return api.get<Order[]>(`/orders?${params.toString()}`);
    },
  });

  const paymentMethods = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => { if (o.paymentMethod) set.add(o.paymentMethod); });
    return [...set].sort();
  }, [orders]);

  const filtered = useMemo(() => {
    let result = orders;
    if (statusFilter !== 'ALL') result = result.filter((o) => o.status === statusFilter);
    if (typeFilter !== 'ALL') result = result.filter((o) => o.type === typeFilter);
    if (paymentFilter) result = result.filter((o) => o.paymentMethod === paymentFilter);
    if (itemSearch.trim()) { const q = itemSearch.toLowerCase(); result = result.filter((o) => o.items.some((i) => i.menuItemName.toLowerCase().includes(q))); }
    return result;
  }, [orders, statusFilter, typeFilter, paymentFilter, dateFrom, dateTo, itemSearch]);

  const grandSubtotal = filtered.reduce((s, o) => s + Number(o.subtotal), 0);
  const grandDiscount = filtered.reduce((s, o) => s + Number(o.discountAmount), 0);
  const grandTax = filtered.reduce((s, o) => s + Number(o.taxAmount), 0);
  const grandTotal = filtered.reduce((s, o) => s + Number(o.totalAmount), 0);

  const handlePrint = () => {
    const rows = filtered.map((o, idx) => `<tr>
      <td>${idx + 1}</td><td>${o.orderNumber}</td><td>${formatDateTime(o.createdAt)}</td>
      <td>${o.type.replace('_', ' ')}</td><td>${o.tableNumber || '—'}</td>
      <td style="font-size:9px;color:#666">${o.items.filter((i) => !i.voidedAt).map((i) => i.quantity + '× ' + i.menuItemName).join(', ')}</td>
      <td class="r">${formatCurrency(Number(o.subtotal))}</td>
      <td class="r" style="color:${Number(o.discountAmount) > 0 ? '#2e7d32' : '#666'}">${Number(o.discountAmount) > 0 ? '-' + formatCurrency(Number(o.discountAmount)) : '—'}</td>
      <td class="r">${formatCurrency(Number(o.taxAmount))}</td>
      <td class="r" style="font-weight:500">${formatCurrency(Number(o.totalAmount))}</td>
      <td>${o.paymentMethod || '—'}</td><td>${o.status}</td>
    </tr>`).join('');
    const win = window.open('', '_blank', 'width=1100,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Sales Report</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;font-size:10px;color:#111;padding:20px}
      h1{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;margin-bottom:4px}.meta{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}th{text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:6px 4px;font-weight:600}
      td{padding:4px;border-bottom:1px solid #F2F1EE;font-size:9px}.r{text-align:right}.t td{border-top:2px solid #111;font-weight:700;font-size:10px;padding-top:8px}
      @media print{body{padding:8mm}}
    </style></head><body>
    <h1>SALES REPORT</h1><div class="meta">${filtered.length} orders${dateFrom ? ' | From: ' + dateFrom : ''}${dateTo ? ' To: ' + dateTo : ''}</div>
    <table><thead><tr><th>#</th><th>Order</th><th>Date</th><th>Type</th><th>Table</th><th>Items</th><th class="r">Subtotal</th><th class="r">Discount</th><th class="r">VAT</th><th class="r">Total</th><th>Payment</th><th>Status</th></tr></thead>
    <tbody>${rows}<tr class="t"><td colspan="6">GRAND TOTAL</td><td class="r">${formatCurrency(grandSubtotal)}</td><td class="r" style="color:#2e7d32">${grandDiscount > 0 ? '-' + formatCurrency(grandDiscount) : '—'}</td><td class="r">${formatCurrency(grandTax)}</td><td class="r">${formatCurrency(grandTotal)}</td><td colspan="2"></td></tr></tbody></table>
    <script>window.onload=function(){window.print();}<\/script></body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Reports</p>
          <h1 className="font-display text-4xl text-white tracking-wide">SALES REPORT</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-body text-[#999]">{filtered.length} orders</span>
          <button onClick={handlePrint} className="flex items-center gap-1.5 border border-[#2A2A2A] px-3 py-1.5 text-xs font-body text-[#999] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors">
            <Printer size={12} /> Print / PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#161616] border border-[#2A2A2A] p-4 space-y-3">
        <div className="flex gap-0 border-b border-[#2A2A2A] -mx-4 px-4">
          {STATUS_OPTIONS.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-[10px] font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${
                statusFilter === s ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666]'
              }`}
            >{s}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]">
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t.replace('_', ' ')}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]">
            <option value="">All Payments</option>
            {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555]" />
            <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by menu item..."
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] pl-8 pr-3 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B] placeholder:text-[#555]" />
          </div>
          {(dateFrom || dateTo || typeFilter !== 'ALL' || paymentFilter || itemSearch) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setTypeFilter('ALL'); setPaymentFilter(''); setItemSearch(''); }}
              className="text-[10px] font-body text-[#D62B2B] hover:underline tracking-widest uppercase">Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Date & Time</th><th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Table</th><th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium text-right">Subtotal</th><th className="px-4 py-3 font-medium text-right">Discount</th><th className="px-4 py-3 font-medium text-right">VAT</th>
              <th className="px-4 py-3 font-medium text-right">Total</th><th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Mushak</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-[#999]">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-[#999]">No orders found</td></tr>
            ) : (
              <>
                {filtered.map((o, idx) => (
                  <tr key={o.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F] cursor-pointer" onClick={() => setSelectedOrder(o)}>
                    <td className="px-4 py-2.5 text-[#666] text-xs">{idx + 1}</td>
                    <td className="px-4 py-2.5"><button className="text-[#D62B2B] font-medium text-xs hover:underline">{o.orderNumber}</button></td>
                    <td className="px-4 py-2.5 text-[#999] text-xs">{formatDateTime(o.createdAt)}</td>
                    <td className="px-4 py-2.5 text-[#999] text-xs">{o.type.replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-[#999] text-xs">{o.tableNumber ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[#666] text-[10px]">{o.items.filter((i) => !i.voidedAt).map((i) => `${i.quantity}× ${i.menuItemName}`).join(', ')}</td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{formatCurrency(Number(o.subtotal))}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{Number(o.discountAmount) > 0 ? <span className="text-green-600">-{formatCurrency(Number(o.discountAmount))}</span> : <span className="text-[#555]">—</span>}</td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{formatCurrency(Number(o.taxAmount))}</td>
                    <td className="px-4 py-2.5 text-right text-white font-medium text-xs">{formatCurrency(Number(o.totalAmount))}</td>
                    <td className="px-4 py-2.5 text-[#999] text-xs uppercase">{o.paymentMethod ?? '—'}</td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] font-medium tracking-widest uppercase ${o.status === 'PAID' ? 'text-green-600' : o.status === 'VOID' ? 'text-[#D62B2B]' : 'text-[#999]'}`}>{o.status}</span></td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <MushakPrintCell orderId={o.id} status={o.status} />
                    </td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {canCorrectPayment && (o.status === 'PAID' || o.status === 'PARTIALLY_REFUNDED' || o.status === 'REFUNDED') ? (
                        <button onClick={() => setCorrectingOrder(o)} title="Correct payment method"
                          className="text-[#FFA726] hover:text-white inline-flex items-center gap-1 text-xs">
                          <Wrench size={12} /> Fix
                        </button>
                      ) : <span className="text-[#555] text-xs">—</span>}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#0D0D0D]">
                  <td colSpan={6} className="px-4 py-3 text-xs font-body font-medium text-white tracking-widest uppercase">Grand Total</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-white">{formatCurrency(grandSubtotal)}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-green-500">{grandDiscount > 0 ? `-${formatCurrency(grandDiscount)}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-white">{formatCurrency(grandTax)}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-[#D62B2B] font-display text-base tracking-wide">{formatCurrency(grandTotal)}</td>
                  <td colSpan={4}></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
      {correctingOrder && <CorrectPaymentDialog order={correctingOrder} onClose={() => setCorrectingOrder(null)} />}
    </div>
  );
}

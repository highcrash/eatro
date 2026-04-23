import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { Order, OrderItem, RefundReason, MushakNote } from '@restora/types';
import { renderMushakSlipHtml, type MushakSnapshot } from '@restora/utils';
import { api } from '../lib/api';

const REASON_OPTIONS: { value: RefundReason; label: string }[] = [
  { value: 'CUSTOMER_RETURN', label: 'Customer return' },
  { value: 'PRICING_ERROR', label: 'Pricing error' },
  { value: 'DUPLICATE', label: 'Duplicate charge' },
  { value: 'DAMAGED', label: 'Item damaged / spoiled' },
  { value: 'OTHER', label: 'Other' },
];

interface Props {
  order: Order;
  onClose: () => void;
  onRefunded?: (note: MushakNote) => void;
}

/**
 * Paid-order refund dialog. Emits a Mushak-6.8 credit note via the API,
 * restores stock, reverses the account balance, and auto-prints the red
 * CREDIT NOTE slip. Cashier must enter an OWNER/MANAGER PIN (password) to
 * approve — reuses the void-approval pattern already in use.
 */
export default function RefundOrderDialog({ order, onClose, onRefunded }: Props) {
  const qc = useQueryClient();
  const activeItems = useMemo(() => order.items.filter((i) => !i.voidedAt), [order.items]);
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState<RefundReason>('CUSTOMER_RETURN');
  const [reasonText, setReasonText] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [error, setError] = useState('');

  const totals = useMemo(() => {
    const ids = mode === 'full' ? new Set(activeItems.map((i) => i.id)) : selectedIds;
    const subtotal = activeItems
      .filter((i) => ids.has(i.id))
      .reduce((s, i) => s + Number(i.totalPrice), 0);
    const orderNet = Math.max(1, Number(order.subtotal) - Number(order.discountAmount));
    const vat = Math.round((subtotal / orderNet) * Number(order.taxAmount) * 100) / 100;
    return { subtotal, vat, total: subtotal + vat, count: ids.size };
  }, [activeItems, mode, selectedIds, order]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refundMut = useMutation({
    mutationFn: () =>
      api.post<{ note: MushakNote; order: Order }>(`/orders/${order.id}/refund`, {
        itemIds: mode === 'partial' ? Array.from(selectedIds) : undefined,
        reason,
        reasonText: reasonText.trim() || undefined,
        approverPin: approverPin || undefined,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      // Auto-print the 6.8 credit-note slip so the cashier has paper to
      // hand to the customer immediately — same UX as the original 6.3.
      const snapshot = res.note.snapshot as MushakSnapshot;
      if (snapshot) {
        const w = window.open('', '_blank', 'width=360,height=700');
        if (w) {
          w.document.write(renderMushakSlipHtml(snapshot));
          w.document.close();
        }
      }
      onRefunded?.(res.note);
      onClose();
    },
    onError: (e: Error) => setError(e.message || 'Refund failed'),
  });

  const canSubmit = (mode === 'full' || selectedIds.size > 0) && !!reason && !refundMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface text-theme-text w-full max-w-lg rounded-theme border border-theme-border" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-widest uppercase text-theme-danger font-bold">Refund / Mushak-6.8</p>
            <h2 className="text-lg font-extrabold">Order #{order.orderNumber}</h2>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text"><X size={16} /></button>
        </header>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="flex items-stretch gap-0 border border-theme-border rounded-theme overflow-hidden">
            {(['full', 'partial'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-2 text-xs font-bold tracking-widest uppercase transition-colors ${
                  mode === m ? 'bg-theme-danger text-white' : 'text-theme-text-muted hover:text-theme-text'
                }`}
              >
                {m === 'full' ? 'Full refund' : 'Select items'}
              </button>
            ))}
          </div>

          {mode === 'partial' && (
            <div className="space-y-1.5 border border-theme-border rounded-theme p-2 max-h-60 overflow-auto">
              {activeItems.map((i: OrderItem) => (
                <label key={i.id} className="flex items-center gap-3 p-2 hover:bg-theme-bg rounded-theme cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(i.id)}
                    onChange={() => toggle(i.id)}
                    className="w-4 h-4 accent-theme-danger"
                  />
                  <span className="flex-1 text-sm">{i.quantity}× {i.menuItemName}</span>
                  <span className="text-xs text-theme-text-muted">৳{Number(i.totalPrice).toFixed(2)}</span>
                </label>
              ))}
            </div>
          )}

          <div>
            <label className="block text-[10px] tracking-widest uppercase text-theme-text-muted mb-1">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as RefundReason)}
              className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm outline-none focus:border-theme-danger"
            >
              {REASON_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] tracking-widest uppercase text-theme-text-muted mb-1">Note (optional)</label>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={2}
              className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm outline-none focus:border-theme-danger resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-widest uppercase text-theme-text-muted mb-1">Approver password (OWNER / MANAGER)</label>
            <input
              type="password"
              value={approverPin}
              onChange={(e) => setApproverPin(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm outline-none focus:border-theme-danger"
            />
          </div>

          <div className="border-t border-theme-border pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-theme-text-muted"><span>Items selected</span><span>{totals.count}</span></div>
            <div className="flex justify-between text-theme-text-muted"><span>Subtotal</span><span>৳{totals.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-theme-text-muted"><span>VAT reversed</span><span>৳{totals.vat.toFixed(2)}</span></div>
            <div className="flex justify-between text-theme-danger font-extrabold text-lg border-t border-theme-border pt-1"><span>Refund total</span><span>৳{totals.total.toFixed(2)}</span></div>
          </div>

          {error && <p className="text-xs text-theme-danger">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-theme-border flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-theme-border py-2.5 text-sm font-bold tracking-widest uppercase text-theme-text-muted hover:text-theme-text"
          >
            Cancel
          </button>
          <button
            onClick={() => { setError(''); refundMut.mutate(); }}
            disabled={!canSubmit}
            className="flex-1 bg-theme-danger text-white py-2.5 text-sm font-bold tracking-widest uppercase disabled:opacity-40 hover:opacity-90"
          >
            {refundMut.isPending ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}

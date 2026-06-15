import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Payroll } from '@restora/types';

interface Props {
  payroll: Payroll | null;
  onClose: () => void;
  /** Invalidation key prefixes to bust after pay succeeds. */
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

export function PayDialog({ payroll, onClose, invalidateKeys = [] }: Props) {
  const qc = useQueryClient();
  const { data: paymentOptions = [] } = useQuery<
    { code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]
  >({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
    select: (d: any[]) => d.filter((o) => o.isActive),
  });
  const [form, setForm] = useState({ amount: '', paymentMethod: 'CASH', reference: '', notes: '' });

  useEffect(() => {
    if (!payroll) return;
    const remaining = (Number(payroll.netPayable) - Number(payroll.paidAmount)) / 100;
    setForm({ amount: remaining.toFixed(2), paymentMethod: 'CASH', reference: '', notes: '' });
  }, [payroll]);

  const payMutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/${payroll!.id}/pay`, {
        amount: Math.round(parseFloat(form.amount) * 100),
        paymentMethod: form.paymentMethod,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      for (const key of invalidateKeys) void qc.invalidateQueries({ queryKey: key as unknown[] });
      if (payroll) void qc.invalidateQueries({ queryKey: ['payroll-payments', payroll.id] });
      onClose();
    },
  });

  if (!payroll) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-white tracking-widest mb-1">PAY SALARY</h2>
        <p className="text-[#999] font-body text-sm mb-4">
          {payroll.staff?.name} — Net: {formatCurrency(payroll.netPayable)}
          {Number(payroll.paidAmount) > 0 &&
            ` | Paid: ${formatCurrency(payroll.paidAmount)} | Remaining: ${formatCurrency(Number(payroll.netPayable) - Number(payroll.paidAmount))}`}
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Method</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              >
                {paymentOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                    {o.category ? ` (${o.category.name})` : ''}
                  </option>
                ))}
                {paymentOptions.length === 0 && (
                  <>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                  </>
                )}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Reference</label>
            <input
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="Transaction ID, etc."
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            />
          </div>
        </div>

        {payroll.payments && payroll.payments.length > 0 && (
          <div className="mt-4 border-t border-[#2A2A2A] pt-3">
            <p className="text-[#666] text-xs font-body tracking-widest uppercase mb-2">Payment History</p>
            {payroll.payments.map((pay) => (
              <div key={pay.id} className="flex justify-between text-xs font-body py-1 border-b border-[#1F1F1F] last:border-0">
                <span className="text-[#999]">
                  {new Date(pay.createdAt).toLocaleDateString()} — {pay.paymentMethod}
                  {pay.paidBy ? ` by ${pay.paidBy.name}` : ''}
                </span>
                <span className="text-[#4CAF50]">{formatCurrency(pay.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {payMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(payMutation.error as Error).message}</p>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => payMutation.mutate()}
            disabled={!form.amount || parseFloat(form.amount) <= 0 || payMutation.isPending}
            className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
          >
            {payMutation.isPending ? 'Processing…' : 'Make Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

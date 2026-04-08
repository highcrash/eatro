import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Plus, Trash2 } from 'lucide-react';

import type { Order } from '@restora/types';
import { formatCurrency, toMajorUnit } from '@restora/utils';
import { api } from '../lib/api';

interface PaymentModalProps {
  order: Order;
  onClose: () => void;
  onSuccess: (paidOrder: Order, cashReceived: number) => void;
}

interface SplitEntry {
  method: string; // option code
  amount: string;
  reference: string;
}

interface PMOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

interface PMCategory {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  options: PMOption[];
}

export default function PaymentModal({ order, onClose, onSuccess }: PaymentModalProps) {
  // Fetch two-level payment method categories with options
  const { data: categories = [] } = useQuery<PMCategory[]>({
    queryKey: ['payment-methods'],
    queryFn: () => api.get('/payment-methods'),
    select: (d) => d.filter((c) => c.isActive && c.options.some((o) => o.isActive)),
  });

  // Build flat list of active options for split mode
  const allOptions = categories.flatMap((c) =>
    c.options.filter((o) => o.isActive).map((o) => ({ code: o.code, name: o.name, catCode: c.code })),
  );

  const [isSplit, setIsSplit] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedOptionCode, setSelectedOptionCode] = useState<string>('CASH');
  const [cashInput, setCashInput] = useState('');
  const [splits, setSplits] = useState<SplitEntry[]>([
    { method: 'CASH', amount: '', reference: '' },
    { method: allOptions.find((o) => o.catCode === 'MFS' || o.catCode === 'CARD')?.code ?? 'CASH', amount: '', reference: '' },
  ]);

  // Auto-select first category on load
  const activeCat = selectedCatId
    ? categories.find((c) => c.id === selectedCatId)
    : categories[0];

  // When no cat selected yet, default to first
  if (!selectedCatId && categories.length > 0 && activeCat) {
    // Will be set on first render interaction; default option is the default of first cat
    const defaultOpt = activeCat.options.find((o) => o.isDefault && o.isActive) ?? activeCat.options.find((o) => o.isActive);
    if (defaultOpt && selectedOptionCode === 'CASH' && defaultOpt.code !== 'CASH') {
      // keep CASH as default - it's fine
    }
  }

  const selectCategory = (catId: string) => {
    setSelectedCatId(catId);
    const cat = categories.find((c) => c.id === catId);
    if (cat) {
      const defaultOpt = cat.options.find((o) => o.isDefault && o.isActive) ?? cat.options.find((o) => o.isActive);
      if (defaultOpt) setSelectedOptionCode(defaultOpt.code);
    }
  };

  const isCashOption = activeCat?.code === 'CASH';

  const total = Number(order.totalAmount);
  const totalMajor = toMajorUnit(total);

  // Single payment
  const cashPaisa = Math.round(parseFloat(cashInput || '0') * 100);
  const change = cashPaisa - total;

  // Split helpers
  const splitTotalPaisa = splits.reduce((s, sp) => s + Math.round(parseFloat(sp.amount || '0') * 100), 0);
  const splitRemaining = total - splitTotalPaisa;
  const splitValid = Math.abs(splitRemaining) <= 1 && splits.length >= 2;

  const cashSplit = splits.find((s) => {
    const opt = allOptions.find((o) => o.code === s.method);
    return opt?.catCode === 'CASH';
  });

  const addSplit = useCallback(() => {
    setSplits((prev) => [...prev, { method: 'CASH', amount: '', reference: '' }]);
  }, []);

  const removeSplit = useCallback((idx: number) => {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateSplit = useCallback((idx: number, field: keyof SplitEntry, value: string) => {
    setSplits((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }, []);

  const autoFillLast = useCallback(() => {
    if (splits.length < 2) return;
    const allButLast = splits.slice(0, -1);
    const filledTotal = allButLast.reduce((s, sp) => s + Math.round(parseFloat(sp.amount || '0') * 100), 0);
    const remaining = total - filledTotal;
    if (remaining > 0) {
      setSplits((prev) => prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, amount: (remaining / 100).toFixed(2) } : s
      ));
    }
  }, [splits, total]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isSplit) {
        return api.post<Order>(`/orders/${order.id}/payment`, {
          method: 'SPLIT',
          amount: total,
          splits: splits.map((s) => ({
            method: s.method,
            amount: Math.round(parseFloat(s.amount || '0') * 100),
            reference: s.reference || undefined,
          })),
        });
      }
      return api.post<Order>(`/orders/${order.id}/payment`, {
        method: selectedOptionCode,
        amount: total,
      });
    },
    onSuccess: (paid) => {
      const received = isSplit
        ? (cashSplit ? Math.round(parseFloat(cashSplit.amount || '0') * 100) : total)
        : (isCashOption ? cashPaisa : total);
      onSuccess(paid, received);
    },
  });

  const canConfirm = isSplit
    ? splitValid
    : !isCashOption || (cashInput.trim() !== '' && cashPaisa >= total);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-bold text-theme-text">Payment</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">Order #{order.orderNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Total */}
          <div className="bg-theme-bg rounded-theme p-4 flex justify-between items-baseline">
            <span className="text-sm font-semibold text-theme-text-muted">Total due</span>
            <span className="text-3xl font-extrabold text-theme-text">{formatCurrency(total)}</span>
          </div>

          {/* Split toggle */}
          <div className="flex items-center gap-1 bg-theme-bg rounded-theme p-1">
            <button
              onClick={() => setIsSplit(false)}
              className={`flex-1 py-2 text-sm rounded-theme transition-colors ${
                !isSplit ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-medium'
              }`}
            >
              Single
            </button>
            <button
              onClick={() => setIsSplit(true)}
              className={`flex-1 py-2 text-sm rounded-theme transition-colors ${
                isSplit ? 'bg-theme-surface text-theme-text font-bold shadow-sm' : 'text-theme-text-muted font-medium'
              }`}
            >
              Split
            </button>
          </div>

          {/* Single Payment Mode */}
          {!isSplit && (
            <>
              {/* Category tabs */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">
                  Payment method
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => selectCategory(cat.id)}
                      className={`py-3 text-sm rounded-theme border-2 transition-colors ${
                        activeCat?.id === cat.id
                          ? 'bg-theme-accent border-theme-accent text-white font-bold'
                          : 'bg-theme-surface border-theme-border text-theme-text-muted font-semibold hover:border-theme-accent'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Option buttons */}
              {activeCat && activeCat.options.filter((o) => o.isActive).length > 1 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">
                    Select option
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {activeCat.options
                      .filter((o) => o.isActive)
                      .map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setSelectedOptionCode(opt.code)}
                          className={`py-2.5 text-sm rounded-theme border-2 transition-colors ${
                            selectedOptionCode === opt.code
                              ? 'bg-theme-accent-soft border-theme-accent text-theme-accent font-bold'
                              : 'bg-theme-surface border-theme-border text-theme-text-muted font-semibold hover:border-theme-accent'
                          }`}
                        >
                          {opt.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {isCashOption && (
                <div>
                  <label className="text-xs font-theme-body font-medium font-semibold text-theme-text-muted block mb-2">
                    Amount received
                  </label>
                  <input
                    type="number"
                    min={totalMajor}
                    step="0.01"
                    value={cashInput}
                    onChange={(e) => setCashInput(e.target.value)}
                    placeholder={totalMajor.toFixed(2)}
                    className="w-full border border-theme-border rounded-theme px-4 py-3 font-theme-display text-2xl tracking-wide text-theme-text outline-none focus:border-theme-accent placeholder:text-theme-border"
                    autoFocus
                  />
                  {/* Numpad */}
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          if (k === '⌫') setCashInput((v) => v.slice(0, -1));
                          else if (k === '.') setCashInput((v) => v.includes('.') ? v : (v || '0') + '.');
                          else setCashInput((v) => v + k);
                        }}
                        className="py-3 bg-theme-surface-alt hover:bg-theme-accent hover:text-white text-theme-text font-theme-display text-xl rounded-theme transition-colors"
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {[totalMajor, Math.ceil(totalMajor / 50) * 50, Math.ceil(totalMajor / 100) * 100, Math.ceil(totalMajor / 500) * 500]
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCashInput(v.toFixed(2))}
                          className="py-2 border border-theme-border rounded-theme text-xs font-theme-body text-theme-text-muted hover:border-theme-accent hover:text-theme-accent transition-colors"
                        >
                          ৳{v}
                        </button>
                      ))}
                  </div>
                  {cashPaisa > 0 && change >= 0 && (
                    <div className="flex justify-between mt-2 px-1">
                      <span className="text-xs font-theme-body text-theme-text-muted">Change</span>
                      <span className="text-sm font-theme-body font-medium text-theme-text">
                        {formatCurrency(change)}
                      </span>
                    </div>
                  )}
                  {cashPaisa > 0 && change < 0 && (
                    <p className="text-xs text-theme-accent font-theme-body mt-2 px-1">
                      Amount received is less than total
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Split Payment Mode */}
          {isSplit && (
            <div className="space-y-3">
              <p className="text-xs font-theme-body font-medium font-semibold text-theme-text-muted">
                Payment splits
              </p>
              {splits.map((sp, idx) => (
                <div key={idx} className="border border-theme-border rounded-theme p-3 bg-theme-bg">
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={sp.method}
                      onChange={(e) => updateSplit(idx, 'method', e.target.value)}
                      className="flex-1 bg-theme-surface rounded-theme px-3 py-2 text-sm font-semibold text-theme-text outline-none border border-theme-border focus:border-theme-accent"
                    >
                      {allOptions.map((o) => (
                        <option key={o.code} value={o.code}>{o.name}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={sp.amount}
                      onChange={(e) => updateSplit(idx, 'amount', e.target.value)}
                      className="w-28 bg-theme-surface rounded-theme px-3 py-2 text-sm font-bold text-theme-text outline-none border border-theme-border focus:border-theme-accent text-right"
                    />
                    {splits.length > 2 && (
                      <button onClick={() => removeSplit(idx)} className="text-theme-text-muted hover:text-theme-danger transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {allOptions.find((o) => o.code === sp.method)?.catCode !== 'CASH' && (
                    <input
                      placeholder="Reference / TxID (optional)"
                      value={sp.reference}
                      onChange={(e) => updateSplit(idx, 'reference', e.target.value)}
                      className="w-full bg-theme-surface rounded-theme px-3 py-2 text-xs text-theme-text-muted outline-none border border-theme-border focus:border-theme-accent"
                    />
                  )}
                </div>
              ))}

              <div className="flex items-center gap-2">
                <button
                  onClick={addSplit}
                  className="flex items-center gap-1 text-xs font-semibold text-theme-text-muted hover:text-theme-accent transition-colors"
                >
                  <Plus size={12} /> Add method
                </button>
                <button
                  onClick={autoFillLast}
                  className="ml-auto text-xs font-bold text-theme-accent hover:text-theme-accent-hover transition-colors"
                >
                  Auto-fill remaining
                </button>
              </div>

              <div className="bg-theme-bg rounded-theme p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-theme-text-muted">Split total</span>
                  <span className="font-bold text-theme-text">{formatCurrency(splitTotalPaisa)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-theme-text-muted">Remaining</span>
                  <span className={`font-bold ${Math.abs(splitRemaining) <= 1 ? 'text-theme-pop' : 'text-theme-danger'}`}>
                    {Math.abs(splitRemaining) <= 1 ? 'Balanced ✓' : formatCurrency(splitRemaining)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Confirm */}
        <footer className="px-6 py-4 border-t border-theme-border shrink-0">
          <button
            onClick={() => mutation.mutate()}
            disabled={!canConfirm || mutation.isPending}
            className="w-full bg-theme-pop hover:opacity-90 text-white py-4 rounded-theme font-bold text-sm transition-opacity disabled:opacity-40"
          >
            {mutation.isPending ? 'Processing…' : isSplit ? 'Confirm Split Payment' : 'Confirm Payment'}
          </button>
          {mutation.isError && (
            <p className="text-xs text-theme-danger text-center mt-2">
              {(mutation.error as Error).message}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

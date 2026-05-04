import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Wallet, Wallet2 } from 'lucide-react';

import type { CashierAction, ExpenseCategory, Payroll } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import { useIsOnline } from '../lib/online';
import { OfflineBanner } from '../components/OfflineHint';
import { useCashierPermissions } from '../lib/permissions';
import ApprovalOtpDialog from '../components/ApprovalOtpDialog';
import { PaymentMethodSelect } from '../components/PaymentMethodSelect';

type Tab = 'expense' | 'payroll';

const TAB_LABELS: Record<Tab, { label: string; Icon: typeof Receipt }> = {
  expense: { label: 'New Expense', Icon: Receipt },
  payroll: { label: 'Pay Payroll', Icon: Wallet },
};

const ALL_CATEGORIES: ExpenseCategory[] = [
  'RENT', 'UTILITIES', 'SALARY', 'SUPPLIES',
  'MAINTENANCE', 'TRANSPORT', 'MARKETING',
  'FOOD_COST', 'STAFF_FOOD', 'MISCELLANEOUS',
];

// Payment-method dropdown moved to ../components/PaymentMethodSelect so
// PosPurchasingPage's "Pay Supplier" tab can re-use the same wiring —
// hardcoded literal codes there were skipping the bKash account post.

export default function PosFinancePage() {
  const qc = useQueryClient();
  const { data: perms } = useCashierPermissions();
  const online = useIsOnline();

  const enabledTabs = useMemo<Tab[]>(() => {
    if (!perms) return [];
    const out: Tab[] = [];
    if (perms.createExpense.enabled && perms.createExpense.approval !== 'NONE') out.push('expense');
    if (perms.payPayroll.enabled    && perms.payPayroll.approval    !== 'NONE') out.push('payroll');
    return out;
  }, [perms]);

  const [tab, setTab] = useState<Tab>('expense');
  const activeTab: Tab = enabledTabs.includes(tab) ? tab : (enabledTabs[0] ?? 'expense');

  const [pendingAction, setPendingAction] = useState<null | { action: CashierAction; summary: string; run: (otp: string | null) => void }>(null);

  const guardAndRun = (action: CashierAction, summary: string, run: (otp: string | null) => void) => {
    if (!online) {
      alert('This action needs internet — reconnect to use Finance.');
      return;
    }
    const cfg = perms?.[action];
    if (!cfg || !cfg.enabled || cfg.approval === 'NONE') return;
    if (cfg.approval === 'AUTO') { run(null); return; }
    setPendingAction({ action, summary, run });
  };

  if (enabledTabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-center max-w-sm">
          <Wallet2 size={36} className="text-theme-text-muted mx-auto mb-3" />
          <p className="text-sm font-semibold text-theme-text">No finance actions enabled</p>
          <p className="text-xs text-theme-text-muted mt-1">Ask your administrator to enable cashier finance in admin → Cashier Permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Top bar */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <Wallet2 size={18} className="text-theme-accent" />
        <div className="h-8 w-px bg-theme-border" />
        <h1 className="text-xl font-extrabold text-theme-text">Finance</h1>
        <div className="flex-1" />
      </header>

      {!online && (
        <div className="px-6 pt-4 shrink-0">
          <OfflineBanner message="Finance is disabled while offline — expenses and payroll need live server checks." />
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 pt-5 pb-4 shrink-0 flex justify-center">
        <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border">
          {enabledTabs.map((t) => {
            const { label, Icon } = TAB_LABELS[t];
            const active = activeTab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-5 py-2 text-sm rounded-theme transition-colors ${
                  active ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 flex justify-center">
        {activeTab === 'expense' && (
          <ExpenseTab perms={perms ?? null} guardAndRun={guardAndRun} qc={qc} />
        )}
        {activeTab === 'payroll' && (
          <PayrollTab guardAndRun={guardAndRun} qc={qc} />
        )}
      </div>

      {pendingAction && (
        <ApprovalOtpDialog
          action={pendingAction.action}
          summary={pendingAction.summary}
          onClose={() => setPendingAction(null)}
          onApproved={(otp) => {
            const { run } = pendingAction;
            setPendingAction(null);
            run(otp);
          }}
        />
      )}
    </div>
  );
}

// ─── Expense tab ─────────────────────────────────────────────────────────────

function ExpenseTab({ perms, guardAndRun, qc }: {
  perms: ReturnType<typeof useCashierPermissions>['data'] | null;
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  // Restrict the category dropdown to admin-allowed categories.
  const allowedCategories = useMemo<ExpenseCategory[]>(() => {
    const cfg = perms?.createExpense;
    if (!cfg) return [];
    if (cfg.allowedCategories.length === 0) return ALL_CATEGORIES;
    return cfg.allowedCategories.filter((c): c is ExpenseCategory => ALL_CATEGORIES.includes(c as ExpenseCategory));
  }, [perms]);

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/expense/create', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      setCategory('');
      setDescription('');
      setAmount('');
      setReference('');
      setNotes('');
      setError('Expense recorded ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    if (!category) return setError('Pick a category');
    if (!description.trim()) return setError('Enter a description');
    const value = parseFloat(amount || '0');
    if (value <= 0) return setError('Enter an amount');

    // The category-level approval mode comes from admin permissions.
    // The cashier-side OTP modal still uses the action key 'createExpense'
    // because the OTP store is keyed per action; the backend re-checks the
    // category-specific mode in resolveExpenseApproval.
    const cfg = perms?.createExpense;
    const mode = cfg?.categoryApproval[category] ?? cfg?.approval ?? 'OTP';

    const send = (otp: string | null) => {
      mut.mutate({
        category,
        description: description.trim(),
        amount: Math.round(value * 100),
        paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
        date,
        actionOtp: otp ?? undefined,
      });
    };

    if (mode === 'AUTO') return send(null);
    if (mode === 'NONE') return setError('This category is hidden for cashier');
    guardAndRun('createExpense', `Expense — ${category} — ${formatCurrency(Math.round(value * 100))}`, send);
  };

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-xl">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">New Expense</p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory | '')}
              className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
            >
              <option value="">— Select —</option>
              {allowedCategories.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Description *</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the expense"
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Amount (৳)</label>
            <input
              type="number" step="0.01" min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-base font-bold text-theme-text outline-none border border-transparent focus:border-theme-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Payment Method</label>
            <PaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Reference / Receipt #</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>
      </div>

      {error && (
        <p className={`text-xs mt-3 ${error.endsWith('✓') ? 'text-theme-pop' : 'text-theme-danger'}`}>{error}</p>
      )}

      <button
        onClick={submit}
        disabled={mut.isPending}
        className="w-full mt-4 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
      >
        {mut.isPending ? 'Recording…' : 'Record Expense'}
      </button>
    </div>
  );
}

// ─── Payroll tab ─────────────────────────────────────────────────────────────

function PayrollTab({ guardAndRun, qc }: {
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { data: payrolls = [] } = useQuery<Payroll[]>({
    queryKey: ['cashier', 'payroll', 'list'],
    queryFn: () => api.get('/cashier-ops/payroll/list'),
  });

  const [payrollId, setPayrollId] = useState('');
  const selected = payrolls.find((p) => p.id === payrollId);
  const due = selected ? Number(selected.netPayable ?? 0) - Number(selected.paidAmount ?? 0) : 0;

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/payroll/pay', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cashier', 'payroll', 'list'] });
      setPayrollId('');
      setAmount('');
      setReference('');
      setNotes('');
      setError('Payroll payment recorded ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    const value = parseFloat(amount || '0');
    if (!payrollId) return setError('Pick a payroll');
    if (value <= 0) return setError('Enter an amount');
    if (value > due / 100 + 0.001) return setError(`Amount exceeds outstanding due (${formatCurrency(due)})`);

    const summary = `Pay payroll ${selected?.staff?.name ?? ''} ${formatCurrency(Math.round(value * 100))} via ${paymentMethod}`;
    guardAndRun('payPayroll', summary, (otp) => {
      mut.mutate({
        payrollId,
        amount: Math.round(value * 100),
        paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
        actionOtp: otp ?? undefined,
      });
    });
  };

  // Show only payrolls that have an outstanding balance (approved + not fully paid)
  const outstandingPayrolls = payrolls.filter((p) => Number(p.netPayable ?? 0) - Number(p.paidAmount ?? 0) > 0);

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-xl">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">Pay Payroll</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Outstanding Payroll</label>
          <select
            value={payrollId}
            onChange={(e) => { setPayrollId(e.target.value); setAmount(''); }}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            <option value="">— Select —</option>
            {outstandingPayrolls.map((p) => {
              const remaining = Number(p.netPayable ?? 0) - Number(p.paidAmount ?? 0);
              return (
                <option key={p.id} value={p.id}>
                  {p.staff?.name ?? '—'} · {p.periodStart.slice(0, 10)} → {p.periodEnd.slice(0, 10)} · Due {formatCurrency(remaining)}
                </option>
              );
            })}
          </select>
          {outstandingPayrolls.length === 0 && (
            <p className="text-xs text-theme-text-muted mt-2">No approved payrolls awaiting payment.</p>
          )}
        </div>

        {selected && (
          <div className="bg-theme-danger/10 border border-theme-danger/30 p-3 rounded-theme flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Outstanding Due</p>
              <p className="text-xl font-extrabold text-theme-danger">{formatCurrency(due)}</p>
            </div>
            <button
              type="button"
              onClick={() => setAmount((due / 100).toFixed(2))}
              className="text-xs font-bold text-theme-accent hover:underline"
            >
              Pay full
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Amount (৳)</label>
            <input
              type="number" step="0.01" min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-base font-bold text-theme-text outline-none border border-transparent focus:border-theme-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Payment Method</label>
            <PaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Reference / Tx ID</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>
      </div>

      {error && (
        <p className={`text-xs mt-3 ${error.endsWith('✓') ? 'text-theme-pop' : 'text-theme-danger'}`}>{error}</p>
      )}

      <button
        onClick={submit}
        disabled={mut.isPending}
        className="w-full mt-4 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
      >
        {mut.isPending ? 'Paying…' : 'Record Payment'}
      </button>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type {
  Creditor,
  CreditorBill,
  CreditorPayment,
  CreditorAdjustment,
  CreditorCategory,
  CreditorLedgerResponse,
  ExpenseCategory,
} from '@restora/types';

const CREDITOR_CATEGORIES: { value: CreditorCategory; label: string }[] = [
  { value: 'UTILITY', label: 'Utility' },
  { value: 'LANDLORD', label: 'Landlord (Rent)' },
  { value: 'BANK', label: 'Bank Loan' },
  { value: 'INDIVIDUAL', label: 'Individual Lender' },
  { value: 'OTHER', label: 'Other' },
];

// All ExpenseCategory enum values — admin picks which Expense category
// should fire when a payment is made against this creditor.
const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'SALARY', label: 'Salary' },
  { value: 'SUPPLIES', label: 'Supplies' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'FOOD_COST', label: 'Food Cost' },
  { value: 'STAFF_FOOD', label: 'Staff Food' },
  { value: 'MISCELLANEOUS', label: 'Miscellaneous' },
];

interface CreditorForm {
  name: string;
  category: CreditorCategory;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  defaultExpenseCategory: ExpenseCategory;
  openingBalance: string;
}

interface BillForm {
  description: string;
  amount: string;
  dueDate: string;
  notes: string;
}

interface PaymentForm {
  amount: string;
  paymentMethod: string;
  reference: string;
  notes: string;
}

const emptyForm: CreditorForm = {
  name: '',
  category: 'OTHER',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  defaultExpenseCategory: 'MISCELLANEOUS',
  openingBalance: '',
};
const emptyBillForm: BillForm = { description: '', amount: '', dueDate: '', notes: '' };
const emptyPaymentForm: PaymentForm = { amount: '', paymentMethod: 'CASH', reference: '', notes: '' };

export default function LiabilitiesPage() {
  const qc = useQueryClient();
  const { data: paymentOptions = [] } = useQuery<{ code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
    select: (d: any[]) => d.filter((o) => o.isActive),
  });

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Creditor | null>(null);
  const [form, setForm] = useState<CreditorForm>(emptyForm);

  // Bill recording — kept open after save so admin can stack multiple
  // bills (e.g. April electricity + April gas + April internet) on the
  // same creditor without re-opening the dialog.
  const [billingCreditor, setBillingCreditor] = useState<Creditor | null>(null);
  const [billForm, setBillForm] = useState<BillForm>(emptyBillForm);
  const [lastBillSavedAt, setLastBillSavedAt] = useState<number | null>(null);

  const [payingCreditor, setPayingCreditor] = useState<Creditor | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);

  const [ledgerCreditor, setLedgerCreditor] = useState<Creditor | null>(null);

  const [adjustingCreditor, setAdjustingCreditor] = useState<Creditor | null>(null);
  const [adjustForm, setAdjustForm] = useState<{ amount: string; direction: 'reduce' | 'increase'; reason: string }>({ amount: '', direction: 'reduce', reason: '' });

  const [categoryFilter, setCategoryFilter] = useState<CreditorCategory | ''>('');

  const { data: creditors = [], isLoading } = useQuery<Creditor[]>({
    queryKey: ['creditors'],
    queryFn: () => api.get('/creditors'),
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<CreditorLedgerResponse>({
    queryKey: ['creditor-ledger', ledgerCreditor?.id],
    queryFn: () => api.get(`/creditors/${ledgerCreditor!.id}/ledger`),
    enabled: !!ledgerCreditor,
  });

  const saveMutation = useMutation({
    mutationFn: (data: CreditorForm) => {
      const { openingBalance, ...rest } = data;
      if (editing) {
        return api.patch(`/creditors/${editing.id}`, rest);
      }
      return api.post('/creditors', {
        ...rest,
        openingBalance: openingBalance ? Math.round(parseFloat(openingBalance) * 100) : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creditors'] });
      closeDialog();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/creditors/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['creditors'] }),
  });

  const billMutation = useMutation({
    mutationFn: (data: { creditorId: string; description: string; amount: number; dueDate?: string; notes?: string }) =>
      api.post(`/creditors/${data.creditorId}/bills`, {
        description: data.description,
        amount: data.amount,
        dueDate: data.dueDate,
        notes: data.notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creditors'] });
      void qc.invalidateQueries({ queryKey: ['creditor-ledger'] });
      // Keep dialog open; just clear the form for the next bill.
      setBillForm(emptyBillForm);
      setLastBillSavedAt(Date.now());
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (data: { creditorId: string; amount: number; paymentMethod: string; reference?: string; notes?: string }) =>
      api.post(`/creditors/${data.creditorId}/payments`, {
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        notes: data.notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creditors'] });
      void qc.invalidateQueries({ queryKey: ['creditor-ledger'] });
      closePaymentDialog();
    },
  });

  // Manual ledger correction. Mirrors SuppliersPage adjustment exactly:
  // server adjusts only Creditor.totalDue + writes an audit row; no cash
  // account / expense posted. Owner/Manager only at the API.
  const adjustMutation = useMutation({
    mutationFn: (data: { creditorId: string; amount: number; reason: string }) =>
      api.post(`/creditors/${data.creditorId}/adjust`, { amount: data.amount, reason: data.reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creditors'] });
      void qc.invalidateQueries({ queryKey: ['creditor-ledger'] });
      setAdjustingCreditor(null);
      setAdjustForm({ amount: '', direction: 'reduce', reason: '' });
    },
  });

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowDialog(true); };
  const openEdit = (c: Creditor) => {
    setEditing(c);
    setForm({
      name: c.name,
      category: c.category ?? 'OTHER',
      contactName: c.contactName ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
      defaultExpenseCategory: c.defaultExpenseCategory ?? 'MISCELLANEOUS',
      openingBalance: '',
    });
    setShowDialog(true);
  };
  const closeDialog = () => { setShowDialog(false); setEditing(null); };

  const openBill = (c: Creditor) => { setBillingCreditor(c); setBillForm(emptyBillForm); setLastBillSavedAt(null); };
  const closeBillDialog = () => { setBillingCreditor(null); setLastBillSavedAt(null); };

  const openPayment = (c: Creditor) => { setPayingCreditor(c); setPaymentForm(emptyPaymentForm); };
  const closePaymentDialog = () => { setPayingCreditor(null); };

  const openLedger = (c: Creditor) => { setLedgerCreditor(c); };
  const closeLedger = () => { setLedgerCreditor(null); };

  const openAdjust = (c: Creditor) => {
    setAdjustingCreditor(c);
    setAdjustForm({ amount: '', direction: 'reduce', reason: '' });
  };
  const handleAdjust = () => {
    if (!adjustingCreditor) return;
    const raw = parseFloat(adjustForm.amount);
    if (!Number.isFinite(raw) || raw <= 0) return;
    if (!adjustForm.reason.trim()) return;
    const signed = adjustForm.direction === 'reduce' ? -raw : raw;
    adjustMutation.mutate({
      creditorId: adjustingCreditor.id,
      amount: Math.round(signed * 100),
      reason: adjustForm.reason.trim(),
    });
  };

  const handleBill = () => {
    if (!billingCreditor || !billForm.description.trim() || !billForm.amount) return;
    const amount = parseFloat(billForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    billMutation.mutate({
      creditorId: billingCreditor.id,
      description: billForm.description.trim(),
      amount: Math.round(amount * 100),
      dueDate: billForm.dueDate || undefined,
      notes: billForm.notes || undefined,
    });
  };

  const handlePay = () => {
    if (!payingCreditor || !paymentForm.amount) return;
    paymentMutation.mutate({
      creditorId: payingCreditor.id,
      amount: Math.round(parseFloat(paymentForm.amount) * 100),
      paymentMethod: paymentForm.paymentMethod,
      reference: paymentForm.reference || undefined,
      notes: paymentForm.notes || undefined,
    });
  };

  const filtered = categoryFilter
    ? creditors.filter((c) => c.category === categoryFilter)
    : creditors;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">LIABILITIES</h1>
        <div className="flex gap-3 items-center">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CreditorCategory | '')}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-[#999] px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
          >
            <option value="">All Categories</option>
            {CREDITOR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button onClick={openAdd} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
            + NEW CREDITOR
          </button>
        </div>
      </div>

      <p className="text-[#666] font-body text-xs">
        Track utility bills, rent, bank loans, and money borrowed from people. Record bills as they arrive,
        pay them when you can — every payment auto-creates an Expense and debits your cash/bank account.
      </p>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading...</p>
      ) : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Name', 'Category', 'Contact', 'Phone', 'Owed', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-white font-body text-sm">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-body px-2 py-0.5 bg-[#2A2A2A] text-[#999]">
                      {c.category ?? 'OTHER'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">{c.contactName ?? '--'}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">{c.phone ?? '--'}</td>
                  <td className="px-4 py-3 font-body text-sm">
                    <span className={Number(c.totalDue) > 0 ? 'text-[#F03535]' : 'text-[#4CAF50]'}>
                      {formatCurrency(Number(c.totalDue ?? 0))}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-body px-2 py-0.5 ${c.isActive ? 'bg-[#1a3a1a] text-[#4CAF50]' : 'bg-[#2A2A2A] text-[#666]'}`}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2 flex-wrap">
                    <button onClick={() => openLedger(c)} className="text-[#4FC3F7] hover:text-[#81D4FA] font-body text-xs tracking-widest uppercase transition-colors">Ledger</button>
                    <button onClick={() => openBill(c)} className="text-[#FFA726] hover:text-[#FFB74D] font-body text-xs tracking-widest uppercase transition-colors">Bill</button>
                    <button onClick={() => openPayment(c)} className="text-[#4CAF50] hover:text-[#66BB6A] font-body text-xs tracking-widest uppercase transition-colors">Pay</button>
                    <button onClick={() => openEdit(c)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                    {c.isActive && (
                      <button onClick={() => deactivateMutation.mutate(c.id)} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No creditors yet. Click "+ NEW CREDITOR" to add a utility, landlord, bank loan, or personal lender.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Creditor Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">
              {editing ? 'EDIT CREDITOR' : 'NEW CREDITOR'}
            </h2>
            <div className="space-y-4">
              {([
                ['name', 'Name *'],
                ['contactName', 'Contact Name'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['address', 'Address'],
                ['notes', 'Notes'],
              ] as [keyof CreditorForm, string][]).map(([key, label]) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
                  <input
                    value={form[key] as string}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as CreditorCategory }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {CREDITOR_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Default Expense Category</label>
                <select
                  value={form.defaultExpenseCategory}
                  onChange={(e) => setForm((f) => ({ ...f, defaultExpenseCategory: e.target.value as ExpenseCategory }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <p className="text-[#555] text-[10px] font-body">Posted as the Expense category every time you pay this creditor.</p>
              </div>
              {!editing && (
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Opening Balance (Old Due)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={form.openingBalance}
                    onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
                    placeholder="0.00"
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                  <p className="text-[#555] text-[10px] font-body">Set previous outstanding balance if any. This will be added to the creditor's total owed.</p>
                </div>
              )}
            </div>
            {saveMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(saveMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={closeDialog} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => saveMutation.mutate(form)}
                disabled={!form.name || saveMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Bill Dialog. Stays open after save so admin can stack
          multiple bills (e.g. April electricity + April internet) on
          the same creditor. */}
      {billingCreditor && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeBillDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-2">RECORD BILL</h2>
            <p className="text-[#999] font-body text-sm mb-1">Creditor: <span className="text-white">{billingCreditor.name}</span></p>
            <p className="text-[#999] font-body text-sm mb-6">Currently Owed: <span className="text-[#F03535]">{formatCurrency(Number(billingCreditor.totalDue ?? 0))}</span></p>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Description *</label>
                <input
                  value={billForm.description}
                  onChange={(e) => setBillForm((f) => ({ ...f, description: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                  placeholder="e.g. April 2026 electricity"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
                <input
                  type="number" step="0.01" min="0"
                  value={billForm.amount}
                  onChange={(e) => setBillForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Due Date</label>
                <input
                  type="date"
                  value={billForm.dueDate}
                  onChange={(e) => setBillForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={billForm.notes}
                  onChange={(e) => setBillForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                />
              </div>
            </div>
            {billMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(billMutation.error as Error).message}</p>
            )}
            {lastBillSavedAt && !billMutation.isPending && (
              <p className="text-[#4CAF50] text-xs font-body mt-3">Bill saved. Add another, or close.</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={closeBillDialog} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Close</button>
              <button
                onClick={handleBill}
                disabled={!billForm.description.trim() || !billForm.amount || parseFloat(billForm.amount) <= 0 || billMutation.isPending}
                className="flex-1 bg-[#FFA726] hover:bg-[#FFB74D] text-black font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {billMutation.isPending ? 'Saving…' : 'Save Bill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Dialog */}
      {payingCreditor && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closePaymentDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-2">MAKE PAYMENT</h2>
            <p className="text-[#999] font-body text-sm mb-1">Creditor: <span className="text-white">{payingCreditor.name}</span></p>
            <p className="text-[#999] font-body text-sm mb-6">Outstanding: <span className="text-[#F03535]">{formatCurrency(Number(payingCreditor.totalDue ?? 0))}</span></p>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Payment Method</label>
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {paymentOptions.map((o) => <option key={o.code} value={o.code}>{o.name}{o.category ? ` (${o.category.name})` : ''}</option>)}
                  {paymentOptions.length === 0 && <><option value="CASH">Cash</option><option value="CARD">Card</option></>}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Reference</label>
                <input
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  placeholder="Transaction ref / check no."
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            {paymentMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(paymentMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={closePaymentDialog} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={handlePay}
                disabled={!paymentForm.amount || parseFloat(paymentForm.amount) <= 0 || paymentMutation.isPending}
                className="flex-1 bg-[#4CAF50] hover:bg-[#66BB6A] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {paymentMutation.isPending ? 'Processing...' : 'Pay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ledger Adjustment Dialog */}
      {adjustingCreditor && (() => {
        const cur = Number(adjustingCreditor.totalDue ?? 0);
        const raw = parseFloat(adjustForm.amount) || 0;
        const signed = adjustForm.direction === 'reduce' ? -Math.round(raw * 100) : Math.round(raw * 100);
        const next = cur + signed;
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setAdjustingCreditor(null)}>
            <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-display text-xl text-white tracking-widest mb-1">LEDGER ADJUSTMENT</h2>
              <p className="text-[#999] font-body text-sm mb-1">{adjustingCreditor.name}</p>
              <p className="text-[#FFA726] font-body text-[11px] mb-5">
                Pure ledger correction. Does NOT touch cash, expenses, or accounts.
              </p>

              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 mb-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[#666] font-body text-[9px] tracking-widest uppercase mb-1">Current Owed</p>
                    <p className="font-display text-white text-lg">{formatCurrency(cur)}</p>
                  </div>
                  <div>
                    <p className="text-[#666] font-body text-[9px] tracking-widest uppercase mb-1">Adjustment</p>
                    <p className={`font-display text-lg ${signed < 0 ? 'text-[#4CAF50]' : signed > 0 ? 'text-[#FFA726]' : 'text-[#666]'}`}>
                      {signed === 0 ? '—' : (signed < 0 ? '-' : '+') + formatCurrency(Math.abs(signed))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#666] font-body text-[9px] tracking-widest uppercase mb-1">Will Become</p>
                    <p className="font-display text-white text-lg">{formatCurrency(next)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Direction</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjustForm((f) => ({ ...f, direction: 'reduce' }))}
                      className={`flex-1 py-2 text-xs font-body tracking-widest uppercase border transition-colors ${
                        adjustForm.direction === 'reduce'
                          ? 'bg-[#4CAF50] border-[#4CAF50] text-white'
                          : 'bg-[#0D0D0D] border-[#2A2A2A] text-[#999] hover:border-[#444]'
                      }`}
                    >
                      Reduce Debt
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustForm((f) => ({ ...f, direction: 'increase' }))}
                      className={`flex-1 py-2 text-xs font-body tracking-widest uppercase border transition-colors ${
                        adjustForm.direction === 'increase'
                          ? 'bg-[#FFA726] border-[#FFA726] text-black'
                          : 'bg-[#0D0D0D] border-[#2A2A2A] text-[#999] hover:border-[#444]'
                      }`}
                    >
                      Increase Debt
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (BDT)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={adjustForm.amount}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="e.g. 4000"
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Reason (required)</label>
                  <input
                    value={adjustForm.reason}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="e.g. Wrong opening balance correction"
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726] transition-colors"
                  />
                </div>
              </div>

              {adjustMutation.error && (
                <p className="text-[#F03535] text-xs font-body mt-3">{(adjustMutation.error as Error).message}</p>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={() => setAdjustingCreditor(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
                <button
                  onClick={handleAdjust}
                  disabled={!adjustForm.amount || raw <= 0 || !adjustForm.reason.trim() || adjustMutation.isPending}
                  className="flex-1 bg-[#FFA726] hover:bg-[#FFB74D] text-black font-body text-sm py-2.5 transition-colors disabled:opacity-50"
                >
                  {adjustMutation.isPending ? 'Posting…' : 'Post Adjustment'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Ledger Dialog */}
      {ledgerCreditor && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeLedger}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-2">CREDITOR LEDGER</h2>
            <p className="text-[#999] font-body text-sm mb-6">{ledgerCreditor.name}</p>

            {ledgerLoading ? (
              <p className="text-[#666] font-body text-sm">Loading ledger...</p>
            ) : ledgerData ? (
              <div className="space-y-6">
                {/* Summary */}
                <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4">
                  <div className="grid grid-cols-5 gap-3 text-center">
                    {ledgerData.openingBalance > 0 && (
                      <div>
                        <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Opening Bal.</p>
                        <p className="text-[#F03535] font-display text-xl">{formatCurrency(ledgerData.openingBalance)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Billed</p>
                      <p className="text-white font-display text-xl">{formatCurrency(ledgerData.totalBilled)}</p>
                    </div>
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Paid</p>
                      <p className="text-[#4CAF50] font-display text-xl">{formatCurrency(ledgerData.totalPaid)}</p>
                    </div>
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Adjustments</p>
                      <p className={`font-display text-xl ${ledgerData.totalAdjustments < 0 ? 'text-[#4CAF50]' : ledgerData.totalAdjustments > 0 ? 'text-[#FFA726]' : 'text-[#999]'}`}>
                        {ledgerData.totalAdjustments === 0 ? '—' : (ledgerData.totalAdjustments < 0 ? '-' : '+') + formatCurrency(Math.abs(ledgerData.totalAdjustments))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Balance Due</p>
                      <p className={`font-display text-xl ${ledgerData.balance > 0 ? 'text-[#F03535]' : 'text-[#4CAF50]'}`}>{formatCurrency(ledgerData.balance)}</p>
                    </div>
                  </div>
                </div>

                {/* Bills */}
                <div>
                  <h3 className="font-display text-sm text-white tracking-widest mb-3">BILLS</h3>
                  {ledgerData.bills.length === 0 ? (
                    <p className="text-[#666] font-body text-sm">No bills recorded.</p>
                  ) : (
                    <div className="bg-[#0D0D0D] border border-[#2A2A2A]">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[#2A2A2A]">
                            {['Date', 'Description', 'Amount', 'Due', 'Recorded By'].map((h) => (
                              <th key={h} className="text-left px-3 py-2 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerData.bills.map((b: CreditorBill) => (
                            <tr key={b.id} className="border-b border-[#2A2A2A] last:border-0">
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{new Date(b.billDate).toLocaleDateString()}</td>
                              <td className="px-3 py-2 text-white font-body text-xs">{b.description}</td>
                              <td className="px-3 py-2 text-[#FFA726] font-body text-xs">{formatCurrency(b.amount)}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '--'}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{b.recordedBy?.name ?? '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Adjustments */}
                {ledgerData.adjustments && ledgerData.adjustments.length > 0 && (
                  <div>
                    <h3 className="font-display text-sm text-white tracking-widest mb-3">LEDGER ADJUSTMENTS</h3>
                    <div className="bg-[#0D0D0D] border border-[#2A2A2A]">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[#2A2A2A]">
                            {['Date', 'Amount', 'Reason', 'Recorded By'].map((h) => (
                              <th key={h} className="text-left px-3 py-2 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerData.adjustments.map((a: CreditorAdjustment) => (
                            <tr key={a.id} className="border-b border-[#2A2A2A] last:border-0">
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
                              <td className={`px-3 py-2 font-body text-xs font-medium ${a.amount < 0 ? 'text-[#4CAF50]' : 'text-[#FFA726]'}`}>
                                {a.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(a.amount))}
                              </td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{a.reason}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{a.recordedBy?.name ?? '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Payments */}
                <div>
                  <h3 className="font-display text-sm text-white tracking-widest mb-3">PAYMENT HISTORY</h3>
                  {ledgerData.payments.length === 0 ? (
                    <p className="text-[#666] font-body text-sm">No payments recorded.</p>
                  ) : (
                    <div className="bg-[#0D0D0D] border border-[#2A2A2A]">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[#2A2A2A]">
                            {['Date', 'Amount', 'Method', 'Reference', 'Paid By'].map((h) => (
                              <th key={h} className="text-left px-3 py-2 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerData.payments.map((p: CreditorPayment) => (
                            <tr key={p.id} className="border-b border-[#2A2A2A] last:border-0">
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                              <td className="px-3 py-2 text-[#4CAF50] font-body text-xs">{formatCurrency(p.amount)}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{p.paymentMethod}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{p.reference ?? '--'}</td>
                              <td className="px-3 py-2 text-[#999] font-body text-xs">{p.paidBy?.name ?? '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex gap-3 mt-6 flex-wrap">
              <button onClick={closeLedger} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm px-6 py-2.5 transition-colors">Close</button>
              <button onClick={() => { closeLedger(); openBill(ledgerCreditor); }} className="bg-[#FFA726] hover:bg-[#FFB74D] text-black font-body text-sm px-6 py-2.5 transition-colors">Record Bill</button>
              <button onClick={() => { closeLedger(); openPayment(ledgerCreditor); }} className="bg-[#4CAF50] hover:bg-[#66BB6A] text-white font-body text-sm px-6 py-2.5 transition-colors">Make Payment</button>
              <button
                onClick={() => { closeLedger(); openAdjust(ledgerCreditor); }}
                className="bg-[#2A2A2A] hover:bg-[#333] text-[#FFA726] hover:text-[#FFB74D] font-body text-sm px-6 py-2.5 transition-colors"
                title="Manually correct the creditor's owed balance — does NOT touch any cash account"
              >
                Ledger Adjustment
              </button>
              {ledgerData && (
                <button
                  onClick={() => {
                    const w = window.open('', '_blank', 'width=800,height=900');
                    if (!w) return;
                    const td = 'padding:4px 8px;border-bottom:1px solid #ddd;font-size:12px';
                    const tdr = `${td};text-align:right`;
                    const thStyle = 'text-align:left;padding:6px 8px;border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:1px';

                    const billRows = ledgerData.bills.map((b: CreditorBill) =>
                      `<tr><td style="${td}">${new Date(b.billDate).toLocaleDateString()}</td><td style="${td}">${b.description}</td><td style="${tdr}">${formatCurrency(b.amount)}</td><td style="${td}">${b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '—'}</td><td style="${td}">${b.recordedBy?.name ?? '—'}</td></tr>`
                    ).join('');

                    const adjRows = ledgerData.adjustments.map((a: CreditorAdjustment) =>
                      `<tr><td style="${td}">${new Date(a.createdAt).toLocaleDateString()}</td><td style="${tdr};color:${a.amount < 0 ? '#2e7d32' : '#e65100'}">${a.amount < 0 ? '-' : '+'}${formatCurrency(Math.abs(a.amount))}</td><td style="${td}">${a.reason}</td><td style="${td}">${a.recordedBy?.name ?? '—'}</td></tr>`
                    ).join('');

                    const payRows = ledgerData.payments.map((p: CreditorPayment) =>
                      `<tr><td style="${td}">${new Date(p.createdAt).toLocaleDateString()}</td><td style="${td}">${p.paymentMethod}</td><td style="${td}">${p.reference ?? '—'}</td><td style="${td}">${p.paidBy?.name ?? '—'}</td><td style="${tdr}">${formatCurrency(p.amount)}</td></tr>`
                    ).join('');
                    const totalPaidPrint = ledgerData.payments.reduce((s, p) => s + Number(p.amount), 0);

                    w.document.write(`<!DOCTYPE html><html><head><title>Ledger - ${ledgerCreditor.name}</title>
                      <style>
                        body{font-family:sans-serif;padding:24px;font-size:13px;color:#333}
                        table{width:100%;border-collapse:collapse;margin-bottom:8px}
                        h2{margin:0 0 4px}h3{margin:24px 0 8px;border-bottom:1px solid #999;padding-bottom:4px;font-size:14px;letter-spacing:2px;text-transform:uppercase}
                        .summary{display:flex;gap:32px;margin:16px 0 24px;padding:12px 16px;background:#f5f5f5;font-size:13px}
                        .summary div{text-align:center}.summary .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:2px}
                        .summary .value{font-size:18px;font-weight:bold}
                      </style></head><body>
                      <h2>Creditor Ledger</h2>
                      <p style="color:#666;margin:0 0 8px">${ledgerCreditor.name}${ledgerCreditor.phone ? ` | ${ledgerCreditor.phone}` : ''}${ledgerCreditor.email ? ` | ${ledgerCreditor.email}` : ''} | Category: ${ledgerCreditor.category}</p>
                      <p style="color:#999;font-size:11px;margin:0 0 16px">Generated: ${new Date().toLocaleString()}</p>

                      <div class="summary">
                        ${ledgerData.openingBalance > 0 ? `<div><div class="label">Opening Bal.</div><div class="value" style="color:#c62828">${formatCurrency(ledgerData.openingBalance)}</div></div>` : ''}
                        <div><div class="label">Billed</div><div class="value">${formatCurrency(ledgerData.totalBilled)}</div></div>
                        <div><div class="label">Paid</div><div class="value" style="color:#2e7d32">${formatCurrency(ledgerData.totalPaid)}</div></div>
                        ${ledgerData.totalAdjustments !== 0 ? `<div><div class="label">Adjustments</div><div class="value" style="color:${ledgerData.totalAdjustments < 0 ? '#2e7d32' : '#e65100'}">${ledgerData.totalAdjustments < 0 ? '-' : '+'}${formatCurrency(Math.abs(ledgerData.totalAdjustments))}</div></div>` : ''}
                        <div><div class="label">Balance Due</div><div class="value" style="color:${ledgerData.balance > 0 ? '#c62828' : '#2e7d32'}">${formatCurrency(ledgerData.balance)}</div></div>
                      </div>

                      <h3>Bills</h3>
                      ${ledgerData.bills.length > 0 ? `
                        <table><thead><tr><th style="${thStyle}">Date</th><th style="${thStyle}">Description</th><th style="${thStyle};text-align:right">Amount</th><th style="${thStyle}">Due</th><th style="${thStyle}">Recorded By</th></tr></thead>
                        <tbody>${billRows}</tbody></table>
                      ` : '<p style="color:#999">No bills recorded.</p>'}

                      ${ledgerData.adjustments.length > 0 ? `<h3>Ledger Adjustments</h3>
                        <table><thead><tr><th style="${thStyle}">Date</th><th style="${thStyle};text-align:right">Amount</th><th style="${thStyle}">Reason</th><th style="${thStyle}">Recorded By</th></tr></thead>
                        <tbody>${adjRows}</tbody></table>` : ''}

                      <h3>Payment History</h3>
                      ${ledgerData.payments.length > 0 ? `
                        <table><thead><tr><th style="${thStyle}">Date</th><th style="${thStyle}">Method</th><th style="${thStyle}">Reference</th><th style="${thStyle}">Paid By</th><th style="${thStyle};text-align:right">Amount</th></tr></thead>
                        <tbody>${payRows}</tbody>
                        <tfoot><tr><td colspan="4" style="padding:8px;border-top:2px solid #333;font-weight:bold">Total Paid</td><td style="padding:8px;border-top:2px solid #333;text-align:right;font-weight:bold">${formatCurrency(totalPaidPrint)}</td></tr></tfoot></table>
                      ` : '<p style="color:#999">No payments recorded.</p>'}

                      <div style="margin-top:32px;border-top:1px solid #ccc;padding-top:8px;text-align:center;color:#999;font-size:10px">
                        Your Restaurant POS — Creditor Ledger Report
                      </div>
                    </body></html>`);
                    w.document.close();
                    w.print();
                  }}
                  className="bg-[#2A2A2A] hover:bg-[#333] text-[#999] hover:text-white font-body text-sm px-6 py-2.5 transition-colors"
                >
                  Print Ledger
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

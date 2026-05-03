import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Supplier, SupplierCategory, SupplierPayment } from '@restora/types';

const SUPPLIER_CATEGORIES: { value: SupplierCategory; label: string }[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'MEAT', label: 'Meat' },
  { value: 'FISH', label: 'Fish' },
  { value: 'VEGETABLES', label: 'Vegetables' },
  { value: 'DAIRY', label: 'Dairy' },
  { value: 'SPICES', label: 'Spices' },
  { value: 'CLEANING', label: 'Cleaning' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'BEVERAGE', label: 'Beverage' },
];

interface SupplierForm {
  name: string;
  contactName: string;
  phone: string;
  whatsappNumber: string;
  email: string;
  address: string;
  notes: string;
  category: SupplierCategory;
  openingBalance: string;
}

interface PaymentForm {
  amount: string;
  paymentMethod: string;
  reference: string;
  notes: string;
}

interface LedgerPOItem {
  id: string;
  ingredientName: string;
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  total: number;
}

interface LedgerPO {
  id: string;
  status: string;
  createdAt: string;
  receivedAt: string | null;
  items: LedgerPOItem[];
  itemsTotal?: number;
  receiptDiscount?: number;
  receiptDiscountReason?: string | null;
  receiptExtraFees?: Array<{ label: string; amount: number }>;
  total: number;
}

interface LedgerReturnItem {
  ingredientName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface LedgerReturn {
  id: string;
  status: string;
  completedAt: string | null;
  items: LedgerReturnItem[];
  total: number;
}

interface LedgerAdjustment {
  id: string;
  amount: number;
  reason: string;
  createdAt: string | Date;
  recordedBy?: { id: string; name: string };
}

interface LedgerData {
  supplier: Supplier;
  openingBalance: number;
  totalBilled: number;
  totalPaid: number;
  totalReturned: number;
  totalAdjustments: number;
  balance: number;
  purchaseOrders: LedgerPO[];
  returns: LedgerReturn[];
  payments: SupplierPayment[];
  adjustments: LedgerAdjustment[];
}

const emptyForm: SupplierForm = { name: '', contactName: '', phone: '', whatsappNumber: '', email: '', address: '', notes: '', category: 'GENERAL', openingBalance: '' };
const emptyPaymentForm: PaymentForm = { amount: '', paymentMethod: 'CASH', reference: '', notes: '' };


export default function SuppliersPage() {
  const qc = useQueryClient();
  const { data: paymentOptions = [] } = useQuery<{ code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
    select: (d: any[]) => d.filter((o) => o.isActive),
  });
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);

  // Payment dialog state
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);

  // Ledger dialog state
  const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null);

  // Adjustment dialog state — pure ledger correction (e.g. wrong
  // opening balance). Direction is signed: typing 4000 with a
  // "Reduce debt" toggle posts -4000.
  const [adjustingSupplier, setAdjustingSupplier] = useState<Supplier | null>(null);
  const [adjustForm, setAdjustForm] = useState<{ amount: string; direction: 'reduce' | 'increase'; reason: string }>({ amount: '', direction: 'reduce', reason: '' });

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<SupplierCategory | ''>('');

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<LedgerData>({
    queryKey: ['supplier-ledger', ledgerSupplier?.id],
    queryFn: () => api.get(`/suppliers/${ledgerSupplier!.id}/ledger`),
    enabled: !!ledgerSupplier,
  });

  const saveMutation = useMutation({
    mutationFn: (data: SupplierForm) => {
      const { openingBalance, ...rest } = data;
      if (editing) {
        return api.patch(`/suppliers/${editing.id}`, rest);
      }
      return api.post('/suppliers', {
        ...rest,
        openingBalance: openingBalance ? Math.round(parseFloat(openingBalance) * 100) : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      closeDialog();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const togglePosMutation = useMutation({
    mutationFn: ({ id, visibleToCashier }: { id: string; visibleToCashier: boolean }) =>
      api.patch(`/suppliers/${id}`, { visibleToCashier }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const paymentMutation = useMutation({
    mutationFn: (data: { supplierId: string; amount: number; paymentMethod: string; reference?: string; notes?: string }) =>
      api.post('/suppliers/payments', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['supplier-ledger'] });
      closePaymentDialog();
    },
  });

  // Manual ledger correction — calls /suppliers/:id/adjust. Server
  // adjusts only Supplier.totalDue + writes an audit row; no cash
  // account / expense posted. Owner/Manager only at the API.
  const adjustMutation = useMutation({
    mutationFn: (data: { supplierId: string; amount: number; reason: string }) =>
      api.post(`/suppliers/${data.supplierId}/adjust`, { amount: data.amount, reason: data.reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['supplier-ledger'] });
      setAdjustingSupplier(null);
      setAdjustForm({ amount: '', direction: 'reduce', reason: '' });
    },
  });

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowDialog(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ name: s.name, contactName: s.contactName ?? '', phone: s.phone ?? '', whatsappNumber: s.whatsappNumber ?? '', email: s.email ?? '', address: s.address ?? '', notes: s.notes ?? '', category: s.category ?? 'GENERAL', openingBalance: '' });
    setShowDialog(true);
  };
  const closeDialog = () => { setShowDialog(false); setEditing(null); };

  const openPayment = (s: Supplier) => { setPayingSupplier(s); setPaymentForm(emptyPaymentForm); };
  const closePaymentDialog = () => { setPayingSupplier(null); };

  const openLedger = (s: Supplier) => { setLedgerSupplier(s); };
  const closeLedger = () => { setLedgerSupplier(null); };

  const openAdjust = (s: Supplier) => {
    setAdjustingSupplier(s);
    setAdjustForm({ amount: '', direction: 'reduce', reason: '' });
  };
  const handleAdjust = () => {
    if (!adjustingSupplier) return;
    const raw = parseFloat(adjustForm.amount);
    if (!Number.isFinite(raw) || raw <= 0) return;
    if (!adjustForm.reason.trim()) return;
    const signed = adjustForm.direction === 'reduce' ? -raw : raw;
    adjustMutation.mutate({
      supplierId: adjustingSupplier.id,
      amount: Math.round(signed * 100),
      reason: adjustForm.reason.trim(),
    });
  };

  const handlePay = () => {
    if (!payingSupplier || !paymentForm.amount) return;
    paymentMutation.mutate({
      supplierId: payingSupplier.id,
      amount: Math.round(parseFloat(paymentForm.amount) * 100),
      paymentMethod: paymentForm.paymentMethod,
      reference: paymentForm.reference || undefined,
      notes: paymentForm.notes || undefined,
    });
  };

  const filtered = categoryFilter
    ? suppliers.filter((s) => s.category === categoryFilter)
    : suppliers;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">SUPPLIERS</h1>
        <div className="flex gap-3 items-center">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as SupplierCategory | '')}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-[#999] px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
          >
            <option value="">All Categories</option>
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button onClick={openAdd} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
            + ADD SUPPLIER
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading...</p>
      ) : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Name', 'Category', 'Contact', 'Phone', 'Due', 'Status', 'POS', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-white font-body text-sm">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-body px-2 py-0.5 bg-[#2A2A2A] text-[#999]">
                      {s.category ?? 'GENERAL'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">{s.contactName ?? '--'}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">
                    <div className="flex items-center gap-2">
                      <span>{s.phone ?? '--'}</span>
                      {s.whatsappNumber ? (
                        <span title={`WhatsApp: ${s.whatsappNumber}`} className="text-[#25D366] text-xs">●</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-body text-sm">
                    <span className={s.totalDue > 0 ? 'text-[#F03535]' : 'text-[#4CAF50]'}>
                      {formatCurrency(s.totalDue ?? 0)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-body px-2 py-0.5 ${s.isActive ? 'bg-[#1a3a1a] text-[#4CAF50]' : 'bg-[#2A2A2A] text-[#666]'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => togglePosMutation.mutate({ id: s.id, visibleToCashier: !s.visibleToCashier })}
                      title={s.visibleToCashier ? 'Visible in POS — click to hide' : 'Hidden from POS — click to show'}
                      className={`text-xs font-body px-2 py-0.5 transition-colors ${
                        s.visibleToCashier
                          ? 'bg-[#1a3a1a] text-[#4CAF50] hover:bg-[#225a22]'
                          : 'bg-[#2A2A2A] text-[#666] hover:bg-[#3A3A3A]'
                      }`}
                    >
                      {s.visibleToCashier ? '✓ Visible' : 'Hidden'}
                    </button>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => openLedger(s)} className="text-[#4FC3F7] hover:text-[#81D4FA] font-body text-xs tracking-widest uppercase transition-colors">Ledger</button>
                    <button onClick={() => openPayment(s)} className="text-[#4CAF50] hover:text-[#66BB6A] font-body text-xs tracking-widest uppercase transition-colors">Pay</button>
                    <button onClick={() => openEdit(s)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                    {s.isActive && (
                      <button onClick={() => deactivateMutation.mutate(s.id)} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#666] font-body text-sm">No suppliers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Supplier Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">
              {editing ? 'EDIT SUPPLIER' : 'ADD SUPPLIER'}
            </h2>
            <div className="space-y-4">
              {([
                ['name', 'Name *', undefined, undefined],
                ['contactName', 'Contact Name', undefined, undefined],
                ['phone', 'Phone', undefined, undefined],
                ['whatsappNumber', 'WhatsApp Number', '+8801712345678', 'International format. Used to send Purchase Orders via WhatsApp.'],
                ['email', 'Email', undefined, undefined],
                ['address', 'Address', undefined, undefined],
                ['notes', 'Notes', undefined, undefined],
              ] as [keyof SupplierForm, string, string | undefined, string | undefined][]).map(([key, label, placeholder, hint]) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
                  <input
                    value={form[key]}
                    placeholder={placeholder}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                  {hint ? <span className="text-[#555] text-[11px] font-body">{hint}</span> : null}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SupplierCategory }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {SUPPLIER_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
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
                  <p className="text-[#555] text-[10px] font-body">Set previous outstanding balance if any. This will be added to the supplier's total due.</p>
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

      {/* Payment Dialog */}
      {payingSupplier && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closePaymentDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-2">MAKE PAYMENT</h2>
            <p className="text-[#999] font-body text-sm mb-1">Supplier: <span className="text-white">{payingSupplier.name}</span></p>
            <p className="text-[#999] font-body text-sm mb-6">Outstanding: <span className="text-[#F03535]">{formatCurrency(payingSupplier.totalDue ?? 0)}</span></p>
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

      {/* Ledger Adjustment Dialog. Pure ledger correction — server
          updates Supplier.totalDue + writes an audit row only. NO
          cash account is debited, NO Expense is created, NO Mushak
          posting happens. Use to fix a wrong opening balance or a
          small reconciliation discrepancy. */}
      {adjustingSupplier && (() => {
        const cur = (adjustingSupplier.totalDue ?? 0);
        const raw = parseFloat(adjustForm.amount) || 0;
        const signed = adjustForm.direction === 'reduce' ? -Math.round(raw * 100) : Math.round(raw * 100);
        const next = cur + signed;
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setAdjustingSupplier(null)}>
            <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-display text-xl text-white tracking-widest mb-1">LEDGER ADJUSTMENT</h2>
              <p className="text-[#999] font-body text-sm mb-1">{adjustingSupplier.name}</p>
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
                <button onClick={() => setAdjustingSupplier(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
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
      {ledgerSupplier && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeLedger}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-2">SUPPLIER LEDGER</h2>
            <p className="text-[#999] font-body text-sm mb-6">{ledgerSupplier.name}</p>

            {ledgerLoading ? (
              <p className="text-[#666] font-body text-sm">Loading ledger...</p>
            ) : ledgerData ? (
              <div className="space-y-6">
                {/* Summary */}
                {/* Summary row */}
                <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4">
                  <div className="grid grid-cols-6 gap-3 text-center">
                    {(ledgerData as any).openingBalance > 0 && (
                      <div>
                        <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Opening Bal.</p>
                        <p className="text-[#F03535] font-display text-xl">{formatCurrency((ledgerData as any).openingBalance)}</p>
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
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Returned</p>
                      <p className="text-[#FFA726] font-display text-xl">{formatCurrency(ledgerData.totalReturned)}</p>
                    </div>
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Balance Due</p>
                      <p className={`font-display text-xl ${ledgerData.balance > 0 ? 'text-[#F03535]' : 'text-[#4CAF50]'}`}>{formatCurrency(ledgerData.balance)}</p>
                    </div>
                    <div>
                      <p className="text-[#666] font-body text-[10px] tracking-widest uppercase mb-1">Orders</p>
                      <p className="text-white font-display text-xl">{ledgerData.purchaseOrders.length}</p>
                    </div>
                  </div>
                </div>

                {/* Purchase Order History */}
                <div>
                  <h3 className="font-display text-sm text-white tracking-widest mb-3">PURCHASE ORDER HISTORY</h3>
                  {ledgerData.purchaseOrders.length === 0 ? (
                    <p className="text-[#666] font-body text-sm">No purchase orders.</p>
                  ) : (
                    <div className="space-y-3">
                      {ledgerData.purchaseOrders.map((po) => (
                        <div key={po.id} className="bg-[#0D0D0D] border border-[#2A2A2A] p-4">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-white text-xs">{po.id.slice(-8).toUpperCase()}</span>
                              <span className="text-[#666] font-body text-xs">{new Date(po.createdAt).toLocaleDateString()}</span>
                              <span className="text-xs font-body px-2 py-0.5 bg-[#1a3a1a] text-[#4CAF50]">{po.status}</span>
                            </div>
                            <span className="text-white font-body text-sm font-medium">৳{(po.total / 100).toFixed(2)}</span>
                          </div>
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-[#2A2A2A]">
                                {['Item', 'Qty', 'Unit Price', 'Total'].map((h) => (
                                  <th key={h} className="text-left px-2 py-1 text-[#666] font-body text-[10px] tracking-widest uppercase">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {po.items.map((item) => (
                                <tr key={item.id} className="border-b border-[#1F1F1F] last:border-0">
                                  <td className="px-2 py-1 text-[#999] font-body text-xs">{item.ingredientName}</td>
                                  <td className="px-2 py-1 text-[#999] font-body text-xs">{item.quantityReceived.toFixed(2)} {item.unit}</td>
                                  <td className="px-2 py-1 text-[#999] font-body text-xs">৳{(item.unitCost / 100).toFixed(2)}</td>
                                  <td className="px-2 py-1 text-[#999] font-body text-xs">৳{(item.total / 100).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Receipt-level extras — visibility for the
                              delivery / freight / discount lines that
                              netted into the PO's payable total. */}
                          {((po.receiptExtraFees && po.receiptExtraFees.length > 0) || (po.receiptDiscount && po.receiptDiscount > 0)) && (
                            <div className="mt-2 pt-2 border-t border-[#2A2A2A] space-y-1">
                              {(po.itemsTotal !== undefined) && (
                                <div className="flex justify-between text-[#666] font-body text-[11px]">
                                  <span>Items subtotal</span>
                                  <span>৳{(po.itemsTotal / 100).toFixed(2)}</span>
                                </div>
                              )}
                              {(po.receiptExtraFees ?? []).map((f, idx) => (
                                <div key={idx} className="flex justify-between text-[#FFA726] font-body text-[11px]">
                                  <span>+ {f.label}</span>
                                  <span>৳{(Number(f.amount) / 100).toFixed(2)}</span>
                                </div>
                              ))}
                              {po.receiptDiscount !== undefined && po.receiptDiscount > 0 && (
                                <div className="flex justify-between text-[#4CAF50] font-body text-[11px]">
                                  <span>− Discount{po.receiptDiscountReason ? ` (${po.receiptDiscountReason})` : ''}</span>
                                  <span>−৳{(po.receiptDiscount / 100).toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-white font-body text-xs font-medium pt-1 border-t border-[#1F1F1F]">
                                <span>Net payable</span>
                                <span>৳{(po.total / 100).toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Returns */}
                {ledgerData.returns.length > 0 && (
                  <div>
                    <h3 className="font-display text-sm text-white tracking-widest mb-3">RETURNS</h3>
                    <div className="space-y-3">
                      {ledgerData.returns.map((ret) => (
                        <div key={ret.id} className="bg-[#0D0D0D] border border-[#2A2A2A] p-4">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-white text-xs">{ret.id.slice(-8).toUpperCase()}</span>
                              <span className="text-[#666] font-body text-xs">{ret.completedAt ? new Date(ret.completedAt).toLocaleDateString() : '—'}</span>
                            </div>
                            <span className="text-[#FFA726] font-body text-sm font-medium">-৳{(ret.total / 100).toFixed(2)}</span>
                          </div>
                          {ret.items.map((item, idx) => (
                            <p key={idx} className="text-[#999] font-body text-xs">
                              {item.ingredientName}: {item.quantity.toFixed(2)} {item.unit} @ ৳{(item.unitPrice / 100).toFixed(2)} = ৳{(item.total / 100).toFixed(2)}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Adjustments list — manual ledger corrections. Pure
                    ledger-only (no cash account / expense touched).  */}
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
                          {ledgerData.adjustments.map((a) => (
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

                {/* Payments list */}
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
                          {ledgerData.payments.map((p) => (
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

            <div className="flex gap-3 mt-6">
              <button onClick={closeLedger} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm px-6 py-2.5 transition-colors">Close</button>
              <button onClick={() => { closeLedger(); openPayment(ledgerSupplier); }} className="bg-[#4CAF50] hover:bg-[#66BB6A] text-white font-body text-sm px-6 py-2.5 transition-colors">Make Payment</button>
              <button
                onClick={() => { closeLedger(); openAdjust(ledgerSupplier); }}
                className="bg-[#FFA726] hover:bg-[#FFB74D] text-black font-body text-sm px-6 py-2.5 transition-colors"
                title="Manually correct the supplier's owed balance — does NOT touch any cash account"
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

                    // Purchase Order History with items
                    const poSections = ledgerData.purchaseOrders.map((po) => {
                      const itemRows = po.items.map((item) =>
                        `<tr><td style="${td}">${item.ingredientName}</td><td style="${tdr}">${item.quantityOrdered.toFixed(2)} ${item.unit}</td><td style="${tdr}">${item.quantityReceived.toFixed(2)}</td><td style="${tdr}">৳${(item.unitCost / 100).toFixed(2)}</td><td style="${tdr}">৳${(item.total / 100).toFixed(2)}</td></tr>`
                      ).join('');
                      return `<div style="margin-bottom:20px;page-break-inside:avoid">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                          <div><strong>${po.id.slice(-8).toUpperCase()}</strong> <span style="color:#666;margin-left:8px">${new Date(po.createdAt).toLocaleDateString()}</span> <span style="background:#eee;padding:1px 6px;font-size:10px;margin-left:8px">${po.status}</span></div>
                          <strong>৳${(po.total / 100).toFixed(2)}</strong>
                        </div>
                        <table><thead><tr><th style="${thStyle}">Item</th><th style="${thStyle};text-align:right">Ordered</th><th style="${thStyle};text-align:right">Received</th><th style="${thStyle};text-align:right">Unit Price</th><th style="${thStyle};text-align:right">Total</th></tr></thead><tbody>${itemRows}</tbody></table>
                      </div>`;
                    }).join('');

                    // Returns with items
                    const returnSections = ledgerData.returns.map((ret) => {
                      const retItemRows = ret.items.map((item: any) =>
                        `<tr><td style="${td}">${item.ingredientName ?? item.ingredient?.name ?? '—'}</td><td style="${tdr}">${Number(item.quantity).toFixed(2)}</td><td style="${tdr}">৳${(Number(item.unitPrice) / 100).toFixed(2)}</td><td style="${tdr}">৳${((Number(item.unitPrice) / 100) * Number(item.quantity)).toFixed(2)}</td></tr>`
                      ).join('');
                      return `<div style="margin-bottom:16px;page-break-inside:avoid">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                          <div><strong>${ret.id.slice(-8).toUpperCase()}</strong> <span style="color:#666;margin-left:8px">${ret.completedAt ? new Date(ret.completedAt).toLocaleDateString() : 'Pending'}</span> <span style="background:#fff3e0;padding:1px 6px;font-size:10px;margin-left:8px">${ret.status}</span></div>
                          <strong style="color:#e65100">-৳${(ret.total / 100).toFixed(2)}</strong>
                        </div>
                        <table><thead><tr><th style="${thStyle}">Item</th><th style="${thStyle};text-align:right">Qty</th><th style="${thStyle};text-align:right">Unit Price</th><th style="${thStyle};text-align:right">Total</th></tr></thead><tbody>${retItemRows}</tbody></table>
                      </div>`;
                    }).join('');

                    // Payment History
                    const payRows = ledgerData.payments.map((p) =>
                      `<tr><td style="${td}">${new Date(p.createdAt).toLocaleDateString()}</td><td style="${td}">${p.paymentMethod}</td><td style="${td}">${p.reference ?? '—'}</td><td style="${td}">${p.paidBy?.name ?? '—'}</td><td style="${tdr}">${formatCurrency(p.amount)}</td></tr>`
                    ).join('');
                    const totalPaidPrint = ledgerData.payments.reduce((s, p) => s + Number(p.amount), 0);

                    w.document.write(`<!DOCTYPE html><html><head><title>Ledger - ${ledgerSupplier.name}</title>
                      <style>
                        body{font-family:sans-serif;padding:24px;font-size:13px;color:#333}
                        table{width:100%;border-collapse:collapse;margin-bottom:8px}
                        h2{margin:0 0 4px}h3{margin:24px 0 8px;border-bottom:1px solid #999;padding-bottom:4px;font-size:14px;letter-spacing:2px;text-transform:uppercase}
                        .summary{display:flex;gap:32px;margin:16px 0 24px;padding:12px 16px;background:#f5f5f5;font-size:13px}
                        .summary div{text-align:center}.summary .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:2px}
                        .summary .value{font-size:18px;font-weight:bold}
                      </style></head><body>
                      <h2>Supplier Ledger</h2>
                      <p style="color:#666;margin:0 0 8px">${ledgerSupplier.name}${ledgerSupplier.phone ? ` | ${ledgerSupplier.phone}` : ''}${ledgerSupplier.email ? ` | ${ledgerSupplier.email}` : ''} | Category: ${ledgerSupplier.category}</p>
                      <p style="color:#999;font-size:11px;margin:0 0 16px">Generated: ${new Date().toLocaleString()}</p>

                      <div class="summary">
                        ${(ledgerData as any).openingBalance > 0 ? `<div><div class="label">Opening Bal.</div><div class="value" style="color:#c62828">${formatCurrency((ledgerData as any).openingBalance)}</div></div>` : ''}
                        <div><div class="label">Billed</div><div class="value">${formatCurrency(ledgerData.totalBilled)}</div></div>
                        <div><div class="label">Paid</div><div class="value" style="color:#2e7d32">${formatCurrency(ledgerData.totalPaid)}</div></div>
                        <div><div class="label">Returned</div><div class="value" style="color:#e65100">${formatCurrency(ledgerData.totalReturned)}</div></div>
                        <div><div class="label">Balance Due</div><div class="value" style="color:${ledgerData.balance > 0 ? '#c62828' : '#2e7d32'}">${formatCurrency(ledgerData.balance)}</div></div>
                        <div><div class="label">Orders</div><div class="value">${ledgerData.purchaseOrders.length}</div></div>
                      </div>

                      <h3>Purchase Order History</h3>
                      ${poSections || '<p style="color:#999">No purchase orders.</p>'}

                      ${ledgerData.returns.length > 0 ? `<h3>Returns</h3>${returnSections}` : ''}

                      <h3>Payment History</h3>
                      ${ledgerData.payments.length > 0 ? `
                        <table><thead><tr><th style="${thStyle}">Date</th><th style="${thStyle}">Method</th><th style="${thStyle}">Reference</th><th style="${thStyle}">Paid By</th><th style="${thStyle};text-align:right">Amount</th></tr></thead>
                        <tbody>${payRows}</tbody>
                        <tfoot><tr><td colspan="4" style="padding:8px;border-top:2px solid #333;font-weight:bold">Total Paid</td><td style="padding:8px;border-top:2px solid #333;text-align:right;font-weight:bold">${formatCurrency(totalPaidPrint)}</td></tr></tfoot></table>
                      ` : '<p style="color:#999">No payments recorded.</p>'}

                      <div style="margin-top:32px;border-top:1px solid #ccc;padding-top:8px;text-align:center;color:#999;font-size:10px">
                        Your Restaurant POS — Supplier Ledger Report
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

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Expense, ExpenseCategory, CreateExpenseDto } from '@restora/types';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'SALARY', label: 'Salary' },
  { value: 'SUPPLIES', label: 'Supplies' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'FOOD_COST', label: 'Food Cost' },
  { value: 'STAFF_FOOD', label: 'Staff Food' },
  { value: 'MISCELLANEOUS', label: 'Misc' },
];

const CAT_COLORS: Record<string, string> = {
  RENT: 'text-[#CE93D8]', UTILITIES: 'text-[#29B6F6]', SALARY: 'text-[#FFA726]',
  SUPPLIES: 'text-[#4CAF50]', MAINTENANCE: 'text-[#EF5350]', TRANSPORT: 'text-[#AB47BC]',
  MARKETING: 'text-[#FF7043]', FOOD_COST: 'text-[#66BB6A]', STAFF_FOOD: 'text-[#FFCA28]', MISCELLANEOUS: 'text-[#999]',
};

interface Summary {
  total: number;
  count: number;
  byCategory: Record<string, number>;
  byPaymentMethod: Record<string, number>;
}

export default function ExpensesPage() {
  const qc = useQueryClient();
  const now = new Date();
  const { data: paymentOptions = [] } = useQuery<{ code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
    select: (d: any[]) => d.filter((o) => o.isActive),
  });
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
  const [to, setTo] = useState(now.toISOString().split('T')[0]);
  const [catFilter, setCatFilter] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<CreateExpenseDto>({
    category: 'MISCELLANEOUS', description: '', amount: 0,
    paymentMethod: 'CASH', date: now.toISOString().split('T')[0], notes: '',
  });

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['expenses', from, to, catFilter],
    queryFn: () => api.get(`/expenses?from=${from}&to=${to}${catFilter ? `&category=${catFilter}` : ''}`),
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['expense-summary', from, to],
    queryFn: () => api.get(`/expenses/summary?from=${from}&to=${to}`),
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateExpenseDto) => api.post('/expenses', { ...dto, amount: Math.round(dto.amount * 100) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense-summary'] });
      setShowDialog(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/approve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense-summary'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">EXPENSES</h1>
        <button onClick={() => setShowDialog(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
          + ADD EXPENSE
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category</label>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[#161616] border border-[#2A2A2A] p-4">
            <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Total Expenses</p>
            <p className="font-display text-white text-3xl">{formatCurrency(summary.total)}</p>
            <p className="text-[#666] font-body text-xs mt-1">{summary.count} entries</p>
          </div>
          {Object.entries(summary.byCategory).sort(([, a], [, b]) => b - a).slice(0, 3).map(([cat, amount]) => (
            <div key={cat} className="bg-[#161616] border border-[#2A2A2A] p-4">
              <p className={`font-body text-xs tracking-widest uppercase mb-1 ${CAT_COLORS[cat] ?? 'text-[#666]'}`}>{cat.replace('_', ' ')}</p>
              <p className="font-display text-white text-2xl">{formatCurrency(amount)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expenses table */}
      {isLoading ? <p className="text-[#666] font-body text-sm">Loading...</p> : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Date', 'Category', 'Description', 'Amount', 'Method', 'Recorded By', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`font-body text-xs tracking-widest uppercase ${CAT_COLORS[e.category] ?? 'text-[#999]'}`}>
                      {e.category.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white font-body text-sm">{e.description}</td>
                  <td className="px-4 py-3 text-[#D62B2B] font-body font-medium text-sm">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-3 text-[#666] font-body text-xs uppercase">{e.paymentMethod}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{e.recordedBy?.name ?? '\u2014'}</td>
                  <td className="px-4 py-3">
                    {e.approvedAt ? (
                      <span className="text-[#4CAF50] font-body text-xs">Approved</span>
                    ) : (
                      <span className="text-[#FFA726] font-body text-xs">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    {!e.approvedAt && (
                      <button onClick={() => approveMutation.mutate(e.id)} className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Approve</button>
                    )}
                    <button onClick={() => deleteMutation.mutate(e.id)} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#666] font-body text-sm">No expenses recorded for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Expense Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">ADD EXPENSE</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category *</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ExpenseCategory }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Date *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Description *</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
                  <input type="number" step="0.01" min="0" value={form.amount || ''} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Payment Method</label>
                  <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                    {paymentOptions.map((o) => <option key={o.code} value={o.code}>{o.name}{o.category ? ` (${o.category.name})` : ''}</option>)}
                    {paymentOptions.length === 0 && <><option value="CASH">Cash</option><option value="CARD">Card</option></>}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
            </div>
            {createMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(createMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowDialog(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.description || form.amount <= 0 || createMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving...' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

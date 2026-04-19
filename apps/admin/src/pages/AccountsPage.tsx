import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Account, AccountType, AccountTransaction, PnlReport, CreateAccountDto } from '@restora/types';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'MFS', label: 'MFS' },
  { value: 'POS_TERMINAL', label: 'POS Terminal' },
];

const TYPE_COLORS: Record<string, string> = {
  CASH: 'text-[#4CAF50]', BANK: 'text-[#29B6F6]', MFS: 'text-[#CE93D8]', POS_TERMINAL: 'text-[#FFA726]',
};

// Payment methods loaded dynamically from API

const TXN_COLORS: Record<string, string> = {
  SALE: 'text-[#4CAF50]', EXPENSE: 'text-[#D62B2B]', PURCHASE_PAYMENT: 'text-[#EF5350]', TRANSFER: 'text-[#29B6F6]', ADJUSTMENT: 'text-[#FFA726]',
};

export default function AccountsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'accounts' | 'transactions' | 'pnl'>('accounts');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState<Account | null>(null);
  const [showAdjustDialog, setShowAdjustDialog] = useState<Account | null>(null);
  const [addForm, setAddForm] = useState<CreateAccountDto>({ type: 'CASH', name: '', balance: 0, showInPOS: false, linkedPaymentMethod: null });
  const [editForm, setEditForm] = useState<{ name: string; type: AccountType; showInPOS: boolean; linkedPaymentMethod: string | null }>({ name: '', type: 'CASH', showInPOS: false, linkedPaymentMethod: null });
  const [adjustForm, setAdjustForm] = useState({ amount: '', description: '' });
  const [statementAccount, setStatementAccount] = useState<Account | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromAccountId: '', toAccountId: '', amount: '', description: '' });
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const now = new Date();
  const [pnlFrom, setPnlFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
  const [pnlTo, setPnlTo] = useState(now.toISOString().split('T')[0]);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts'),
  });

  const { data: paymentOpts = [] } = useQuery<{ code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
  });

  const PAYMENT_METHODS = [
    { value: '', label: 'None (not linked)' },
    ...paymentOpts.filter((o) => o.isActive).map((o) => ({ value: o.code, label: `${o.name}${o.category ? ` (${o.category.name})` : ''}` })),
  ];

  const { data: transactions = [] } = useQuery<AccountTransaction[]>({
    queryKey: ['account-transactions'],
    queryFn: () => api.get('/accounts/transactions'),
    enabled: tab === 'transactions',
  });

  const { data: pnl } = useQuery<PnlReport>({
    queryKey: ['pnl', pnlFrom, pnlTo],
    queryFn: () => api.get(`/accounts/pnl?from=${pnlFrom}&to=${pnlTo}`),
    enabled: tab === 'pnl',
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateAccountDto) => api.post('/accounts', {
      ...dto,
      balance: Math.round((dto.balance ?? 0) * 100),
      linkedPaymentMethod: dto.linkedPaymentMethod || null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); setShowAddDialog(false); },
  });

  const editMutation = useMutation({
    mutationFn: () => api.patch(`/accounts/${showEditDialog!.id}`, {
      name: editForm.name,
      type: editForm.type,
      showInPOS: editForm.showInPOS,
      linkedPaymentMethod: editForm.linkedPaymentMethod || null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); setShowEditDialog(null); },
  });

  const adjustMutation = useMutation({
    mutationFn: () => api.post(`/accounts/${showAdjustDialog!.id}/adjust`, {
      amount: Math.round(parseFloat(adjustForm.amount) * 100),
      description: adjustForm.description,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); void qc.invalidateQueries({ queryKey: ['account-transactions'] }); setShowAdjustDialog(null); },
  });

  const transferMutation = useMutation({
    mutationFn: () => api.post('/accounts/transfer', {
      fromAccountId: transferForm.fromAccountId,
      toAccountId: transferForm.toAccountId,
      amount: Math.round(parseFloat(transferForm.amount) * 100),
      description: transferForm.description || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account-transactions'] });
      setShowTransfer(false);
      setTransferForm({ fromAccountId: '', toAccountId: '', amount: '', description: '' });
    },
  });

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">ACCOUNTS</h1>
        {tab === 'accounts' && (
          <div className="flex gap-2">
            <button onClick={() => setShowTransfer(true)} className="bg-[#2A2A2A] hover:bg-[#29B6F6] text-[#999] hover:text-[#0D0D0D] font-body text-sm px-4 py-2 transition-colors">Transfer</button>
            <button onClick={() => setShowAddDialog(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">+ ADD ACCOUNT</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#2A2A2A]">
        {(['accounts', 'transactions', 'pnl'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-6 py-3 font-body text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px ${tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'}`}>
            {t === 'pnl' ? 'Profit & Loss' : t}
          </button>
        ))}
      </div>

      {/* Accounts Tab */}
      {tab === 'accounts' && (
        <>
          <div className="bg-[#161616] border border-[#2A2A2A] p-5">
            <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-2">Total Balance (All Accounts)</p>
            <p className={`font-display text-4xl ${totalBalance >= 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>{formatCurrency(totalBalance)}</p>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {accounts.map((a) => (
              <div key={a.id} className="bg-[#161616] border border-[#2A2A2A] p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className={`font-body text-xs tracking-widest uppercase ${TYPE_COLORS[a.type] ?? 'text-[#999]'}`}>{a.type.replace('_', ' ')}</p>
                    <p className="text-white font-body text-sm mt-1">{a.name}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    {a.showInPOS && <span className="text-[#4CAF50] font-body text-[10px] tracking-widest uppercase border border-[#4CAF50]/30 px-1.5 py-0.5">POS</span>}
                    {a.linkedPaymentMethod && <span className="text-[#29B6F6] font-body text-[10px] tracking-widest uppercase border border-[#29B6F6]/30 px-1.5 py-0.5">{a.linkedPaymentMethod}</span>}
                  </div>
                </div>
                <p className={`font-display text-2xl ${Number(a.balance) >= 0 ? 'text-white' : 'text-[#D62B2B]'}`}>{formatCurrency(Number(a.balance))}</p>
                <div className="flex gap-4 mt-3">
                  <button onClick={() => { setStatementAccount(a); setStatementFrom(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]); setStatementTo(new Date().toISOString().split('T')[0]); }} className="text-[#29B6F6] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Statement</button>
                  <button onClick={() => { setShowAdjustDialog(a); setAdjustForm({ amount: '', description: '' }); }} className="text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Adjust</button>
                  <button onClick={() => { setShowEditDialog(a); setEditForm({ name: a.name, type: a.type, showInPOS: a.showInPOS, linkedPaymentMethod: a.linkedPaymentMethod }); }} className="text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                </div>
              </div>
            ))}
            {accounts.length === 0 && <p className="col-span-4 text-center text-[#666] font-body text-sm py-8">No accounts yet. Add your first account.</p>}
          </div>
        </>
      )}

      {/* Transactions Tab */}
      {tab === 'transactions' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead><tr className="border-b border-[#2A2A2A]">
              {['Date', 'Account', 'Type', 'Amount', 'Description'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-white font-body text-sm">{t.account?.name ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`font-body text-xs tracking-widest uppercase ${TXN_COLORS[t.type] ?? 'text-[#999]'}`}>{t.type.replace('_', ' ')}</span></td>
                  <td className="px-4 py-3"><span className={`font-body text-sm font-medium ${Number(t.amount) >= 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>{Number(t.amount) >= 0 ? '+' : ''}{formatCurrency(Number(t.amount))}</span></td>
                  <td className="px-4 py-3 text-[#666] font-body text-xs">{t.description}</td>
                </tr>
              ))}
              {transactions.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#666] font-body text-sm">No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* P&L Tab */}
      {tab === 'pnl' && (
        <>
          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">From</label>
              <input type="date" value={pnlFrom} onChange={(e) => setPnlFrom(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">To</label>
              <input type="date" value={pnlTo} onChange={(e) => setPnlTo(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
            </div>
          </div>
          {pnl && (
            <div className="space-y-4">
              {/* Revenue */}
              <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                <h3 className="font-display text-lg text-white tracking-widest mb-4">REVENUE</h3>
                <p className="font-display text-3xl text-[#4CAF50]">{formatCurrency(pnl.revenue.total)}</p>
                <div className="mt-3 space-y-1">
                  {Object.entries(pnl.revenue.byMethod).map(([m, a]) => (
                    <div key={m} className="flex justify-between text-sm font-body">
                      <span className="text-[#999]">{m}</span><span className="text-white">{formatCurrency(a)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Costs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                  <h3 className="font-display text-lg text-white tracking-widest mb-2">EXPENSES</h3>
                  <p className="font-display text-2xl text-[#D62B2B]">{formatCurrency(pnl.expenses.total)}</p>
                  <div className="mt-3 space-y-1">
                    {Object.entries(pnl.expenses.byCategory).sort(([,a],[,b]) => b - a).map(([c, a]) => (
                      <div key={c} className="flex justify-between text-xs font-body">
                        <span className="text-[#999]">{c.replace('_', ' ')}</span><span className="text-[#D62B2B]">{formatCurrency(a)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                  <h3 className="font-display text-lg text-white tracking-widest mb-2">PURCHASING COST</h3>
                  <p className="font-display text-2xl text-[#EF5350]">{formatCurrency(pnl.purchasingCost)}</p>
                </div>
              </div>
              {/* Profit */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                  <h3 className="font-display text-lg text-white tracking-widest mb-2">GROSS PROFIT</h3>
                  <p className={`font-display text-3xl ${pnl.grossProfit >= 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>{formatCurrency(pnl.grossProfit)}</p>
                  <p className="text-[#666] font-body text-xs mt-1">Revenue - Purchasing Cost</p>
                </div>
                <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                  <h3 className="font-display text-lg text-white tracking-widest mb-2">NET PROFIT</h3>
                  <p className={`font-display text-3xl ${pnl.netProfit >= 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>{formatCurrency(pnl.netProfit)}</p>
                  <p className="text-[#666] font-body text-xs mt-1">Revenue - Expenses - Purchasing</p>
                </div>
              </div>
              {/* Account Balances */}
              {pnl.accounts.length > 0 && (
                <div className="bg-[#161616] border border-[#2A2A2A] p-5">
                  <h3 className="font-display text-lg text-white tracking-widest mb-4">ACCOUNT BALANCES</h3>
                  <div className="space-y-2">
                    {pnl.accounts.map((a) => (
                      <div key={a.name} className="flex justify-between text-sm font-body">
                        <span className="text-[#999]">{a.name} <span className="text-[#666] text-xs">({a.type.replace('_', ' ')})</span></span>
                        <span className="text-white font-medium">{formatCurrency(a.balance)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Account Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowAddDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">ADD ACCOUNT</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Type *</label>
                <select value={addForm.type} onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value as AccountType }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Name *</label>
                <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Cash Register" className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Opening Balance</label>
                <input type="number" step="0.01" value={addForm.balance ?? ''} onChange={(e) => setAddForm((f) => ({ ...f, balance: parseFloat(e.target.value) || 0 }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Linked Payment Method</label>
                <select value={addForm.linkedPaymentMethod ?? ''} onChange={(e) => setAddForm((f) => ({ ...f, linkedPaymentMethod: e.target.value || null }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={addForm.showInPOS ?? false} onChange={(e) => setAddForm((f) => ({ ...f, showInPOS: e.target.checked }))} className="w-4 h-4 accent-[#D62B2B]" />
                <span className="text-[#999] text-xs font-body tracking-widest uppercase">Show in POS (opening/closing balance)</span>
              </label>
            </div>
            {createMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(createMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddDialog(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => createMutation.mutate(addForm)} disabled={!addForm.name || createMutation.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Balance Dialog */}
      {showAdjustDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowAdjustDialog(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-1">ADJUST BALANCE</h2>
            <p className="text-[#999] font-body text-sm mb-6">{showAdjustDialog.name} — Current: {formatCurrency(Number(showAdjustDialog.balance))}</p>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount — use negative to subtract</label>
                <input type="number" step="0.01" value={adjustForm.amount} onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Reason *</label>
                <input value={adjustForm.description} onChange={(e) => setAdjustForm((f) => ({ ...f, description: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
            </div>
            {adjustMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(adjustMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAdjustDialog(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => adjustMutation.mutate()} disabled={!adjustForm.description || adjustMutation.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">
                {adjustMutation.isPending ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Account Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowEditDialog(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">EDIT ACCOUNT</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Type</label>
                <select value={editForm.type} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as AccountType }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Linked Payment Method</label>
                <select value={editForm.linkedPaymentMethod ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, linkedPaymentMethod: e.target.value || null }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={editForm.showInPOS} onChange={(e) => setEditForm((f) => ({ ...f, showInPOS: e.target.checked }))} className="w-4 h-4 accent-[#D62B2B]" />
                <span className="text-[#999] text-xs font-body tracking-widest uppercase">Show in POS (opening/closing balance)</span>
              </label>
            </div>
            {editMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(editMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowEditDialog(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => editMutation.mutate()} disabled={!editForm.name || editMutation.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">
                {editMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Transfer Dialog */}
      {showTransfer && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowTransfer(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">TRANSFER FUNDS</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">From Account *</label>
                <select value={transferForm.fromAccountId} onChange={(e) => setTransferForm((f) => ({ ...f, fromAccountId: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  <option value="">— Select —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(Number(a.balance))})</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">To Account *</label>
                <select value={transferForm.toAccountId} onChange={(e) => setTransferForm((f) => ({ ...f, toAccountId: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  <option value="">— Select —</option>
                  {accounts.filter((a) => a.id !== transferForm.fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(Number(a.balance))})</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
                <input type="number" step="0.01" min="0" value={transferForm.amount} onChange={(e) => setTransferForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Description</label>
                <input value={transferForm.description} onChange={(e) => setTransferForm((f) => ({ ...f, description: e.target.value }))} placeholder="Reason for transfer..." className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
            </div>
            {transferMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(transferMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowTransfer(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => transferMutation.mutate()}
                disabled={!transferForm.fromAccountId || !transferForm.toAccountId || !transferForm.amount || parseFloat(transferForm.amount) <= 0 || transferMutation.isPending}
                className="flex-1 bg-[#29B6F6] hover:bg-[#4fc3f7] text-[#0D0D0D] font-body text-sm py-2.5 font-medium transition-colors disabled:opacity-50"
              >
                {transferMutation.isPending ? 'Transferring…' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {statementAccount && (
        <StatementModal
          account={statementAccount}
          from={statementFrom}
          to={statementTo}
          onFromChange={setStatementFrom}
          onToChange={setStatementTo}
          onClose={() => setStatementAccount(null)}
        />
      )}
    </div>
  );
}

// ─── Account Statement Modal ─────────────────────────────────────────────────

interface StatementRow { id: string; date: string; type: string; description: string; debit: number; credit: number; balance: number }
interface StatementData {
  account: { id: string; name: string; type: string };
  period: { from: string; to: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  transactionCount: number;
  rows: StatementRow[];
}

function StatementModal({ account, from, to, onFromChange, onToChange, onClose }: {
  account: Account; from: string; to: string;
  onFromChange: (v: string) => void; onToChange: (v: string) => void;
  onClose: () => void;
}) {
  const { data: statement, isLoading } = useQuery<StatementData>({
    queryKey: ['account-statement', account.id, from, to],
    queryFn: () => api.get(`/accounts/${account.id}/statement?from=${from}&to=${to}`),
    enabled: !!from && !!to,
  });

  const printStatement = () => {
    if (!statement) return;
    const s = statement;
    const td = 'padding:4px 8px;border-bottom:1px solid #eee;font-size:12px';
    const tdr = `${td};text-align:right`;
    const thStyle = 'text-align:left;padding:6px 8px;border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:1px';

    const rows = s.rows.map((r) =>
      `<tr>
        <td style="${td}">${new Date(r.date).toLocaleDateString()}</td>
        <td style="${td}">${new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td style="${td}">${r.type.replace('_', ' ')}</td>
        <td style="${td}">${r.description}</td>
        <td style="${tdr}">${r.debit > 0 ? formatCurrency(r.debit) : ''}</td>
        <td style="${tdr}">${r.credit > 0 ? formatCurrency(r.credit) : ''}</td>
        <td style="${tdr};font-weight:bold">${formatCurrency(r.balance)}</td>
      </tr>`
    ).join('');

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Statement - ${s.account.name}</title>
      <style>
        body{font-family:sans-serif;padding:24px;font-size:13px;color:#333}
        table{width:100%;border-collapse:collapse}
        h2{margin:0 0 4px}
        .header{display:flex;justify-content:space-between;margin-bottom:20px}
        .summary{display:flex;gap:40px;margin:12px 0 20px;padding:12px 16px;background:#f5f5f5}
        .summary div{text-align:center}.summary .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:2px}
        .summary .value{font-size:16px;font-weight:bold}
        .opening{background:#f0f0f0;padding:8px 12px;margin-bottom:8px;font-size:12px}
      </style></head><body>
      <div class="header">
        <div>
          <h2>Account Statement</h2>
          <p style="color:#666;margin:2px 0">${s.account.name} (${s.account.type})</p>
          <p style="color:#999;font-size:11px">${new Date(s.period.from).toLocaleDateString()} — ${new Date(s.period.to).toLocaleDateString()}</p>
        </div>
        <div style="text-align:right">
          <p style="color:#999;font-size:10px">Generated: ${new Date().toLocaleString()}</p>
          <p style="color:#999;font-size:10px">Your Restaurant POS</p>
        </div>
      </div>

      <div class="summary">
        <div><div class="label">Opening Balance</div><div class="value">${formatCurrency(s.openingBalance)}</div></div>
        <div><div class="label">Total Credit (+)</div><div class="value" style="color:#2e7d32">${formatCurrency(s.totalCredit)}</div></div>
        <div><div class="label">Total Debit (−)</div><div class="value" style="color:#c62828">${formatCurrency(s.totalDebit)}</div></div>
        <div><div class="label">Closing Balance</div><div class="value">${formatCurrency(s.closingBalance)}</div></div>
        <div><div class="label">Transactions</div><div class="value">${s.transactionCount}</div></div>
      </div>

      <div class="opening">Opening Balance: <strong>${formatCurrency(s.openingBalance)}</strong></div>

      <table>
        <thead><tr>
          <th style="${thStyle}">Date</th><th style="${thStyle}">Time</th><th style="${thStyle}">Type</th><th style="${thStyle}">Description</th>
          <th style="${thStyle};text-align:right">Debit (−)</th><th style="${thStyle};text-align:right">Credit (+)</th><th style="${thStyle};text-align:right">Balance</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#999">No transactions in this period</td></tr>'}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #333">
            <td colspan="4" style="padding:8px;font-weight:bold">Closing Balance</td>
            <td style="padding:8px;text-align:right;font-weight:bold;color:#c62828">${formatCurrency(s.totalDebit)}</td>
            <td style="padding:8px;text-align:right;font-weight:bold;color:#2e7d32">${formatCurrency(s.totalCredit)}</td>
            <td style="padding:8px;text-align:right;font-weight:bold;font-size:14px">${formatCurrency(s.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:24px;border-top:1px solid #ccc;padding-top:8px;text-align:center;color:#999;font-size:10px">
        Your Restaurant POS — Account Statement
      </div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-xl text-white tracking-widest">ACCOUNT STATEMENT</h2>
            <p className="text-[#666] font-body text-xs mt-0.5">{account.name} ({account.type})</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-xs font-body focus:outline-none focus:border-[#D62B2B]" />
            <span className="text-[#666] text-xs">to</span>
            <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-xs font-body focus:outline-none focus:border-[#D62B2B]" />
            <button onClick={printStatement} disabled={!statement} className="bg-[#2A2A2A] hover:bg-[#333] text-[#999] hover:text-white font-body text-xs px-3 py-1.5 transition-colors disabled:opacity-50">Print</button>
            <button onClick={onClose} className="text-[#666] hover:text-white transition-colors text-sm">✕</button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-[#666] font-body text-sm">Loading statement...</div>
        ) : statement ? (
          <>
            {/* Summary */}
            <div className="px-6 py-3 border-b border-[#2A2A2A] flex gap-8 shrink-0">
              <div><p className="text-[#666] font-body text-[10px] tracking-widest uppercase">Opening</p><p className="text-white font-display text-lg">{formatCurrency(statement.openingBalance)}</p></div>
              <div><p className="text-[#666] font-body text-[10px] tracking-widest uppercase">Credit (+)</p><p className="text-[#4CAF50] font-display text-lg">{formatCurrency(statement.totalCredit)}</p></div>
              <div><p className="text-[#666] font-body text-[10px] tracking-widest uppercase">Debit (−)</p><p className="text-[#D62B2B] font-display text-lg">{formatCurrency(statement.totalDebit)}</p></div>
              <div><p className="text-[#666] font-body text-[10px] tracking-widest uppercase">Closing</p><p className="text-white font-display text-lg font-bold">{formatCurrency(statement.closingBalance)}</p></div>
              <div><p className="text-[#666] font-body text-[10px] tracking-widest uppercase">Transactions</p><p className="text-white font-display text-lg">{statement.transactionCount}</p></div>
            </div>

            {/* Transaction table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#161616]">
                  <tr className="border-b border-[#2A2A2A]">
                    {['Date', 'Type', 'Description', 'Debit (−)', 'Credit (+)', 'Balance'].map((h) => (
                      <th key={h} className={`px-4 py-2 text-[#666] font-body text-[10px] tracking-widest uppercase ${h.includes('Debit') || h.includes('Credit') || h.includes('Balance') ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                  <tr className="border-b border-[#2A2A2A] bg-[#0D0D0D]">
                    <td colSpan={5} className="px-4 py-2 text-[#999] font-body text-xs">Opening Balance</td>
                    <td className="px-4 py-2 text-white font-body text-xs text-right font-medium">{formatCurrency(statement.openingBalance)}</td>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row) => (
                    <tr key={row.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                      <td className="px-4 py-2 text-[#999] font-body text-xs">{new Date(row.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2"><span className={`font-body text-[10px] tracking-widest uppercase ${TXN_COLORS[row.type] ?? 'text-[#999]'}`}>{row.type.replace('_', ' ')}</span></td>
                      <td className="px-4 py-2 text-white font-body text-xs">{row.description}</td>
                      <td className="px-4 py-2 text-[#D62B2B] font-body text-xs text-right">{row.debit > 0 ? formatCurrency(row.debit) : ''}</td>
                      <td className="px-4 py-2 text-[#4CAF50] font-body text-xs text-right">{row.credit > 0 ? formatCurrency(row.credit) : ''}</td>
                      <td className="px-4 py-2 text-white font-body text-xs text-right font-medium">{formatCurrency(row.balance)}</td>
                    </tr>
                  ))}
                  {statement.rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[#666] font-body text-sm">No transactions in this period.</td></tr>
                  )}
                </tbody>
                {statement.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[#2A2A2A]">
                      <td colSpan={3} className="px-4 py-3 text-white font-display tracking-widest">CLOSING BALANCE</td>
                      <td className="px-4 py-3 text-[#D62B2B] font-body text-sm text-right font-medium">{formatCurrency(statement.totalDebit)}</td>
                      <td className="px-4 py-3 text-[#4CAF50] font-body text-sm text-right font-medium">{formatCurrency(statement.totalCredit)}</td>
                      <td className="px-4 py-3 text-white font-display text-lg text-right">{formatCurrency(statement.closingBalance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';

import type {
  CashierPermissions,
  ApprovalMode,
  CashierAction,
  ExpenseCategory,
} from '@restora/types';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

const ACTION_LABELS: Record<CashierAction, { label: string; description: string }> = {
  createPurchaseOrder:  { label: 'Create Purchase Order',  description: 'Cashier can draft new POs to suppliers' },
  receivePurchaseOrder: { label: 'Receive Purchase Order', description: 'Cashier can mark a PO as received' },
  returnPurchaseOrder:  { label: 'Return Purchase Order',  description: 'Cashier can record a return to supplier' },
  paySupplier:          { label: 'Pay Supplier',           description: 'Cashier can record a supplier payment' },
  createExpense:        { label: 'Create Expense',         description: 'Cashier can record an operational expense' },
  payPayroll:           { label: 'Pay Payroll',            description: 'Cashier can disburse a generated payroll' },
  createPreReadyKT:     { label: 'Pre-Ready Kitchen Ticket', description: 'Cashier can create a kitchen production ticket for pre-ready items' },
};

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'RENT', 'UTILITIES', 'SALARY', 'SUPPLIES',
  'MAINTENANCE', 'TRANSPORT', 'MARKETING',
  'FOOD_COST', 'STAFF_FOOD', 'MISCELLANEOUS',
];

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; tone: string }[] = [
  { value: 'NONE', label: 'Hidden',  tone: 'text-[#666]' },
  { value: 'AUTO', label: 'Auto',    tone: 'text-[#4CAF50]' },
  { value: 'OTP',  label: 'Manager OTP', tone: 'text-[#FFA726]' },
];

function ActionRow({ action, value, onChange }: {
  action: CashierAction;
  value: { enabled: boolean; approval: ApprovalMode };
  onChange: (v: { enabled: boolean; approval: ApprovalMode }) => void;
}) {
  const meta = ACTION_LABELS[action];
  return (
    <div className="border border-[#2A2A2A] bg-[#161616] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <p className="text-sm font-body font-medium text-white">{meta.label}</p>
          <p className="text-[11px] font-body text-[#666] mt-0.5">{meta.description}</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              // When enabling, never leave the row in NONE/Hidden state — bump it to AUTO so it's actually visible.
              const approval = enabled && value.approval === 'NONE' ? 'AUTO' : value.approval;
              onChange({ ...value, enabled, approval });
            }}
            className="w-4 h-4 accent-[#D62B2B]"
          />
          <span className="text-[10px] font-body text-[#999] tracking-widest uppercase">Enabled</span>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {APPROVAL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            disabled={!value.enabled}
            onClick={() => onChange({ ...value, approval: opt.value })}
            className={`py-2 px-3 text-[10px] font-body font-medium tracking-widest uppercase border transition-colors ${
              !value.enabled
                ? 'border-[#1F1F1F] text-[#444] cursor-not-allowed'
                : value.approval === opt.value
                  ? `border-[#D62B2B] bg-[#D62B2B]/10 ${opt.tone}`
                  : `border-[#2A2A2A] text-[#777] hover:border-[#D62B2B]`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CashierPermissionsPage() {
  const qc = useQueryClient();
  const isOwner = useAuthStore((s) => s.user?.role === 'OWNER');
  const [perms, setPerms] = useState<CashierPermissions | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data: serverPerms } = useQuery<CashierPermissions>({
    queryKey: ['cashier-permissions'],
    queryFn: () => api.get('/cashier-permissions'),
  });

  useEffect(() => {
    if (serverPerms && !perms) setPerms(serverPerms);
  }, [serverPerms, perms]);

  const saveMut = useMutation({
    mutationFn: (p: CashierPermissions) => api.patch<CashierPermissions>('/cashier-permissions', p),
    onSuccess: (saved) => {
      setPerms(saved);
      setSavedAt(Date.now());
      void qc.invalidateQueries({ queryKey: ['cashier-permissions'] });
    },
  });

  if (!perms) {
    return <p className="text-[#666] font-body text-sm p-8">Loading…</p>;
  }

  const setAction = (action: CashierAction, v: { enabled: boolean; approval: ApprovalMode }) => {
    setPerms({ ...perms, [action]: { ...perms[action], ...v } });
  };

  const expense = perms.createExpense;

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Settings</p>
          <h1 className="font-display text-white text-4xl tracking-wide">CASHIER PERMISSIONS</h1>
          <p className="text-[11px] font-body text-[#666] mt-1">
            Branch-wide. Applies to every staff member with role CASHIER. <span className="text-[#999]">Hidden</span> actions don't show in POS.
          </p>
        </div>
        <button
          onClick={() => saveMut.mutate(perms)}
          disabled={!isOwner || saveMut.isPending}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
        >
          <Save size={14} /> {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {savedAt && (
        <div className="px-8 py-2 bg-[#4CAF50]/10 border-b border-[#4CAF50]/20 text-[11px] font-body text-[#4CAF50]">
          ✓ Saved at {new Date(savedAt).toLocaleTimeString()}
        </div>
      )}

      <div className="flex-1 overflow-auto p-8 space-y-6">
        {!isOwner && (
          <div className="bg-[#161616] border border-[#2A2A2A] p-3 text-xs font-body text-[#999]">
            Read-only — only OWNER can modify cashier permissions.
          </div>
        )}

        {/* Purchasing actions */}
        <Section icon={<ShieldCheck size={14} className="text-[#D62B2B]" />} title="Purchasing">
          <ActionRow action="createPurchaseOrder"  value={perms.createPurchaseOrder}  onChange={(v) => setAction('createPurchaseOrder', v)} />
          <ActionRow action="receivePurchaseOrder" value={perms.receivePurchaseOrder} onChange={(v) => setAction('receivePurchaseOrder', v)} />
          <ActionRow action="returnPurchaseOrder"  value={perms.returnPurchaseOrder}  onChange={(v) => setAction('returnPurchaseOrder', v)} />
          <ActionRow action="paySupplier"          value={perms.paySupplier}          onChange={(v) => setAction('paySupplier', v)} />
        </Section>

        {/* Finance actions */}
        <Section icon={<Shield size={14} className="text-[#D62B2B]" />} title="Finance">
          <div className="border border-[#2A2A2A] bg-[#161616] p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1">
                <p className="text-sm font-body font-medium text-white">Create Expense</p>
                <p className="text-[11px] font-body text-[#666] mt-0.5">Cashier can record an operational expense in selected categories.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={expense.enabled}
                  onChange={(e) => setPerms({ ...perms, createExpense: { ...expense, enabled: e.target.checked } })}
                  className="w-4 h-4 accent-[#D62B2B]"
                />
                <span className="text-[10px] font-body text-[#999] tracking-widest uppercase">Enabled</span>
              </label>
            </div>
            {expense.enabled && (
              <div className="space-y-3">
                <p className="text-[10px] font-body text-[#999] tracking-widest uppercase">Allowed categories &amp; per-category approval</p>
                <div className="grid grid-cols-1 gap-2">
                  {EXPENSE_CATEGORIES.map((cat) => {
                    const allowed = expense.allowedCategories.includes(cat);
                    const mode: ApprovalMode = expense.categoryApproval[cat] ?? expense.approval;
                    const toggleAllowed = () => {
                      const next = allowed
                        ? expense.allowedCategories.filter((c) => c !== cat)
                        : [...expense.allowedCategories, cat];
                      setPerms({ ...perms, createExpense: { ...expense, allowedCategories: next } });
                    };
                    const setMode = (m: ApprovalMode) => {
                      setPerms({
                        ...perms,
                        createExpense: {
                          ...expense,
                          categoryApproval: { ...expense.categoryApproval, [cat]: m },
                        },
                      });
                    };
                    return (
                      <div key={cat} className="flex items-center gap-3 border border-[#1F1F1F] px-3 py-2">
                        <label className="flex items-center gap-2 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowed}
                            onChange={toggleAllowed}
                            className="w-3.5 h-3.5 accent-[#D62B2B]"
                          />
                          <span className="text-xs font-body text-white">{cat.replace('_', ' ')}</span>
                        </label>
                        <div className="flex gap-1">
                          {APPROVAL_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              disabled={!allowed}
                              onClick={() => setMode(opt.value)}
                              className={`py-1 px-2 text-[9px] font-body font-medium tracking-widest uppercase border transition-colors ${
                                !allowed
                                  ? 'border-[#1F1F1F] text-[#444] cursor-not-allowed'
                                  : mode === opt.value
                                    ? `border-[#D62B2B] bg-[#D62B2B]/10 ${opt.tone}`
                                    : 'border-[#2A2A2A] text-[#777] hover:border-[#D62B2B]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <ActionRow action="payPayroll" value={perms.payPayroll} onChange={(v) => setAction('payPayroll', v)} />
        </Section>

        {/* Production actions */}
        <Section icon={<ShieldAlert size={14} className="text-[#D62B2B]" />} title="Production">
          <ActionRow action="createPreReadyKT" value={perms.createPreReadyKT} onChange={(v) => setAction('createPreReadyKT', v)} />
        </Section>

        <div className="text-[10px] font-body text-[#666] flex items-center gap-3 pt-2">
          <span className="flex items-center gap-1"><ShieldX size={10} /> Hidden = button doesn't appear in POS</span>
          <span className="flex items-center gap-1"><ShieldCheck size={10} /> Auto = no challenge</span>
          <span className="flex items-center gap-1"><Shield size={10} /> Manager OTP = SMS code required</span>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <p className="text-xs font-body font-medium text-[#999] tracking-widest uppercase">{title}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

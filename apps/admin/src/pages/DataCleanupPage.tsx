import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

type Scope =
  | 'orders'
  | 'work-periods'
  | 'accounts-transactions'
  | 'accounts-all'
  | 'expenses'
  | 'discounts'
  | 'coupons'
  | 'stock-zero'
  | 'stock-movements'
  | 'inventory-all'
  | 'recipes'
  | 'menu-items'
  | 'menu-all'
  | 'pre-ready'
  | 'suppliers'
  | 'creditors'
  | 'purchases'
  | 'returns'
  | 'customers'
  | 'attendance'
  | 'payroll'
  | 'sms-logs'
  | 'reset-all';

interface Action {
  scope: Scope;
  label: string;
  desc: string;
  danger?: boolean;
}

interface Section {
  title: string;
  actions: Action[];
}

const SECTIONS: Section[] = [
  {
    title: 'Orders & Sales',
    actions: [
      { scope: 'orders', label: 'Delete all orders', desc: 'Removes all orders, items, payments, reviews, and any Mushak 6.3 invoices / 6.8 credit notes linked to them.' },
    ],
  },
  {
    title: 'Daily Reports',
    actions: [
      { scope: 'work-periods', label: 'Delete all daily reports', desc: 'Removes all work period / daily closing records.' },
    ],
  },
  {
    title: 'Accounts',
    actions: [
      { scope: 'accounts-transactions', label: 'Delete transactions & reset balances', desc: 'Wipes all account transactions and sets balances to 0.' },
      { scope: 'accounts-all', label: 'Delete all accounts', desc: 'Removes accounts and their transactions entirely.', danger: true },
    ],
  },
  {
    title: 'Expenses',
    actions: [
      { scope: 'expenses', label: 'Delete all expenses', desc: 'Removes every expense record.' },
    ],
  },
  {
    title: 'Inventory / Stock',
    actions: [
      { scope: 'stock-zero', label: 'Set all stock to 0', desc: 'Keeps ingredients but zeroes their stock and clears movements.' },
      { scope: 'stock-movements', label: 'Delete stock movements only', desc: 'Removes movement history; stock totals stay.' },
      { scope: 'inventory-all', label: 'Delete all inventory', desc: 'Removes ingredients, recipes, pre-ready recipes, movements, waste logs.', danger: true },
    ],
  },
  {
    title: 'Discounts & Coupons',
    actions: [
      { scope: 'discounts', label: 'Delete all discounts', desc: 'Removes all discount rules and menu item discounts.' },
      { scope: 'coupons', label: 'Delete all coupons', desc: 'Removes all coupon codes.' },
    ],
  },
  {
    title: 'Recipes',
    actions: [
      { scope: 'recipes', label: 'Delete all recipes', desc: 'Removes recipes and their items.' },
    ],
  },
  {
    title: 'Menu',
    actions: [
      { scope: 'menu-items', label: 'Delete all menu items', desc: 'Removes items, their recipes, and any addon groups attached to them. Categories stay.' },
      { scope: 'menu-all', label: 'Delete menu items + categories', desc: 'Wipes the entire menu structure including addon groups + options.', danger: true },
    ],
  },
  {
    title: 'Pre-Ready',
    actions: [
      { scope: 'pre-ready', label: 'Delete all pre-ready data', desc: 'Removes pre-ready items, recipes, production orders, and batches.' },
    ],
  },
  {
    title: 'Suppliers',
    actions: [
      { scope: 'suppliers', label: 'Delete all suppliers', desc: 'Removes suppliers and their payments, ledger adjustments, ingredient links.' },
    ],
  },
  {
    title: 'Liabilities',
    actions: [
      { scope: 'creditors', label: 'Delete all creditors', desc: 'Removes creditors (utilities, landlords, banks, individual lenders) and their bills, payments, and ledger adjustments.' },
    ],
  },
  {
    title: 'Purchases',
    actions: [
      { scope: 'purchases', label: 'Delete all purchase orders', desc: 'Removes purchase orders and their items.' },
    ],
  },
  {
    title: 'Returns',
    actions: [
      { scope: 'returns', label: 'Delete all purchase returns', desc: 'Removes return records and their items.' },
    ],
  },
  {
    title: 'Customers',
    actions: [
      { scope: 'customers', label: 'Delete all customers', desc: 'Removes the customer directory.' },
    ],
  },
  {
    title: 'Staff',
    actions: [
      { scope: 'attendance', label: 'Delete all attendance', desc: 'Removes attendance records.' },
      { scope: 'payroll', label: 'Delete all payroll records', desc: 'Removes payroll runs and payments.' },
    ],
  },
  {
    title: 'Communications',
    actions: [
      { scope: 'sms-logs', label: 'Delete all SMS logs', desc: 'Clears the outbound SMS history (campaigns, payment receipts, OTPs). Templates are kept.' },
    ],
  },
  {
    title: 'DANGER ZONE',
    actions: [
      { scope: 'reset-all', label: 'Reset everything (transactional)', desc: 'Wipes orders, purchases, returns, expenses, accounts (zeroed), stock movements, pre-ready, attendance, payroll, waste, SMS logs, Mushak invoices + credit notes. Keeps users, branch, settings, menu, ingredients, suppliers, SMS templates.', danger: true },
    ],
  },
];

export default function DataCleanupPage() {
  const user = useAuthStore((s) => s.user);
  const [pending, setPending] = useState<Action | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<string | null>(null);

  // Hooks must be called unconditionally in the same order every render —
  // keep all hook calls above any early return.
  const { data: branding } = useQuery<{ name: string }>({
    queryKey: ['branding'],
    queryFn: () => api.get('/branding'),
  });

  const mutation = useMutation({
    mutationFn: (dto: { scope: Scope; password: string; confirmName: string }) =>
      api.post<{ scope: string; deleted: Record<string, number> }>('/cleanup', dto),
    onSuccess: (data) => {
      const lines = Object.entries(data.deleted)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      setResult(`Cleanup complete (${data.scope})\n\n${lines}`);
      setPending(null);
      setConfirmName('');
      setPassword('');
    },
    onError: (err: Error) => {
      setResult(`Error: ${err.message}`);
    },
  });

  if (user?.role !== 'OWNER') {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-2">Data Cleanup</h1>
        <p className="text-red-600">Only the OWNER can access this page.</p>
      </div>
    );
  }

  const branchName = branding?.name ?? user?.branchName ?? '';

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Data Cleanup</h1>
      <p className="text-gray-600 mb-6">
        Permanently delete data from this branch. These actions cannot be undone — make a backup first.
      </p>

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            className={`border bg-white p-4 ${
              section.title === 'DANGER ZONE' ? 'border-red-500 border-2' : 'border-gray-300'
            }`}
          >
            <h2
              className={`text-lg font-bold mb-3 ${
                section.title === 'DANGER ZONE' ? 'text-red-600' : ''
              }`}
            >
              {section.title}
            </h2>
            <div className="space-y-2">
              {section.actions.map((a) => (
                <div
                  key={a.scope}
                  className="flex items-start justify-between gap-4 border-t border-gray-200 pt-2"
                >
                  <div className="flex-1">
                    <div className="font-semibold">{a.label}</div>
                    <div className="text-sm text-gray-600">{a.desc}</div>
                  </div>
                  <button
                    onClick={() => {
                      setResult(null);
                      setPending(a);
                    }}
                    className={`px-4 py-2 text-sm font-semibold text-white whitespace-nowrap ${
                      a.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-900'
                    }`}
                  >
                    Run
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {pending && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-md w-full p-6 border-2 border-red-500">
            <h3 className="text-xl font-bold text-red-600 mb-2">Confirm: {pending.label}</h3>
            <p className="text-sm text-gray-700 mb-4">{pending.desc}</p>
            <p className="text-sm mb-4">
              This will permanently delete data for branch <strong>{branchName}</strong>. Type the
              branch name and your OWNER password to confirm.
            </p>

            <label className="block text-sm font-semibold mb-1">
              Type branch name: <code className="bg-gray-100 px-1">{branchName}</code>
            </label>
            <input
              type="text"
              name="cleanup-branch-name"
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={branchName}
              className="w-full border border-gray-300 px-3 py-2 mb-3"
            />

            <label className="block text-sm font-semibold mb-1">OWNER password</label>
            <input
              type="password"
              name="cleanup-owner-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 px-3 py-2 mb-4"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setPending(null);
                  setConfirmName('');
                  setPassword('');
                }}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300"
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  mutation.mutate({ scope: pending.scope, password, confirmName })
                }
                disabled={mutation.isPending || !password || !confirmName}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {mutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result toast */}
      {result && (
        <div className="fixed bottom-4 right-4 bg-white border-2 border-gray-800 p-4 max-w-md shadow-lg z-50">
          <pre className="text-xs whitespace-pre-wrap">{result}</pre>
          <button
            onClick={() => setResult(null)}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

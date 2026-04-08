import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Truck, Package, Undo2, Wallet } from 'lucide-react';

import type { CashierAction, ApprovalMode, PurchaseOrder } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import { useCashierPermissions } from '../lib/permissions';
import ApprovalOtpDialog from '../components/ApprovalOtpDialog';

interface Supplier { id: string; name: string; totalDue: number }
interface Ingredient {
  id: string;
  name: string;
  itemCode: string | null;
  unit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: number;
  currentStock: number;
  costPerUnit: number;
  costPerPurchaseUnit: number;
}

type Tab = 'create-po' | 'receive' | 'returns' | 'pay';

interface POLine { ingredientId: string; quantity: string; unit: string; unitCost: string }

const CONVERSION_MAP: Record<string, string[]> = {
  KG: ['KG', 'G'], G: ['G', 'KG'],
  L: ['L', 'ML'], ML: ['ML', 'L'],
  DOZEN: ['DOZEN', 'PCS'], PCS: ['PCS', 'DOZEN'],
  BOX: ['BOX'],
};
function convertibleUnits(unit: string): string[] {
  return CONVERSION_MAP[unit] ?? [unit];
}

function ingredientLabel(i: Ingredient) {
  const u = i.purchaseUnit || i.unit;
  return `${i.itemCode ? `[${i.itemCode}] ` : ''}${i.name} (${u})`;
}

/**
 * Find a single ingredient that matches the user's free-text search.
 * Accepts exact label, name, or itemCode (case-insensitive).
 */
function matchIngredient(list: Ingredient[], q: string): Ingredient | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  return (
    list.find((i) => ingredientLabel(i).toLowerCase() === t) ??
    list.find((i) => i.name.toLowerCase() === t) ??
    list.find((i) => (i.itemCode ?? '').toLowerCase() === t) ??
    null
  );
}

const TAB_LABELS: Record<Tab, { label: string; Icon: typeof Truck }> = {
  'create-po': { label: 'Create PO',      Icon: Plus },
  'receive':   { label: 'Receive Goods',  Icon: Package },
  'returns':   { label: 'Returns',        Icon: Undo2 },
  'pay':       { label: 'Pay Supplier',   Icon: Wallet },
};

export default function PosPurchasingPage() {
  const qc = useQueryClient();
  const { data: perms } = useCashierPermissions();

  const enabledTabs = useMemo<Tab[]>(() => {
    if (!perms) return [];
    const out: Tab[] = [];
    if (perms.createPurchaseOrder.enabled  && perms.createPurchaseOrder.approval !== 'NONE')  out.push('create-po');
    if (perms.receivePurchaseOrder.enabled && perms.receivePurchaseOrder.approval !== 'NONE') out.push('receive');
    if (perms.returnPurchaseOrder.enabled  && perms.returnPurchaseOrder.approval !== 'NONE')  out.push('returns');
    if (perms.paySupplier.enabled          && perms.paySupplier.approval !== 'NONE')          out.push('pay');
    return out;
  }, [perms]);

  const [tab, setTab] = useState<Tab>('create-po');
  const activeTab: Tab = enabledTabs.includes(tab) ? tab : (enabledTabs[0] ?? 'create-po');

  // Visible-to-cashier only — used by Create PO tab
  const { data: visibleSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers', 'visible'],
    queryFn: () => api.get('/suppliers'),
  });
  // All suppliers — used by Receive / Returns / Pay tabs
  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers', 'all'],
    queryFn: () => api.get('/cashier-ops/suppliers/all'),
  });
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
  });
  const { data: openPOs = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchasing', 'open'],
    queryFn: () => api.get('/cashier-ops/purchase-orders/open'),
  });

  // ─── Approval-OTP gate helper ─────────────────────────────────────────────
  const [pendingAction, setPendingAction] = useState<null | { action: CashierAction; summary: string; run: (otp: string | null) => void }>(null);

  const guardAndRun = (action: CashierAction, summary: string, run: (otp: string | null) => void) => {
    const cfg = perms?.[action];
    if (!cfg || !cfg.enabled || cfg.approval === 'NONE') return;
    if (cfg.approval === 'AUTO') { run(null); return; }
    setPendingAction({ action, summary, run });
  };

  if (enabledTabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-center max-w-sm">
          <Truck size={36} className="text-theme-text-muted mx-auto mb-3" />
          <p className="text-sm font-semibold text-theme-text">No purchasing actions enabled</p>
          <p className="text-xs text-theme-text-muted mt-1">Ask your administrator to enable cashier purchasing in admin → Cashier Permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Top bar — matches OrderPage / TablesPage */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <Truck size={18} className="text-theme-accent" />
        <div className="h-8 w-px bg-theme-border" />
        <h1 className="text-xl font-extrabold text-theme-text">Purchasing</h1>
        <div className="flex-1" />
      </header>

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
        {activeTab === 'create-po' && (
          <CreatePoTab
            suppliers={visibleSuppliers}
            ingredients={ingredients}
            mode={perms?.createPurchaseOrder.approval ?? 'OTP'}
            guardAndRun={guardAndRun}
            qc={qc}
          />
        )}
        {activeTab === 'receive' && (
          <ReceiveTab
            openPOs={openPOs}
            ingredients={ingredients}
            mode={perms?.receivePurchaseOrder.approval ?? 'OTP'}
            guardAndRun={guardAndRun}
            qc={qc}
          />
        )}
        {activeTab === 'returns' && (
          <ReturnsTab
            suppliers={allSuppliers}
            ingredients={ingredients}
            mode={perms?.returnPurchaseOrder.approval ?? 'OTP'}
            guardAndRun={guardAndRun}
            qc={qc}
          />
        )}
        {activeTab === 'pay' && (
          <PayTab
            suppliers={allSuppliers}
            mode={perms?.paySupplier.approval ?? 'OTP'}
            guardAndRun={guardAndRun}
            qc={qc}
          />
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

// ─── Tab: Create PO ──────────────────────────────────────────────────────────

function CreatePoTab({ suppliers, ingredients, guardAndRun, qc }: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  mode: ApprovalMode;
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POLine[]>([{ ingredientId: '', quantity: '', unit: '', unitCost: '' }]);
  const [search, setSearch] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity || '0') * parseFloat(l.unitCost || '0')), 0);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onSearchChange = (idx: number, val: string) => {
    setSearch((s) => ({ ...s, [idx]: val }));
    const match = matchIngredient(ingredients, val);
    if (match) {
      const hasPU = !!match.purchaseUnit && Number(match.purchaseUnitQty) > 0;
      const unit = match.purchaseUnit || match.unit;
      const cost = hasPU
        ? (Number(match.costPerPurchaseUnit) / 100).toFixed(2)
        : (Number(match.costPerUnit) / 100).toFixed(2);
      updateLine(idx, { ingredientId: match.id, unit, unitCost: cost });
    } else if (!val.trim()) {
      updateLine(idx, { ingredientId: '', unit: '', unitCost: '' });
    }
  };

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/purchase-order/create', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchasing', 'open'] });
      setSupplierId('');
      setNotes('');
      setLines([{ ingredientId: '', quantity: '', unit: '', unitCost: '' }]);
      setSearch({});
      setError('Purchase order created ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    if (!supplierId) return setError('Pick a supplier');
    const valid = lines.filter((l) => l.ingredientId && parseFloat(l.quantity) > 0);
    if (!valid.length) return setError('Add at least one item');
    const supplier = suppliers.find((s) => s.id === supplierId);
    guardAndRun('createPurchaseOrder', `New PO for ${supplier?.name ?? 'supplier'} · ${formatCurrency(Math.round(total * 100))}`, (otp) => {
      mut.mutate({
        supplierId,
        notes: notes || undefined,
        items: valid.map((l) => ({
          ingredientId: l.ingredientId,
          quantityOrdered: parseFloat(l.quantity),
          unitCost: Math.round(parseFloat(l.unitCost || '0') * 100),
          unit: l.unit || undefined,
        })),
        actionOtp: otp ?? undefined,
      });
    });
  };

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">New Purchase Order</p>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            <option value="">— Select —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_110px_110px_110px_32px] gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
          <span>Item</span>
          <span className="text-right">Quantity</span>
          <span className="text-center">Unit</span>
          <span className="text-right">৳ / unit</span>
          <span />
        </div>
        {lines.map((line, idx) => {
          const ing = ingredients.find((i) => i.id === line.ingredientId) ?? null;
          const units = ing
            ? (ing.purchaseUnit ? [ing.purchaseUnit] : convertibleUnits(ing.unit))
            : [];
          const listId = `pos-po-ing-${idx}`;
          const searchVal = search[idx] !== undefined ? search[idx] : (ing ? ingredientLabel(ing) : '');
          return (
            <div key={idx} className="grid grid-cols-[1fr_110px_110px_110px_32px] gap-2 items-center">
              <input
                list={listId}
                value={searchVal}
                onChange={(e) => onSearchChange(idx, e.target.value)}
                placeholder="Search ingredient or code…"
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              />
              <datalist id={listId}>
                {ingredients.map((i) => (
                  <option key={i.id} value={ingredientLabel(i)}>
                    Stock: {Number(i.currentStock).toFixed(1)} {i.unit}
                  </option>
                ))}
              </datalist>
              <input
                type="number" step="0.01" min="0" placeholder="0"
                value={line.quantity}
                onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-right"
              />
              {units.length > 1 ? (
                <select
                  value={line.unit}
                  onChange={(e) => updateLine(idx, { unit: e.target.value })}
                  className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-center"
                >
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) : (
                <div className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text-muted text-center">
                  {line.unit || '—'}
                </div>
              )}
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={line.unitCost}
                onChange={(e) => updateLine(idx, { unitCost: e.target.value })}
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-right"
              />
              <button
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))}
                className="text-theme-text-muted hover:text-theme-danger w-8 h-8 flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setLines((ls) => [...ls, { ingredientId: '', quantity: '', unit: '', unitCost: '' }])}
          className="text-xs font-semibold text-theme-accent hover:underline flex items-center gap-1 mt-1"
        >
          <Plus size={12} /> Add item
        </button>
      </div>

      <div className="border-t border-theme-border mt-5 pt-3 flex items-center justify-between">
        <span className="text-sm text-theme-text-muted">Total</span>
        <span className="text-2xl font-extrabold text-theme-text">{formatCurrency(Math.round(total * 100))}</span>
      </div>

      {error && (
        <p className={`text-xs mt-2 ${error.endsWith('✓') ? 'text-theme-pop' : 'text-theme-danger'}`}>{error}</p>
      )}

      <button
        onClick={submit}
        disabled={mut.isPending}
        className="w-full mt-3 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
      >
        {mut.isPending ? 'Creating…' : 'Create Purchase Order'}
      </button>
    </div>
  );
}

// ─── Tab: Receive Goods ──────────────────────────────────────────────────────

function poUnit(ingredient?: { unit?: string; purchaseUnit?: string | null } | null, itemUnit?: string | null): string {
  return itemUnit || ingredient?.purchaseUnit || ingredient?.unit || '';
}

function ReceiveTab({ openPOs, guardAndRun, qc }: {
  openPOs: PurchaseOrder[];
  ingredients: Ingredient[];
  mode: ApprovalMode;
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [poId, setPoId] = useState('');
  const po = openPOs.find((p) => p.id === poId);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [receivePrices, setReceivePrices] = useState<Record<string, string>>({});
  const [receiveNotes, setReceiveNotes] = useState('');
  const [error, setError] = useState('');

  const grandTotal = po
    ? po.items.reduce((sum, item) => {
        const qty = parseFloat(receiveQtys[item.id] || '0') || 0;
        const price = parseFloat(receivePrices[item.id] || '') || (Number(item.unitCost) / 100);
        return sum + qty * price;
      }, 0)
    : 0;

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/purchase-order/receive', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchasing', 'open'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      setPoId('');
      setReceiveQtys({});
      setReceivePrices({});
      setReceiveNotes('');
      setError('Goods received ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    if (!po) return setError('Pick a PO');
    const items = po.items
      .filter((i) => parseFloat(receiveQtys[i.id] || '0') > 0)
      .map((i) => {
        const priceStr = receivePrices[i.id];
        const unitPrice = priceStr ? Math.round(parseFloat(priceStr) * 100) : undefined;
        return {
          purchaseOrderItemId: i.id,
          quantityReceived: parseFloat(receiveQtys[i.id]),
          unitPrice,
        };
      });
    if (!items.length) return setError('Enter at least one received quantity');
    guardAndRun('receivePurchaseOrder', `Receive PO #${po.id.slice(-6).toUpperCase()} · ${po.supplier?.name ?? ''}`, (otp) => {
      mut.mutate({
        purchaseOrderId: po.id,
        items,
        notes: receiveNotes || undefined,
        actionOtp: otp ?? undefined,
      });
    });
  };

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-5xl">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">Receive Goods</p>

      <div className="mb-5">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Open Purchase Order</label>
        <select
          value={poId}
          onChange={(e) => { setPoId(e.target.value); setReceiveQtys({}); setReceivePrices({}); setReceiveNotes(''); }}
          className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
        >
          <option value="">— Select —</option>
          {openPOs.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id.slice(-6).toUpperCase()} · {p.supplier?.name ?? '—'} · {p.status}
            </option>
          ))}
        </select>
      </div>

      {po && (
        <div className="space-y-3">
          <div className="grid grid-cols-[3fr_120px_120px_110px_70px] gap-3 px-2 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
            <span>Item</span>
            <span className="text-right">Qty Receiving</span>
            <span className="text-right">Unit Price (৳)</span>
            <span className="text-right">Line Total</span>
            <span className="text-center">Unit</span>
          </div>
          {po.items.map((item) => {
            const rqty = parseFloat(receiveQtys[item.id] || '0') || 0;
            const rprice = parseFloat(receivePrices[item.id] || '') || (Number(item.unitCost) / 100);
            const lineTotal = rqty * rprice;
            const remaining = Number(item.quantityOrdered) - Number(item.quantityReceived);
            const unitLabel = poUnit(item.ingredient, (item as { unit?: string }).unit);
            return (
              <div key={item.id} className="grid grid-cols-[3fr_120px_120px_110px_70px] gap-3 items-center bg-theme-bg rounded-theme p-3">
                <div>
                  <p className="text-sm font-semibold text-theme-text">{item.ingredient?.name ?? '—'}</p>
                  <p className="text-[11px] text-theme-text-muted">
                    Ordered {Number(item.quantityOrdered).toFixed(3)} · Received {Number(item.quantityReceived).toFixed(3)} · Remaining {remaining.toFixed(3)}
                  </p>
                </div>
                <input
                  type="number" step="0.001" min="0" placeholder="0"
                  value={receiveQtys[item.id] ?? ''}
                  onChange={(e) => setReceiveQtys((q) => ({ ...q, [item.id]: e.target.value }))}
                  className="bg-theme-surface rounded-theme px-2 py-2 text-sm font-semibold text-theme-text outline-none border border-theme-border focus:border-theme-accent text-right"
                />
                <input
                  type="number" step="0.01" min="0"
                  placeholder={(Number(item.unitCost) / 100).toFixed(2)}
                  value={receivePrices[item.id] ?? ''}
                  onChange={(e) => setReceivePrices((p) => ({ ...p, [item.id]: e.target.value }))}
                  className="bg-theme-surface rounded-theme px-2 py-2 text-sm font-semibold text-theme-text outline-none border border-theme-border focus:border-theme-accent text-right"
                />
                <span className="text-sm font-bold text-theme-text text-right">
                  {rqty > 0 ? formatCurrency(Math.round(lineTotal * 100)) : '—'}
                </span>
                <span className="text-xs text-theme-text-muted text-center">{unitLabel}</span>
              </div>
            );
          })}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5 mt-2">Notes</label>
            <input
              value={receiveNotes}
              onChange={(e) => setReceiveNotes(e.target.value)}
              placeholder="Delivery note, batch number, etc."
              className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
            />
          </div>

          <div className="border-t border-theme-border mt-3 pt-3 flex items-center justify-between">
            <span className="text-sm text-theme-text-muted">Total Receiving</span>
            <span className="text-2xl font-extrabold text-theme-text">{formatCurrency(Math.round(grandTotal * 100))}</span>
          </div>
        </div>
      )}

      {error && (
        <p className={`text-xs mt-3 ${error.endsWith('✓') ? 'text-theme-pop' : 'text-theme-danger'}`}>{error}</p>
      )}

      <button
        onClick={submit}
        disabled={mut.isPending || !po}
        className="w-full mt-3 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
      >
        {mut.isPending ? 'Receiving…' : 'Confirm Receipt'}
      </button>
    </div>
  );
}

// ─── Tab: Returns ────────────────────────────────────────────────────────────

function ReturnsTab({ suppliers, ingredients, guardAndRun, qc }: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  mode: ApprovalMode;
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POLine[]>([{ ingredientId: '', quantity: '', unit: '', unitCost: '' }]);
  const [search, setSearch] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity || '0') * parseFloat(l.unitCost || '0')), 0);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onSearchChange = (idx: number, val: string) => {
    setSearch((s) => ({ ...s, [idx]: val }));
    const match = matchIngredient(ingredients, val);
    if (match) {
      const hasPU = !!match.purchaseUnit && Number(match.purchaseUnitQty) > 0;
      const unit = match.purchaseUnit || match.unit;
      const cost = hasPU
        ? (Number(match.costPerPurchaseUnit) / 100).toFixed(2)
        : (Number(match.costPerUnit) / 100).toFixed(2);
      updateLine(idx, { ingredientId: match.id, unit, unitCost: cost });
    } else if (!val.trim()) {
      updateLine(idx, { ingredientId: '', unit: '', unitCost: '' });
    }
  };

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/purchase-order/return', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      setSupplierId('');
      setNotes('');
      setLines([{ ingredientId: '', quantity: '', unit: '', unitCost: '' }]);
      setSearch({});
      setError('Return recorded ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    if (!supplierId) return setError('Pick a supplier');
    const valid = lines.filter((l) => l.ingredientId && parseFloat(l.quantity) > 0);
    if (!valid.length) return setError('Add at least one item');
    const supplier = suppliers.find((s) => s.id === supplierId);
    guardAndRun('returnPurchaseOrder', `Return to ${supplier?.name ?? ''} · ${formatCurrency(Math.round(total * 100))}`, (otp) => {
      mut.mutate({
        supplierId,
        notes: notes || undefined,
        items: valid.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: parseFloat(l.quantity),
          unitPrice: Math.round(parseFloat(l.unitCost || '0') * 100),
          unit: l.unit || undefined,
        })),
        actionOtp: otp ?? undefined,
      });
    });
  };

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">Return Goods to Supplier</p>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            <option value="">— Select —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Reason / Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_110px_110px_110px_32px] gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
          <span>Item</span>
          <span className="text-right">Quantity</span>
          <span className="text-center">Unit</span>
          <span className="text-right">৳ / unit</span>
          <span />
        </div>
        {lines.map((line, idx) => {
          const ing = ingredients.find((i) => i.id === line.ingredientId) ?? null;
          const units = ing
            ? (ing.purchaseUnit ? [ing.purchaseUnit] : convertibleUnits(ing.unit))
            : [];
          const listId = `pos-rt-ing-${idx}`;
          const searchVal = search[idx] !== undefined ? search[idx] : (ing ? ingredientLabel(ing) : '');
          return (
            <div key={idx} className="grid grid-cols-[1fr_110px_110px_110px_32px] gap-2 items-center">
              <input
                list={listId}
                value={searchVal}
                onChange={(e) => onSearchChange(idx, e.target.value)}
                placeholder="Search ingredient or code…"
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              />
              <datalist id={listId}>
                {ingredients.map((i) => (
                  <option key={i.id} value={ingredientLabel(i)}>
                    Stock: {Number(i.currentStock).toFixed(1)} {i.unit}
                  </option>
                ))}
              </datalist>
              <input
                type="number" step="0.01" min="0" placeholder="0"
                value={line.quantity}
                onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-right"
              />
              {units.length > 1 ? (
                <select
                  value={line.unit}
                  onChange={(e) => updateLine(idx, { unit: e.target.value })}
                  className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-center"
                >
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) : (
                <div className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text-muted text-center">
                  {line.unit || '—'}
                </div>
              )}
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={line.unitCost}
                onChange={(e) => updateLine(idx, { unitCost: e.target.value })}
                className="bg-theme-bg rounded-theme px-3 py-2 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent text-right"
              />
              <button
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))}
                className="text-theme-text-muted hover:text-theme-danger w-8 h-8 flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setLines((ls) => [...ls, { ingredientId: '', quantity: '', unit: '', unitCost: '' }])}
          className="text-xs font-semibold text-theme-accent hover:underline flex items-center gap-1 mt-1"
        >
          <Plus size={12} /> Add item
        </button>
      </div>

      <div className="border-t border-theme-border mt-5 pt-3 flex items-center justify-between">
        <span className="text-sm text-theme-text-muted">Total</span>
        <span className="text-2xl font-extrabold text-theme-text">{formatCurrency(Math.round(total * 100))}</span>
      </div>

      {error && (
        <p className={`text-xs mt-2 ${error.endsWith('✓') ? 'text-theme-pop' : 'text-theme-danger'}`}>{error}</p>
      )}

      <button
        onClick={submit}
        disabled={mut.isPending}
        className="w-full mt-3 bg-theme-danger hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
      >
        {mut.isPending ? 'Recording…' : 'Record Return'}
      </button>
    </div>
  );
}

// ─── Tab: Pay Supplier ───────────────────────────────────────────────────────

function PayTab({ suppliers, guardAndRun, qc }: {
  suppliers: Supplier[];
  mode: ApprovalMode;
  guardAndRun: (a: CashierAction, s: string, r: (otp: string | null) => void) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const selected = suppliers.find((s) => s.id === supplierId);
  const due = selected ? Number(selected.totalDue ?? 0) : 0;

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/supplier/pay', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      setSupplierId(''); setAmount(''); setReference(''); setNotes('');
      setError('Payment recorded ✓');
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError('');
    const value = parseFloat(amount || '0');
    if (!supplierId) return setError('Pick a supplier');
    if (value <= 0) return setError('Enter an amount');
    const supplier = suppliers.find((s) => s.id === supplierId);
    guardAndRun('paySupplier', `Pay ${supplier?.name ?? ''} ${formatCurrency(Math.round(value * 100))} via ${paymentMethod}`, (otp) => {
      mut.mutate({
        supplierId,
        amount: Math.round(value * 100),
        paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
        actionOtp: otp ?? undefined,
      });
    });
  };

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-md">
      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-4">Pay Supplier</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); setAmount(''); }}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            <option value="">— Select —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {Number(s.totalDue ?? 0) > 0 ? `· Due ${formatCurrency(Number(s.totalDue))}` : ''}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className={`flex items-center justify-between p-3 rounded-theme ${due > 0 ? 'bg-theme-danger/10 border border-theme-danger/30' : 'bg-theme-pop/10 border border-theme-pop/30'}`}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Outstanding Due</p>
              <p className={`text-xl font-extrabold ${due > 0 ? 'text-theme-danger' : 'text-theme-pop'}`}>
                {formatCurrency(due)}
              </p>
            </div>
            {due > 0 && (
              <button
                type="button"
                onClick={() => setAmount((due / 100).toFixed(2))}
                className="text-xs font-bold text-theme-accent hover:underline"
              >
                Pay full
              </button>
            )}
          </div>
        )}

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
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            <option value="CASH">Cash</option>
            <option value="BKASH">bKash</option>
            <option value="NAGAD">Nagad</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank Transfer</option>
          </select>
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

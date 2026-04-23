import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Truck, Package, Undo2, Wallet, ClipboardList } from 'lucide-react';

import type { CashierAction, ApprovalMode, PurchaseOrder } from '@restora/types';
import { formatCurrency, formatVariantLabel, ingredientDisplayName } from '@restora/utils';
import { api } from '../lib/api';
import { useIsOnline } from '../lib/online';
import { OfflineBanner } from '../components/OfflineHint';
import { useCashierPermissions } from '../lib/permissions';
import ApprovalOtpDialog from '../components/ApprovalOtpDialog';
import VariantPickerModal from '../components/VariantPickerModal';

interface Supplier { id: string; name: string; totalDue: number }
interface Ingredient {
  id: string;
  name: string;
  itemCode: string | null;
  unit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: number;
  currentStock: number;
  minimumStock: number;
  costPerUnit: number;
  costPerPurchaseUnit: number;
  hasVariants: boolean;
  parentId: string | null;
  brandName: string | null;
  packSize: string | null;
  piecesPerPack: number | null;
  isActive: boolean;
  variants?: Ingredient[];
  supplier?: { name: string } | null;
}

type Tab = 'create-po' | 'receive' | 'returns' | 'pay' | 'history';

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

function ingredientLabel(i: Ingredient, parent?: Ingredient): string {
  // Variants use the canonical formatVariantLabel so the PO create/receive
  // lines read "Parent — Brand Pack UNIT (PU) (extended)" end-to-end.
  // parentId presence + brandName / packSize = a variant; everything else
  // is a standalone ingredient.
  const looksLikeVariant = !!i.parentId || !!i.brandName || !!i.packSize;
  if (looksLikeVariant) {
    const inferredParentName = parent?.name ?? i.name.split(' — ')[0] ?? i.name;
    return formatVariantLabel({
      parentName: inferredParentName,
      brandName: i.brandName ?? null,
      packSize: i.packSize ?? null,
      piecesPerPack: i.piecesPerPack ?? null,
      purchaseUnit: parent?.purchaseUnit ?? i.purchaseUnit ?? null,
      purchaseUnitQty: Number(parent?.purchaseUnitQty ?? i.purchaseUnitQty) || null,
      unit: parent?.unit ?? i.unit ?? null,
      id: i.id,
    });
  }
  const u = i.purchaseUnit || i.unit;
  return `${i.itemCode ? `[${i.itemCode}] ` : ''}${i.name} (${u})`;
}

/**
 * Find a single ingredient that matches the user's free-text search.
 * Accepts exact label, name, or itemCode (case-insensitive).
 */
/** Look up ingredient by ID, including inside variant children.
 *  For variants, inherits parent's purchaseUnit if variant's own is null. */
function findIngredient(list: Ingredient[], id: string): Ingredient | null {
  const top = list.find((i) => i.id === id);
  if (top) return top;
  for (const ing of list) {
    const v = ing.variants?.find((vv) => vv.id === id);
    if (v) return { ...v, purchaseUnit: v.purchaseUnit || ing.purchaseUnit };
  }
  return null;
}

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
  'history':   { label: 'History',        Icon: ClipboardList },
};

export default function PosPurchasingPage() {
  const qc = useQueryClient();
  const { data: perms } = useCashierPermissions();
  const online = useIsOnline();

  const enabledTabs = useMemo<Tab[]>(() => {
    if (!perms) return [];
    const out: Tab[] = [];
    if (perms.createPurchaseOrder.enabled  && perms.createPurchaseOrder.approval !== 'NONE')  out.push('create-po');
    if (perms.receivePurchaseOrder.enabled && perms.receivePurchaseOrder.approval !== 'NONE') out.push('receive');
    if (perms.returnPurchaseOrder.enabled  && perms.returnPurchaseOrder.approval !== 'NONE')  out.push('returns');
    if (perms.paySupplier.enabled          && perms.paySupplier.approval !== 'NONE')          out.push('pay');
    // History tab visible whenever ANY purchasing action is enabled — reading
    // POs is a pure view and doesn't need its own permission gate.
    if (out.length > 0) out.push('history');
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
    if (!online) {
      alert('This action needs internet — reconnect to use Purchasing.');
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

      {!online && (
        <div className="px-6 pt-4 shrink-0">
          <OfflineBanner message="Purchasing is disabled while offline — create, receive, return, and supplier payment all need live server checks." />
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
        {activeTab === 'history' && <PurchaseOrdersTab />}
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
  const [poVariantPicker, setPoVariantPicker] = useState<{ parent: Ingredient; idx: number } | null>(null);

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity || '0') * parseFloat(l.unitCost || '0')), 0);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onSearchChange = (idx: number, val: string) => {
    setSearch((s) => ({ ...s, [idx]: val }));
    const match = matchIngredient(ingredients, val);
    if (match) {
      if (match.hasVariants && (match as any).variants?.length > 0) {
        setPoVariantPicker({ parent: match as any, idx });
        setSearch((s) => { const next = { ...s }; delete next[idx]; return next; });
        return;
      }
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
          const ing = findIngredient(ingredients, line.ingredientId);
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

      {poVariantPicker && (
        <VariantPickerModal
          parent={poVariantPicker.parent as any}
          onSelect={(variant) => {
            const pu = poVariantPicker.parent.purchaseUnit || variant.purchaseUnit;
            const hasPU = !!pu && Number(variant.purchaseUnitQty) > 0;
            const unit = pu || variant.unit;
            const cost = hasPU && Number(variant.costPerPurchaseUnit) > 0 ? (Number(variant.costPerPurchaseUnit) / 100).toFixed(2) : (Number(variant.costPerUnit) / 100).toFixed(2);
            updateLine(poVariantPicker.idx, { ingredientId: variant.id, unit, unitCost: cost });
            setPoVariantPicker(null);
          }}
          onClose={() => setPoVariantPicker(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: Receive Goods ──────────────────────────────────────────────────────

function poUnit(ingredient?: { unit?: string; purchaseUnit?: string | null } | null, itemUnit?: string | null): string {
  return itemUnit || ingredient?.purchaseUnit || ingredient?.unit || '';
}

function ReceiveTab({ openPOs, ingredients, guardAndRun, qc }: {
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
  const [rcvVariantOverrides, setRcvVariantOverrides] = useState<Record<string, { id: string; brandName: string; packSize?: string }>>({});
  const [rcvVariantPicker, setRcvVariantPicker] = useState<{ poItemId: string; parent: Ingredient } | null>(null);
  const [rcvExtras, setRcvExtras] = useState<{ ingredientId: string; quantity: string; unitPrice: string; unit: string }[]>([]);
  const [rcvExtraSearch, setRcvExtraSearch] = useState<Record<number, string>>({});
  const [rcvExtraVariantPicker, setRcvExtraVariantPicker] = useState<{ parent: Ingredient; idx: number } | null>(null);
  const [closePartialCheck, setClosePartialCheck] = useState(false);

  const grandTotal = (po
    ? po.items.reduce((sum, item) => {
        const qty = parseFloat(receiveQtys[item.id] || '0') || 0;
        const price = parseFloat(receivePrices[item.id] || '') || (Number(item.unitCost) / 100);
        return sum + qty * price;
      }, 0)
    : 0) + rcvExtras.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0) * (parseFloat(e.unitPrice) || 0), 0);

  const mut = useMutation({
    mutationFn: (body: object) => api.post('/cashier-ops/purchase-order/receive', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchasing', 'open'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      // Refresh supplier lists so totalDue reflects the new receipt cost
      // without the cashier having to reload the page.
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      setPoId('');
      setReceiveQtys({});
      setReceivePrices({});
      setReceiveNotes('');
      setRcvExtras([]);
      setClosePartialCheck(false);
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
          ingredientIdOverride: rcvVariantOverrides[i.id]?.id || undefined,
        };
      });
    const additionalItems = rcvExtras
      .filter((e) => e.ingredientId && parseFloat(e.quantity) > 0)
      .map((e) => ({
        ingredientId: e.ingredientId,
        quantityReceived: parseFloat(e.quantity),
        unitPrice: e.unitPrice ? Math.round(parseFloat(e.unitPrice) * 100) : undefined,
        unit: e.unit || undefined,
      }));
    if (!items.length && !additionalItems.length) return setError('Enter at least one received quantity');
    guardAndRun('receivePurchaseOrder', `Receive PO #${po.id.slice(-6).toUpperCase()} · ${po.supplier?.name ?? ''}`, (otp) => {
      mut.mutate({
        purchaseOrderId: po.id,
        items,
        additionalItems: additionalItems.length > 0 ? additionalItems : undefined,
        notes: receiveNotes || undefined,
        closePartial: closePartialCheck || undefined,
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
            const override = rcvVariantOverrides[item.id];
            const origIng = findIngredient(ingredients, item.ingredientId);
            const parentIng = origIng?.parentId ? ingredients.find((i) => i.variants?.some((v) => v.id === origIng.id)) : origIng?.hasVariants ? origIng : null;
            const overrideLabel = override
              ? formatVariantLabel({
                  parentName: parentIng?.name ?? item.ingredient?.name ?? '',
                  brandName: override.brandName,
                  packSize: override.packSize ?? null,
                  purchaseUnit: parentIng?.purchaseUnit ?? null,
                  unit: parentIng?.unit ?? null,
                  id: override.id,
                })
              : ingredientDisplayName(item.ingredient);
            return (
              <div key={item.id} className="grid grid-cols-[3fr_120px_120px_110px_70px] gap-3 items-center bg-theme-bg rounded-theme p-3">
                <div>
                  <p className="text-sm font-semibold text-theme-text" title={overrideLabel}>
                    {overrideLabel}
                  </p>
                  <p className="text-[11px] text-theme-text-muted">
                    Ordered {Number(item.quantityOrdered).toFixed(3)} · Received {Number(item.quantityReceived).toFixed(3)} · Remaining {remaining.toFixed(3)}
                  </p>
                  {parentIng && parentIng.hasVariants && (parentIng.variants?.length ?? 0) > 0 && (
                    <button onClick={() => setRcvVariantPicker({ poItemId: item.id, parent: parentIng })}
                      className="text-theme-accent text-[10px] font-bold uppercase tracking-wider mt-0.5 hover:opacity-80">
                      {override ? 'Change variant' : 'Different variant?'}
                    </button>
                  )}
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

          {/* Extra items — supplier sent items not in the PO */}
          <div className="border-t border-theme-border mt-3 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-theme-accent">Extra Items (not in PO)</span>
              <button onClick={() => setRcvExtras((e) => [...e, { ingredientId: '', quantity: '', unitPrice: '', unit: '' }])}
                className="text-theme-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80">+ Add</button>
            </div>
            {rcvExtras.map((extra, idx) => {
              const sel = extra.ingredientId ? findIngredient(ingredients, extra.ingredientId) : null;
              // Unit picker only shows when the ingredient has NO purchase-unit pack
              // configured — in that case qty is in the base unit and cashier may
              // want to receive in a convertible alternative (e.g. G vs KG).
              const hasPU = !!sel?.purchaseUnit && Number(sel.purchaseUnitQty) > 0;
              const unitOptions = sel ? (hasPU ? [sel.purchaseUnit as string] : convertibleUnits(sel.unit)) : [];
              const showUnitPicker = !!sel && !hasPU && unitOptions.length > 1;
              return (
                <div key={idx} className="grid grid-cols-[3fr_90px_80px_100px_40px] gap-2 items-center mb-2">
                  <div>
                    <input
                      list={`rcv-ext-${idx}`}
                      value={rcvExtraSearch[idx] !== undefined ? rcvExtraSearch[idx] : (sel ? sel.name : '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRcvExtraSearch((s) => ({ ...s, [idx]: val }));
                        const match = matchIngredient(ingredients, val);
                        if (match) {
                          if (match.hasVariants && (match as any).variants?.length > 0) {
                            setRcvExtraVariantPicker({ parent: match as any, idx });
                            setRcvExtraSearch((s) => { const n = { ...s }; delete n[idx]; return n; });
                            return;
                          }
                          const pu = match.purchaseUnit && Number(match.purchaseUnitQty) > 0;
                          const cost = pu ? (Number(match.costPerPurchaseUnit) / 100).toFixed(2) : (Number(match.costPerUnit) / 100).toFixed(2);
                          const defaultUnit = match.purchaseUnit || match.unit;
                          setRcvExtras((l) => l.map((item, i) => i === idx ? { ...item, ingredientId: match.id, unitPrice: cost, unit: defaultUnit } : item));
                          setRcvExtraSearch((s) => { const n = { ...s }; delete n[idx]; return n; });
                        }
                      }}
                      placeholder="Search item…"
                      className="w-full bg-theme-bg rounded-theme px-2 py-2 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent"
                    />
                    <datalist id={`rcv-ext-${idx}`}>
                      {ingredients.filter((i) => { const s = (rcvExtraSearch[idx] ?? '').toLowerCase(); return !s || i.name.toLowerCase().includes(s); }).slice(0, 20).map((i) => (
                        <option key={i.id} value={ingredientLabel(i)}>{i.name}</option>
                      ))}
                    </datalist>
                  </div>
                  <input type="number" step="0.001" min="0" placeholder="Qty" value={extra.quantity}
                    onChange={(e) => setRcvExtras((l) => l.map((item, i) => i === idx ? { ...item, quantity: e.target.value } : item))}
                    className="bg-theme-bg rounded-theme px-2 py-2 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent text-right" />
                  {showUnitPicker ? (
                    <select
                      value={extra.unit || unitOptions[0]}
                      onChange={(e) => setRcvExtras((l) => l.map((item, i) => i === idx ? { ...item, unit: e.target.value } : item))}
                      className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text outline-none border border-theme-border focus:border-theme-accent text-center"
                    >
                      {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : (
                    <div className="bg-theme-bg rounded-theme px-2 py-2 text-xs font-semibold text-theme-text-muted text-center">
                      {sel ? (extra.unit || unitOptions[0] || '—') : '—'}
                    </div>
                  )}
                  <input type="number" step="0.01" min="0" placeholder="৳ Price" value={extra.unitPrice}
                    onChange={(e) => setRcvExtras((l) => l.map((item, i) => i === idx ? { ...item, unitPrice: e.target.value } : item))}
                    className="bg-theme-bg rounded-theme px-2 py-2 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent text-right" />
                  <button onClick={() => setRcvExtras((l) => l.filter((_, i) => i !== idx))} className="text-theme-danger text-sm hover:opacity-80">✕</button>
                </div>
              );
            })}
          </div>

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

          {/* Close partial — only relevant when at least one PO item is under-received */}
          {po.items.some((i) => {
            const remaining = Number(i.quantityOrdered) - Number(i.quantityReceived);
            const receivingNow = parseFloat(receiveQtys[i.id] || '0') || 0;
            return remaining - receivingNow > 0;
          }) && (
            <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={closePartialCheck}
                onChange={(e) => setClosePartialCheck(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-theme-accent"
              />
              <span className="text-xs text-theme-text">
                <span className="font-semibold">Close this order after receiving.</span>
                <span className="text-theme-text-muted"> Any un-received items stay on the PO for audit, but the status goes to Received (no more deliveries expected).</span>
              </span>
            </label>
          )}
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

      {rcvVariantPicker && (
        <VariantPickerModal
          parent={rcvVariantPicker.parent as any}
          onSelect={(variant) => {
            setRcvVariantOverrides((prev) => ({
              ...prev,
              [rcvVariantPicker.poItemId]: { id: variant.id, brandName: variant.brandName ?? variant.name, packSize: variant.packSize ?? undefined },
            }));
            setRcvVariantPicker(null);
          }}
          onClose={() => setRcvVariantPicker(null)}
        />
      )}
      {rcvExtraVariantPicker && (
        <VariantPickerModal
          parent={rcvExtraVariantPicker.parent as any}
          onSelect={(variant) => {
            const pu = rcvExtraVariantPicker.parent.purchaseUnit || variant.purchaseUnit;
            const cost = pu && Number(variant.costPerPurchaseUnit) > 0 ? (Number(variant.costPerPurchaseUnit) / 100).toFixed(2) : (Number(variant.costPerUnit) / 100).toFixed(2);
            const defaultUnit = variant.purchaseUnit || rcvExtraVariantPicker.parent.purchaseUnit || variant.unit || rcvExtraVariantPicker.parent.unit;
            setRcvExtras((l) => l.map((item, i) => i === rcvExtraVariantPicker.idx ? { ...item, ingredientId: variant.id, unitPrice: cost, unit: defaultUnit } : item));
            setRcvExtraVariantPicker(null);
          }}
          onClose={() => setRcvExtraVariantPicker(null)}
        />
      )}
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
  const [retVariantPicker, setRetVariantPicker] = useState<{ parent: Ingredient; idx: number } | null>(null);

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity || '0') * parseFloat(l.unitCost || '0')), 0);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onSearchChange = (idx: number, val: string) => {
    setSearch((s) => ({ ...s, [idx]: val }));
    const match = matchIngredient(ingredients, val);
    if (match) {
      if (match.hasVariants && (match as any).variants?.length > 0) {
        setRetVariantPicker({ parent: match as any, idx });
        setSearch((s2) => { const next = { ...s2 }; delete next[idx]; return next; });
        return;
      }
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
          const ing = findIngredient(ingredients, line.ingredientId);
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

      {retVariantPicker && (
        <VariantPickerModal
          parent={retVariantPicker.parent as any}
          onSelect={(variant) => {
            const pu = retVariantPicker.parent.purchaseUnit || variant.purchaseUnit;
            const hasPU = !!pu && Number(variant.purchaseUnitQty) > 0;
            const unit = pu || variant.unit;
            const cost = hasPU && Number(variant.costPerPurchaseUnit) > 0 ? (Number(variant.costPerPurchaseUnit) / 100).toFixed(2) : (Number(variant.costPerUnit) / 100).toFixed(2);
            updateLine(retVariantPicker.idx, { ingredientId: variant.id, unit, unitCost: cost });
            setRetVariantPicker(null);
          }}
          onClose={() => setRetVariantPicker(null)}
        />
      )}
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

// ─── Tab: PO History ─────────────────────────────────────────────────────────
// Read-only list of every purchase order this branch has created. Cashiers
// use this to look up past orders, verify received / pending status, and see
// what the supplier charged.

interface PoListItem {
  id: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  createdAt: string;
  receivedAt: string | null;
  notes: string | null;
  supplier: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  items: PoListItemLine[];
}
interface PoListItemLine {
  id: string;
  ingredientId: string;
  quantityOrdered: number | string;
  quantityReceived: number | string;
  unitCost: number | string;
  unit?: string | null;
  ingredient?: { id: string; name: string; unit: string; purchaseUnit?: string | null } | null;
}

const PO_STATUS_TONE: Record<PoListItem['status'], string> = {
  DRAFT:     'bg-theme-border text-theme-text-muted',
  SENT:      'bg-theme-info/20 text-theme-info',
  PARTIAL:   'bg-theme-warn/20 text-theme-warn',
  RECEIVED:  'bg-theme-pop/20 text-theme-pop',
  CANCELLED: 'bg-theme-danger/20 text-theme-danger',
};

const PO_STATUSES = ['ALL', 'DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const;

function PurchaseOrdersTab() {
  const [statusFilter, setStatusFilter] = useState<(typeof PO_STATUSES)[number]>('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: pos = [], isLoading } = useQuery<PoListItem[]>({
    queryKey: ['purchasing', 'history', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const qs = params.toString();
      return api.get(`/cashier-ops/purchase-orders${qs ? '?' + qs : ''}`);
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return pos;
    const q = search.toLowerCase().trim();
    return pos.filter((po) =>
      po.id.toLowerCase().includes(q) ||
      (po.supplier?.name ?? '').toLowerCase().includes(q) ||
      po.items.some((it) => (it.ingredient?.name ?? '').toLowerCase().includes(q)),
    );
  }, [pos, search]);

  return (
    <div className="bg-theme-surface rounded-theme border border-theme-border p-6 w-full max-w-5xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Purchase Orders</p>
        <div className="flex gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="bg-theme-bg rounded-theme px-3 py-2 text-xs font-semibold text-theme-text outline-none border border-transparent focus:border-theme-accent"
          >
            {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Supplier, item, PO #…"
            className="bg-theme-bg rounded-theme px-3 py-2 text-xs text-theme-text outline-none border border-transparent focus:border-theme-accent min-w-[200px]"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-theme-text-muted text-sm py-10 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-theme-text-muted text-sm py-10 text-center">No purchase orders yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((po) => {
            // unitCost is stored in paisa (smallest unit); totals stay in paisa
            // and feed straight into formatCurrency().
            const totalPaisa = po.items.reduce((s, it) => s + Number(it.quantityOrdered) * Number(it.unitCost), 0);
            return (
              <button
                key={po.id}
                onClick={() => setSelectedId(po.id)}
                className="text-left bg-theme-bg rounded-theme border border-theme-border hover:border-theme-accent transition-colors p-4 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-theme-text-muted">PO</p>
                    <p className="font-display text-xl text-theme-text">#{po.id.slice(-6).toUpperCase()}</p>
                  </div>
                  <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 ${PO_STATUS_TONE[po.status]}`}>
                    {po.status}
                  </span>
                </div>
                <p className="text-xs text-theme-text">{po.supplier?.name ?? '—'}</p>
                <p className="text-[11px] text-theme-text-muted">
                  {new Date(po.createdAt).toLocaleDateString()} · {po.items.length} item{po.items.length !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center justify-between pt-1 border-t border-theme-border mt-1">
                  <span className="text-[10px] text-theme-text-muted">Total</span>
                  <span className="font-bold text-theme-text text-sm">{formatCurrency(Math.round(totalPaisa))}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedId && <PoDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function PoDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: po, isLoading } = useQuery<PoListItem>({
    queryKey: ['purchasing', 'po', id],
    queryFn: () => api.get(`/cashier-ops/purchase-orders/${id}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-theme-surface rounded-theme border border-theme-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-accent">Purchase Order</p>
            <h2 className="font-display text-2xl tracking-wide text-theme-text">
              #{id.slice(-6).toUpperCase()}
            </h2>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4 text-sm">
          {isLoading || !po ? (
            <p className="text-theme-text-muted text-sm py-6 text-center">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-theme-text-muted items-center">
                <span>{new Date(po.createdAt).toLocaleString()}</span>
                <span>•</span>
                <span className="text-theme-text">{po.supplier?.name ?? '—'}</span>
                {po.createdBy && (<><span>•</span><span>By {po.createdBy.name}</span></>)}
                <span className={`ml-auto text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 ${PO_STATUS_TONE[po.status]}`}>
                  {po.status}
                </span>
              </div>

              <div>
                <div className="grid grid-cols-[auto_1fr_90px_90px_110px_110px] gap-3 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted pb-2 border-b border-theme-border">
                  <span>#</span>
                  <span>Item</span>
                  <span className="text-right">Ordered</span>
                  <span className="text-right">Received</span>
                  <span className="text-right">Unit ৳</span>
                  <span className="text-right">Line</span>
                </div>
                {po.items.map((it, idx) => {
                  const ordered = Number(it.quantityOrdered);
                  const received = Number(it.quantityReceived);
                  const unit = it.unit || it.ingredient?.purchaseUnit || it.ingredient?.unit || '';
                  const rcvShort = ordered > received;
                  return (
                    <div key={it.id} className="grid grid-cols-[auto_1fr_90px_90px_110px_110px] gap-3 py-2 border-b border-theme-border text-theme-text items-center">
                      <span className="text-theme-text-muted">{idx + 1}</span>
                      <div>
                        <p>{ingredientDisplayName(it.ingredient)}</p>
                        {unit && <p className="text-[11px] text-theme-text-muted">{unit}</p>}
                      </div>
                      <span className="text-right">{ordered.toFixed(3)}</span>
                      <span className={`text-right ${rcvShort ? 'text-theme-warn' : 'text-theme-pop'}`}>
                        {received.toFixed(3)}
                      </span>
                      <span className="text-right">{formatCurrency(Number(it.unitCost))}</span>
                      <span className="text-right font-semibold">
                        {formatCurrency(Math.round(ordered * Number(it.unitCost)))}
                      </span>
                      {/* Both unitCost and the product are in paisa — formatCurrency divides by 100 internally. */}
                    </div>
                  );
                })}
              </div>

              {po.notes && (
                <div className="bg-theme-bg rounded-theme p-3 border border-theme-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Notes</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{po.notes}</p>
                </div>
              )}

              <div className="border-t border-theme-border pt-3 space-y-1 text-theme-text-muted">
                <div className="flex justify-between text-theme-text font-bold text-lg">
                  <span>Total Ordered</span>
                  <span>
                    {formatCurrency(
                      Math.round(po.items.reduce((s, it) => s + Number(it.quantityOrdered) * Number(it.unitCost), 0)),
                    )}
                  </span>
                </div>
                {(po.status === 'PARTIAL' || po.status === 'RECEIVED') && (
                  <div className="flex justify-between">
                    <span>Received</span>
                    <span>
                      {formatCurrency(
                        Math.round(po.items.reduce((s, it) => s + Number(it.quantityReceived) * Number(it.unitCost), 0)),
                      )}
                    </span>
                  </div>
                )}
                {po.receivedAt && (
                  <div className="flex justify-between">
                    <span>Closed at</span>
                    <span className="text-theme-text">{new Date(po.receivedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

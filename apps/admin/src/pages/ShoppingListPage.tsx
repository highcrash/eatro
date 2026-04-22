import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Supplier, Ingredient } from '@restora/types';
import VariantPickerModal from '../components/VariantPickerModal';

interface ShoppingVariant {
  id: string;
  brandName: string | null;
  packSize: string | null;
  piecesPerPack: number | null;
  currentStock: number;
  costPerPurchaseUnit: number;
  supplierId: string | null;
  supplierName: string | null;
}

interface ShoppingItem {
  ingredientId: string;
  parentId: string | null;
  parentName: string | null;
  name: string;
  unit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: number;
  currentStock: number;
  minimumStock: number;
  deficit: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
  lastPurchaseRate: number;
  category: string;
  hasVariants: boolean;
  variants: ShoppingVariant[];
}

interface ListRow {
  ingredientId: string;
  parentId: string | null;
  name: string;
  unit: string;          // purchase unit (PACK, BOTTLE) or stock unit
  currentStock: number;  // parent aggregate
  quantity: string;
  supplierId: string;
  unitCost: string;
  hasVariants: boolean;
  variants: ShoppingVariant[];
}

export default function ShoppingListPage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [shopVariantPicker, setShopVariantPicker] = useState<Ingredient | null>(null);
  const [rowVariantPicker, setRowVariantPicker] = useState<{ idx: number; parent: Ingredient } | null>(null);

  const { data: shoppingList = [], isLoading } = useQuery<ShoppingItem[]>({
    queryKey: ['shopping-list'],
    queryFn: () => api.get('/purchasing/shopping-list'),
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    select: (d) => d.filter((s) => s.isActive),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    select: (d) => d.filter((i) => i.isActive && !i.name.startsWith('[PR]')),
  });

  // One formatter so the row label is consistent everywhere — manual
  // add, low-stock load, and variant-swap all produce the same shape:
  //   "Parent → BrandName PackSize"
  // with a graceful fallback to "Parent → variant XXXXXX" when neither
  // brandName nor packSize is set (otherwise you'd get an orphan arrow
  // and couldn't tell variants apart after a swap).
  const composeVariantLabel = (parentName: string, variant: { brandName: string | null; packSize: string | null; id: string }): string => {
    const parts = [variant.brandName, variant.packSize].map((s) => (s ?? '').trim()).filter(Boolean);
    const suffix = parts.length > 0 ? parts.join(' ') : `variant ${variant.id.slice(-6)}`;
    return `${parentName} → ${suffix}`;
  };

  const addManualItem = (ing: Ingredient, parentName?: string) => {
    if (rows.some((r) => r.ingredientId === ing.id)) return;
    const pu = ing.purchaseUnit;
    const hasPU = pu && Number(ing.purchaseUnitQty) > 0;
    setRows((prev) => [...prev, {
      ingredientId: ing.id,
      parentId: ing.parentId ?? null,
      name: parentName
        ? composeVariantLabel(parentName, { brandName: ing.brandName ?? null, packSize: ing.packSize ?? null, id: ing.id })
        : ing.name,
      unit: pu || ing.unit,
      currentStock: Number(ing.currentStock),
      quantity: '1',
      supplierId: ing.supplierId ?? '',
      unitCost: hasPU && Number(ing.costPerPurchaseUnit) > 0
        ? (Number(ing.costPerPurchaseUnit) / 100).toFixed(2)
        : (Number(ing.costPerUnit) / 100).toFixed(2),
      hasVariants: false,
      variants: [],
    }]);
    setAddSearch('');
    if (!loaded) setLoaded(true);
  };

  const loadList = () => {
    setRows(shoppingList.filter((item) => !item.name.startsWith('[PR]')).map((item) => ({
      ingredientId: item.ingredientId,
      parentId: item.parentId,
      name: item.name,
      unit: item.purchaseUnit || item.unit,
      currentStock: item.currentStock,
      quantity: item.suggestedQty.toFixed(2),
      supplierId: item.supplierId ?? '',
      unitCost: item.lastPurchaseRate > 0 ? (item.lastPurchaseRate / 100).toFixed(2) : '0',
      hasVariants: item.hasVariants,
      variants: item.variants,
    })));
    setLoaded(true);
    setSubmitted(false);
  };

  const updateRow = (idx: number, field: keyof ListRow, value: string) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };

  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));

  const changeVariant = (idx: number, variant: ShoppingVariant, parentName: string, purchaseUnit: string | null) => {
    setRows((r) => r.map((row, i) => {
      if (i !== idx) return row;
      return {
        ...row,
        ingredientId: variant.id,
        name: composeVariantLabel(parentName, { brandName: variant.brandName, packSize: variant.packSize, id: variant.id }),
        supplierId: variant.supplierId ?? row.supplierId,
        unitCost: variant.costPerPurchaseUnit > 0 ? (variant.costPerPurchaseUnit / 100).toFixed(2) : row.unitCost,
        unit: purchaseUnit || row.unit,
      };
    }));
  };

  const submitMutation = useMutation({
    mutationFn: () => {
      const validItems = rows
        .filter((r) => r.supplierId && parseFloat(r.quantity) > 0)
        .map((r) => ({
          ingredientId: r.ingredientId,
          supplierId: r.supplierId,
          quantity: parseFloat(r.quantity),
          unitCost: Math.round(parseFloat(r.unitCost || '0') * 100),
          unit: r.unit,
        }));
      return api.post('/purchasing/shopping-list/submit', { items: validItems });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setSubmitted(true);
    },
  });

  const groupedBySupplier = useMemo(() => {
    // Rows without a supplier land in an "Unassigned" bucket so they
    // still show on the printed sheet — otherwise the user walks to
    // the market missing items that never got a supplier set. The
    // unassigned group sorts last.
    const UNASSIGNED = '__unassigned__';
    const groups: Record<string, { supplierName: string; items: ListRow[]; unassigned?: boolean }> = {};
    for (const row of rows) {
      if (row.supplierId) {
        const supplier = suppliers.find((s) => s.id === row.supplierId);
        const name = supplier?.name ?? 'Unknown';
        if (!groups[row.supplierId]) groups[row.supplierId] = { supplierName: name, items: [] };
        groups[row.supplierId].items.push(row);
      } else {
        if (!groups[UNASSIGNED]) groups[UNASSIGNED] = { supplierName: 'No supplier assigned', items: [], unassigned: true };
        groups[UNASSIGNED].items.push(row);
      }
    }
    const list = Object.values(groups);
    list.sort((a, b) => (a.unassigned ? 1 : 0) - (b.unassigned ? 1 : 0));
    return list;
  }, [rows, suppliers]);

  const totalItems = rows.length;
  const totalCost = rows.reduce((s, r) => s + parseFloat(r.quantity || '0') * parseFloat(r.unitCost || '0') * 100, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">SHOPPING LIST</h1>
        <div className="flex gap-2">
          <button onClick={loadList} className="bg-[#161616] border border-[#2A2A2A] hover:bg-[#1F1F1F] text-[#666] hover:text-white font-body text-sm px-4 py-2 transition-colors">
            {loaded ? 'Refresh' : 'Generate from Low Stock'}
          </button>
          {loaded && rows.length > 0 && (
            <>
              <button onClick={() => window.print()} className="bg-[#161616] border border-[#2A2A2A] hover:bg-[#1F1F1F] text-[#666] hover:text-white font-body text-sm px-4 py-2 transition-colors">Print</button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || submitted}
                className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-50"
              >
                {submitted ? 'Submitted' : submitMutation.isPending ? 'Submitting...' : 'Submit as Draft POs'}
              </button>
            </>
          )}
        </div>
      </div>

      {!loaded && (
        <div className="bg-[#161616] border border-[#2A2A2A] p-8 text-center">
          <p className="text-[#666] font-body text-sm mb-2">
            {isLoading ? 'Checking stock levels...' : `${shoppingList.length} low-stock ingredients found.`}
          </p>
          <button onClick={loadList} disabled={isLoading} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-6 py-3 transition-colors disabled:opacity-50">
            Generate Shopping List
          </button>
        </div>
      )}

      {loaded && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#161616] border border-[#2A2A2A] p-4">
              <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Items</p>
              <p className="font-display text-white text-2xl">{totalItems}</p>
            </div>
            <div className="bg-[#161616] border border-[#2A2A2A] p-4">
              <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Estimated Cost</p>
              <p className="font-display text-white text-2xl">{formatCurrency(totalCost)}</p>
            </div>
            <div className="bg-[#161616] border border-[#2A2A2A] p-4">
              <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Suppliers</p>
              <p className="font-display text-white text-2xl">{groupedBySupplier.length}</p>
            </div>
          </div>

          {/* Editable Table */}
          <div className="bg-[#161616] border border-[#2A2A2A] no-print">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Ingredient', 'In Stock', 'Order Qty', 'Unit', 'Supplier', 'Rate', 'Total', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-2">
                      <span className="text-white font-body text-sm">{row.name}</span>
                      {row.hasVariants && row.variants.length > 0 && (
                        <button
                          onClick={() => {
                            const parent = ingredients.find((i) => i.id === row.parentId);
                            if (parent) setRowVariantPicker({ idx, parent });
                          }}
                          className="text-[#FFA726] hover:text-white font-body text-[10px] tracking-widest uppercase ml-2 transition-colors"
                        >
                          Change
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[#666] font-body text-sm">{row.currentStock.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <input type="number" step="0.01" min="0" value={row.quantity} onChange={(e) => updateRow(idx, 'quantity', e.target.value)} className="w-24 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                    </td>
                    <td className="px-4 py-2 text-[#999] font-body text-xs">{row.unit}</td>
                    <td className="px-4 py-2">
                      <select value={row.supplierId} onChange={(e) => updateRow(idx, 'supplierId', e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                        <option value="">-- Select --</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[#666] text-xs">৳</span>
                        <input type="number" step="0.01" min="0" value={row.unitCost} onChange={(e) => updateRow(idx, 'unitCost', e.target.value)} className="w-24 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                        <span className="text-[#666] text-[10px]">/{row.unit}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-[#666] font-body text-sm">{formatCurrency(parseFloat(row.quantity || '0') * parseFloat(row.unitCost || '0') * 100)}</td>
                    <td className="px-4 py-2"><button onClick={() => removeRow(idx)} className="text-[#999] hover:text-[#D62B2B] text-xs transition-colors">x</button></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[#666] font-body text-sm">No items. All stock levels are sufficient.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Add Item manually */}
          <div className="relative">
            <div className="flex items-center gap-3">
              <input
                list="shopping-add-item"
                value={addSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setAddSearch(val);
                  const match = ingredients.find((i) => `${i.name} (${i.purchaseUnit || i.unit})` === val || `${i.name} (${i.unit})` === val || (i.itemCode ?? '') === val);
                  if (match) {
                    if (match.hasVariants && match.variants && match.variants.length > 0) {
                      setShopVariantPicker(match);
                      setAddSearch('');
                      return;
                    }
                    addManualItem(match);
                  }
                }}
                onFocus={(e) => e.target.select()}
                placeholder="+ Add item to shopping list — type name or code…"
                className="flex-1 bg-[#0D0D0D] border border-dashed border-[#2A2A2A] hover:border-[#D62B2B] text-white px-4 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              />
              <datalist id="shopping-add-item">
                {ingredients.filter((i) => {
                  const s = addSearch.toLowerCase().trim();
                  return !rows.some((r) => r.ingredientId === i.id) && (!s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s));
                }).slice(0, 30).map((i) => (
                  <option key={i.id} value={`${i.name} (${i.purchaseUnit || i.unit})`}>{i.itemCode ? `[${i.itemCode}] ` : ''}{i.name} {i.hasVariants ? '[variants]' : ''} — Stock: {Number(i.currentStock).toFixed(1)}</option>
                ))}
              </datalist>
            </div>
          </div>

          {/* Print View (A4, grouped by supplier) */}
          <div className="shopping-list-print-area hidden print:block">
            <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '12px', color: '#000', padding: '20px' }}>
              <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '28px', letterSpacing: '3px', marginBottom: '4px' }}>SHOPPING LIST</h1>
              <p style={{ color: '#666', fontSize: '11px', marginBottom: '20px' }}>{new Date().toLocaleDateString()} — {totalItems} items — Est. {formatCurrency(totalCost)}</p>
              {groupedBySupplier.map((group, gIdx) => (
                <div key={gIdx} style={{ marginBottom: '24px', pageBreakInside: 'avoid' }}>
                  <h2 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '18px', letterSpacing: '2px', borderBottom: `2px solid ${group.unassigned ? '#b45309' : '#000'}`, color: group.unassigned ? '#b45309' : '#000', paddingBottom: '4px', marginBottom: '8px' }}>
                    {group.supplierName}
                    {group.unassigned && <span style={{ fontSize: '10px', letterSpacing: '1px', marginLeft: '8px', color: '#b45309' }}>— assign a supplier before ordering</span>}
                  </h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Item', 'Unit', 'Qty', 'Rate', 'Total'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #ccc', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#666' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, iIdx) => (
                        <tr key={iIdx}>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{item.name}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{item.unit}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{parseFloat(item.quantity).toFixed(2)}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>৳{parseFloat(item.unitCost || '0').toFixed(2)}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>৳{(parseFloat(item.quantity || '0') * parseFloat(item.unitCost || '0')).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>

          {submitMutation.error && <p className="text-[#D62B2B] text-xs font-body">{(submitMutation.error as Error).message}</p>}
          {submitted && <p className="text-green-700 font-body text-sm">Draft purchase orders created! Go to Purchasing to review and send.</p>}
        </>
      )}

      {/* Variant picker for manual add */}
      {shopVariantPicker && (
        <VariantPickerModal
          parent={shopVariantPicker}
          onSelect={(variant) => {
            addManualItem(variant as Ingredient, shopVariantPicker.name);
            setShopVariantPicker(null);
          }}
          onClose={() => setShopVariantPicker(null)}
        />
      )}

      {/* Variant picker for changing variant in a row */}
      {rowVariantPicker && (
        <VariantPickerModal
          parent={rowVariantPicker.parent}
          onSelect={(variant) => {
            const parent = rowVariantPicker.parent;
            changeVariant(rowVariantPicker.idx, {
              id: variant.id,
              brandName: variant.brandName,
              packSize: variant.packSize,
              piecesPerPack: variant.piecesPerPack,
              currentStock: Number(variant.currentStock),
              costPerPurchaseUnit: Number(variant.costPerPurchaseUnit),
              supplierId: variant.supplierId ?? null,
              supplierName: variant.supplier?.name ?? null,
            }, parent.name, parent.purchaseUnit ?? null);
            setRowVariantPicker(null);
          }}
          onClose={() => setRowVariantPicker(null)}
        />
      )}
    </div>
  );
}

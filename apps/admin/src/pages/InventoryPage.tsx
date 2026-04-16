import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Ingredient, Supplier, StockMovement, StockUnit, IngredientCategory } from '@restora/types';
import VariantDialog from '../components/VariantDialog';

// Variant rows reference their parent via parent_code (matches an earlier
// row's code OR an already-imported ingredient's item code). Variants
// inherit unit + purchase_unit from the parent — those columns are ignored
// on variant rows.
const INV_CSV_EXAMPLE = `name,code,category,unit,minimum_stock,cost_per_unit,purchase_unit,purchase_unit_qty,cost_per_purchase_unit,parent_code,brand_name,pack_size,pieces_per_pack,sku
Chicken Breast,MEA0030,RAW,KG,5,450,,,,,,,,
Olive Oil,OIL0010,RAW,L,2,800,,,,,,,,
Salt,SPI0026,SPICE,G,500,5,,,,,,,,
Cola,BEV0010,BEVERAGE,ML,500,0.15,BOTTLE,500,75,,,,,
Cola Coca-Cola 500ml,,,,,0.15,,,75,BEV0010,Coca-Cola 500ml,500ml,500,CC500
Cola Pepsi 500ml,,,,,0.14,,,70,BEV0010,Pepsi 500ml,500ml,500,PP500`;

function downloadInventoryCSV() {
  const blob = new Blob([INV_CSV_EXAMPLE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inventory-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const UNITS: StockUnit[] = ['KG', 'G', 'L', 'ML', 'PCS', 'DOZEN', 'BOX'];
const CATEGORIES: IngredientCategory[] = ['RAW', 'CLEANING', 'PACKAGED', 'SPICE', 'DAIRY', 'BEVERAGE', 'OTHER'];

// ─── Stock Report Tab Component ──────────────────────────────────────────────

interface StockReportData {
  totalValue: number;
  totalItems: number;
  lowStockCount: number;
  items: { id: string; name: string; itemCode: string | null; category: string; unit: string; currentStock: number; minimumStock: number; costPerUnit: number; stockValue: number; isLow: boolean }[];
}

interface DailyConsumptionData {
  date: string;
  items: { ingredientId: string; name: string; unit: string; costPerUnit: number; consumed: number; received: number; wasted: number; consumedValue: number; wastedValue: number }[];
  totalConsumedValue: number;
  totalWastedValue: number;
  totalMovements: number;
}

function StockReportTab() {
  const today = new Date().toISOString().split('T')[0];
  const [reportDate, setReportDate] = useState(today);

  const { data: stockReport, isLoading: stockLoading } = useQuery<StockReportData>({
    queryKey: ['stock-report'],
    queryFn: () => api.get('/reports/stock'),
  });

  const { data: dailyReport, isLoading: dailyLoading } = useQuery<DailyConsumptionData>({
    queryKey: ['daily-consumption', reportDate],
    queryFn: () => api.get(`/reports/stock/daily?date=${reportDate}`),
  });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Total Stock Value</p>
          <p className="font-display text-white text-3xl">{formatCurrency(stockReport?.totalValue ?? 0)}</p>
          <p className="text-[#666] font-body text-xs mt-1">{stockReport?.totalItems ?? 0} items</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Low Stock Items</p>
          <p className={`font-display text-3xl ${(stockReport?.lowStockCount ?? 0) > 0 ? 'text-[#D62B2B]' : 'text-[#4CAF50]'}`}>
            {stockReport?.lowStockCount ?? 0}
          </p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Today Consumed</p>
          <p className="font-display text-[#D62B2B] text-3xl">{formatCurrency(dailyReport?.totalConsumedValue ?? 0)}</p>
          <p className="text-[#666] font-body text-xs mt-1">{dailyReport?.items.filter((i) => i.consumed > 0).length ?? 0} items</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Today Wasted</p>
          <p className="font-display text-[#EF5350] text-3xl">{formatCurrency(dailyReport?.totalWastedValue ?? 0)}</p>
        </div>
      </div>

      {/* Daily Consumption Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl text-white tracking-widest">DAILY CONSUMPTION</h2>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
          />
        </div>
        {dailyLoading ? <p className="text-[#666] font-body text-sm">Loading…</p> : (
          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Item', 'Unit', 'Consumed', 'Wasted', 'Received', 'Consumed Value', 'Wasted Value'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(dailyReport?.items ?? []).filter((i) => i.consumed > 0 || i.wasted > 0 || i.received > 0).map((item) => (
                  <tr key={item.ingredientId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-white font-body text-sm">{item.name}</td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">{item.unit}</td>
                    <td className="px-4 py-3 text-[#D62B2B] font-body text-sm font-medium">{item.consumed > 0 ? `-${item.consumed.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-[#EF5350] font-body text-sm">{item.wasted > 0 ? `-${item.wasted.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-[#4CAF50] font-body text-sm">{item.received > 0 ? `+${item.received.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-[#D62B2B] font-body text-sm">{item.consumedValue > 0 ? formatCurrency(item.consumedValue) : '—'}</td>
                    <td className="px-4 py-3 text-[#EF5350] font-body text-sm">{item.wastedValue > 0 ? formatCurrency(item.wastedValue) : '—'}</td>
                  </tr>
                ))}
                {(dailyReport?.items ?? []).filter((i) => i.consumed > 0 || i.wasted > 0 || i.received > 0).length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No stock movements for this date.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Current Stock Valuation */}
      <div>
        <h2 className="font-display text-xl text-white tracking-widest mb-3">CURRENT STOCK VALUATION</h2>
        {stockLoading ? <p className="text-[#666] font-body text-sm">Loading…</p> : (
          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Item', 'Code', 'Category', 'Unit', 'Stock', 'Cost/Unit', 'Value'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stockReport?.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-2 text-white font-body text-sm">
                      {item.name}
                      {item.isLow && <span className="ml-2 text-[10px] text-[#D62B2B] font-body">▼ LOW</span>}
                    </td>
                    <td className="px-4 py-2 text-[#666] font-mono text-xs">{item.itemCode ?? '—'}</td>
                    <td className="px-4 py-2 text-[#999] font-body text-xs uppercase">{item.category}</td>
                    <td className="px-4 py-2 text-[#999] font-body text-xs">{item.unit}</td>
                    <td className={`px-4 py-2 font-body text-sm ${item.isLow ? 'text-[#D62B2B]' : 'text-white'}`}>
                      {item.currentStock.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-[#999] font-body text-sm">৳{(item.costPerUnit / 100).toFixed(2)}</td>
                    <td className="px-4 py-2 text-white font-body text-sm font-medium">{formatCurrency(item.stockValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#2A2A2A]">
                  <td colSpan={6} className="px-4 py-3 text-white font-display text-lg tracking-widest">TOTAL VALUATION</td>
                  <td className="px-4 py-3 text-white font-display text-lg">{formatCurrency(stockReport?.totalValue ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface IngredientForm {
  name: string;
  unit: StockUnit;
  minimumStock: string;
  costPerUnit: string;
  supplierId: string;
  supplierIds: string[];
  itemCode: string;
  category: IngredientCategory;
  purchaseUnit: string;
  purchaseUnitQty: string;
  costPerPurchaseUnit: string;
  showOnWebsite: boolean;
  ingredientImageUrl: string;
}

const emptyIngForm: IngredientForm = { name: '', unit: 'G', minimumStock: '0', costPerUnit: '0', supplierId: '', supplierIds: [], itemCode: '', category: 'RAW', purchaseUnit: '', purchaseUnitQty: '1', costPerPurchaseUnit: '0', showOnWebsite: true, ingredientImageUrl: '' };

interface AdjustForm {
  quantity: string;
  type: 'PURCHASE' | 'ADJUSTMENT' | 'WASTE';
  notes: string;
}

export default function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ingredients' | 'movements' | 'report'>('ingredients');
  const [showIngDialog, setShowIngDialog] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [ingForm, setIngForm] = useState<IngredientForm>(emptyIngForm);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({ quantity: '0', type: 'ADJUSTMENT', notes: '' });
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStock, setFilterStock] = useState('');
  const [showCSVUpload, setShowCSVUpload] = useState(false);
  const [csvResult, setCsvResult] = useState<{ total: number; created: number; updated?: number; skipped: number; results: { name: string; status: string; reason?: string }[] } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  const [variantDialog, setVariantDialog] = useState<{ parent: Ingredient; variant?: Ingredient } | null>(null);

  const { data: ingredients = [], isLoading } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
  });

  const searchLower = searchText.trim().toLowerCase();
  const filteredIngredients = ingredients.filter((ing) => {
    if (searchLower && !ing.name.toLowerCase().includes(searchLower) && !(ing.itemCode ?? '').toLowerCase().includes(searchLower)) return false;
    if (filterCategory && ing.category !== filterCategory) return false;
    if (filterSupplier) {
      const hasSupplier = ing.suppliers?.some((s) => s.supplierId === filterSupplier) || ing.supplierId === filterSupplier;
      if (!hasSupplier) return false;
    }
    if (filterStock === 'low' && Number(ing.currentStock) > Number(ing.minimumStock)) return false;
    if (filterStock === 'out' && Number(ing.currentStock) > 0) return false;
    return true;
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
  });

  const { data: movements = [], isLoading: movLoading } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements'],
    queryFn: () => api.get('/ingredients/movements'),
    enabled: tab === 'movements',
  });

  const saveIngMutation = useMutation({
    mutationFn: async (data: IngredientForm) => {
      const payload = {
        name: data.name,
        unit: data.unit,
        minimumStock: parseFloat(data.minimumStock) || 0,
        costPerUnit: Math.round((parseFloat(data.costPerUnit) || 0) * 100),
        supplierId: data.supplierId || undefined,
        itemCode: data.itemCode || undefined,
        category: data.category,
        purchaseUnit: data.purchaseUnit || undefined,
        purchaseUnitQty: parseFloat(data.purchaseUnitQty) || 1,
        costPerPurchaseUnit: Math.round((parseFloat(data.costPerPurchaseUnit) || 0) * 100),
        showOnWebsite: data.showOnWebsite,
        imageUrl: data.ingredientImageUrl || null,
      };
      const result = editingIng
        ? await api.patch<{ id: string }>(`/ingredients/${editingIng.id}`, payload)
        : await api.post<{ id: string }>('/ingredients', payload);
      // Set multiple suppliers
      if (data.supplierIds.length > 0) {
        await api.put(`/ingredients/${(result as any).id}/suppliers`, { supplierIds: data.supplierIds });
      }
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      closeIngDialog();
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (data: AdjustForm) =>
      api.post(`/ingredients/${adjusting!.id}/adjust`, {
        quantity: parseFloat(data.quantity),
        type: data.type,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['stock-movements'] });
      setAdjusting(null);
    },
  });

  const [deleteError, setDeleteError] = useState('');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ingredients/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      setDeleteError('');
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const convertToParentMut = useMutation({
    mutationFn: (id: string) => api.patch(`/ingredients/${id}/convert-to-parent`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });

  const bulkMutation = useMutation({
    mutationFn: (items: {
      name: string; unit?: string; category?: string; itemCode?: string;
      minimumStock?: number; costPerUnit?: number;
      purchaseUnit?: string; purchaseUnitQty?: number; costPerPurchaseUnit?: number;
      parentCode?: string; brandName?: string; packSize?: string; piecesPerPack?: number; sku?: string;
    }[]) =>
      api.post<{ total: number; created: number; updated?: number; skipped: number; results: { name: string; status: string; reason?: string }[] }>('/ingredients/bulk', { items }),
    onSuccess: (data) => {
      setCsvResult(data);
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
    },
  });

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.trim().split('\n').map((r) => r.split(',').map((c) => c.trim()));
      if (rows.length < 2) return;

      const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
      const nameIdx = header.findIndex((h) => h === 'name');
      const codeIdx = header.findIndex((h) => h === 'code' || h === 'item_code');
      const catIdx = header.findIndex((h) => h.includes('category') || h === 'cat');
      const unitIdx = header.findIndex((h) => h === 'unit');
      const minIdx = header.findIndex((h) => h.includes('min'));
      const costIdx = header.findIndex((h) => h === 'cost_per_unit');
      const puIdx = header.findIndex((h) => h === 'purchase_unit');
      const puQtyIdx = header.findIndex((h) => h === 'purchase_unit_qty');
      const puCostIdx = header.findIndex((h) => h === 'cost_per_purchase_unit');
      // Variant columns — all optional; presence of parent_code turns the
      // row into a variant of the parent with that code.
      const parentCodeIdx = header.findIndex((h) => h === 'parent_code');
      const brandIdx = header.findIndex((h) => h === 'brand_name' || h === 'brand');
      const packSizeIdx = header.findIndex((h) => h === 'pack_size');
      const ppIdx = header.findIndex((h) => h === 'pieces_per_pack');
      const skuIdx = header.findIndex((h) => h === 'sku');

      if (nameIdx === -1) { alert('CSV must have a "name" column'); return; }

      const items = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[nameIdx]?.trim()) continue;
        const pu = puIdx >= 0 ? row[puIdx]?.trim().toUpperCase() || undefined : undefined;
        const puQty = puQtyIdx >= 0 && row[puQtyIdx]?.trim() ? parseFloat(row[puQtyIdx]) || undefined : undefined;
        const puCost = puCostIdx >= 0 && row[puCostIdx]?.trim() ? Math.round(parseFloat(row[puCostIdx]) * 100) : undefined;
        const parentCode = parentCodeIdx >= 0 ? row[parentCodeIdx]?.trim() || undefined : undefined;
        items.push({
          name: row[nameIdx].trim(),
          itemCode: codeIdx >= 0 ? row[codeIdx]?.trim() || undefined : undefined,
          category: catIdx >= 0 ? row[catIdx]?.trim().toUpperCase() || undefined : undefined,
          unit: unitIdx >= 0 ? row[unitIdx]?.trim().toUpperCase() || undefined : undefined,
          minimumStock: minIdx >= 0 && row[minIdx]?.trim() ? parseFloat(row[minIdx]) || 0 : 0,
          costPerUnit: costIdx >= 0 && row[costIdx]?.trim() ? Math.round((parseFloat(row[costIdx]) || 0) * 100) : 0,
          purchaseUnit: pu,
          purchaseUnitQty: puQty,
          costPerPurchaseUnit: puCost,
          parentCode,
          brandName: brandIdx >= 0 ? row[brandIdx]?.trim() || undefined : undefined,
          packSize: packSizeIdx >= 0 ? row[packSizeIdx]?.trim() || undefined : undefined,
          piecesPerPack: ppIdx >= 0 && row[ppIdx]?.trim() ? parseFloat(row[ppIdx]) || undefined : undefined,
          sku: skuIdx >= 0 ? row[skuIdx]?.trim() || undefined : undefined,
        });
      }

      if (items.length === 0) { alert('No valid rows found in CSV'); return; }
      bulkMutation.mutate(items);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export current inventory in the same shape the upload template uses.
  // Parents and variants both emit their row; variants reference the parent
  // via parent_code. Parents without an itemCode still round-trip (we simply
  // omit their variants — users who want variants round-tripped should
  // assign the parent an item code first).
  const downloadCurrentInventory = () => {
    const esc = (v: string | number | null | undefined) => {
      const s = (v ?? '').toString();
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = 'name,code,category,unit,minimum_stock,cost_per_unit,purchase_unit,purchase_unit_qty,cost_per_purchase_unit,parent_code,brand_name,pack_size,pieces_per_pack,sku';

    // ingredients list contains only roots; variants live under each root.
    const rows: string[] = [];
    for (const ing of ingredients) {
      rows.push([
        esc(ing.name),
        esc(ing.itemCode),
        esc(ing.category),
        esc(ing.unit),
        esc(Number(ing.minimumStock ?? 0)),
        esc((Number(ing.costPerUnit ?? 0) / 100).toFixed(4)),
        esc(ing.purchaseUnit),
        esc(Number(ing.purchaseUnitQty ?? 1)),
        esc((Number(ing.costPerPurchaseUnit ?? 0) / 100).toFixed(2)),
        '', // parent_code
        '', // brand_name
        '', // pack_size
        '', // pieces_per_pack
        '', // sku
      ].join(','));

      if (ing.hasVariants && ing.variants?.length) {
        // parent_code is what links variant rows to their parent on
        // re-import. Prefer itemCode (stable identifier). Fall back to
        // the parent's name so round-tripping works even when the
        // owner never assigned item codes — the import side resolves
        // parent_code against BOTH itemCode and name (case-insensitive).
        const parentRef = ing.itemCode || ing.name;
        for (const v of ing.variants) {
          rows.push([
            esc((v as any).name ?? ''),
            '', // code — variants don't carry itemCode in the template
            '', // category inherited
            '', // unit inherited
            '', // minimum_stock (parent-level)
            esc((Number((v as any).costPerUnit ?? 0) / 100).toFixed(4)),
            '', // purchase_unit inherited
            '', // purchase_unit_qty
            esc((Number((v as any).costPerPurchaseUnit ?? 0) / 100).toFixed(2)),
            esc(parentRef),
            esc((v as any).brandName ?? ''),
            esc((v as any).packSize ?? ''),
            esc(Number((v as any).piecesPerPack ?? 0) || ''),
            esc((v as any).sku ?? ''),
          ].join(','));
        }
      }
    }

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openAddIng = () => { setEditingIng(null); setIngForm(emptyIngForm); setShowIngDialog(true); };
  const openEditIng = (ing: Ingredient) => {
    setEditingIng(ing);
    const sids = ing.suppliers?.map((s) => s.supplierId) ?? (ing.supplierId ? [ing.supplierId] : []);
    setIngForm({
      name: ing.name,
      unit: ing.unit,
      minimumStock: String(ing.minimumStock),
      costPerUnit: String(Number(ing.costPerUnit) / 100),
      supplierId: ing.supplierId ?? '',
      supplierIds: sids,
      itemCode: ing.itemCode ?? '',
      category: ing.category ?? 'RAW',
      purchaseUnit: ing.purchaseUnit ?? '',
      purchaseUnitQty: String(ing.purchaseUnitQty ?? 1),
      costPerPurchaseUnit: String(Number(ing.costPerPurchaseUnit ?? 0) / 100),
      showOnWebsite: (ing as any).showOnWebsite ?? true,
      ingredientImageUrl: (ing as any).imageUrl ?? '',
    });
    setShowIngDialog(true);
  };
  const closeIngDialog = () => { setShowIngDialog(false); setEditingIng(null); };

  const openAdjust = (ing: Ingredient) => {
    setAdjusting(ing);
    setAdjustForm({ quantity: '0', type: 'ADJUSTMENT', notes: '' });
  };

  const movTypeColor: Record<string, string> = {
    PURCHASE: 'text-[#4CAF50]',
    SALE: 'text-[#D62B2B]',
    VOID_RETURN: 'text-[#FFA726]',
    ADJUSTMENT: 'text-[#29B6F6]',
    WASTE: 'text-[#EF5350]',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">INVENTORY</h1>
        {tab === 'ingredients' && (
          <div className="flex gap-2">
            <div className="relative">
              <button onClick={() => setShowCSVUpload(!showCSVUpload)} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999] hover:text-white font-body text-sm px-4 py-2 transition-colors">
                CSV Import ▾
              </button>
              {showCSVUpload && (
                <div className="absolute top-full right-0 mt-1 z-20 bg-[#161616] border border-[#2A2A2A] w-52 shadow-lg">
                  <button
                    onClick={() => { setShowCSVUpload(false); csvFileRef.current?.click(); }}
                    className="w-full text-left px-3 py-2.5 text-sm font-body text-[#999] hover:bg-[#1F1F1F] hover:text-white transition-colors border-b border-[#2A2A2A]"
                  >
                    Upload CSV
                    <span className="block text-[10px] text-[#666] mt-0.5">Re-uploading updates existing items</span>
                  </button>
                  <button
                    onClick={() => { setShowCSVUpload(false); downloadCurrentInventory(); }}
                    className="w-full text-left px-3 py-2 text-xs font-body text-[#666] hover:bg-[#1F1F1F] hover:text-[#999] transition-colors border-b border-[#2A2A2A]"
                  >
                    ↓ Export current inventory
                  </button>
                  <button
                    onClick={() => { setShowCSVUpload(false); downloadInventoryCSV(); }}
                    className="w-full text-left px-3 py-2 text-xs font-body text-[#666] hover:bg-[#1F1F1F] hover:text-[#999] transition-colors"
                  >
                    ↓ Download CSV template
                  </button>
                </div>
              )}
            </div>
            <input ref={csvFileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
            <button onClick={openAddIng} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
              + ADD INGREDIENT
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#2A2A2A]">
        {(['ingredients', 'movements', 'report'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 font-body text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'
            }`}
          >
            {t === 'report' ? 'Stock Report' : t}
          </button>
        ))}
      </div>

      {/* Ingredients Tab */}
      {tab === 'ingredients' && (
        isLoading ? <p className="text-[#666] font-body text-sm">Loading…</p> : (
          <>
          {/* CSV Import Result */}
          {csvResult && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-4">
                  <span className="text-[#4CAF50] font-body text-sm font-medium">{csvResult.created} created</span>
                  {csvResult.updated != null && csvResult.updated > 0 && (
                    <span className="text-[#C8FF00] font-body text-sm font-medium">{csvResult.updated} updated</span>
                  )}
                  <span className="text-[#FFA726] font-body text-sm">{csvResult.skipped} skipped</span>
                  <span className="text-[#666] font-body text-sm">of {csvResult.total} total</span>
                </div>
                <button onClick={() => setCsvResult(null)} className="text-[#666] hover:text-white font-body text-xs transition-colors">Dismiss</button>
              </div>
              {csvResult.results.filter((r) => r.status === 'skipped').length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  {csvResult.results.filter((r) => r.status === 'skipped').map((r, i) => (
                    <p key={i} className="text-[#FFA726] font-body text-xs">
                      {r.name}: <span className="text-[#666]">{r.reason}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Search + Filters */}
          <div className="flex gap-3 items-end">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Search</label>
              <input
                type="text" placeholder="Search by name or code…"
                value={searchText} onChange={(e) => setSearchText(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category</label>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                <option value="">All Categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Supplier</label>
              <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                <option value="">All Suppliers</option>
                {suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Stock</label>
              <select value={filterStock} onChange={(e) => setFilterStock(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                <option value="">All</option>
                <option value="low">Low Stock</option>
                <option value="out">Out of Stock</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[#666] font-body text-xs">{filteredIngredients.length} of {ingredients.length} items</p>
            {deleteError && (
              <div className="flex items-center gap-2">
                <p className="text-[#D62B2B] font-body text-xs">{deleteError}</p>
                <button onClick={() => setDeleteError('')} className="text-[#666] hover:text-white text-xs">✕</button>
              </div>
            )}
          </div>

          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Ingredient', 'Code', 'Category', 'Unit', 'Stock', 'Min', 'Cost/Unit', 'Supplier', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredIngredients.map((ing) => {
                  const isLow = Number(ing.currentStock) <= Number(ing.minimumStock);
                  const hasVars = ing.hasVariants && (ing.variants?.length ?? 0) > 0;
                  const isExpanded = expandedParent === ing.id;
                  return (
                    <React.Fragment key={ing.id}>
                    <tr className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                      <td className="px-4 py-3 text-white font-body text-sm">
                        <div className="flex items-center gap-2">
                          {ing.hasVariants && (
                            <button onClick={() => setExpandedParent(isExpanded ? null : ing.id)} className="text-[#666] text-xs">
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          )}
                          {ing.name}
                          {ing.hasVariants && <span className="text-[#FFA726] font-mono text-[10px] bg-[#FFA726]/10 px-1.5 py-0.5">{ing.variants?.length ?? 0} variants</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#666] font-mono text-xs">{ing.itemCode ?? '—'}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">{ing.category}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-sm">{ing.unit}</td>
                      <td className="px-4 py-3">
                        <span className={`font-body text-sm font-medium ${isLow ? 'text-[#D62B2B]' : 'text-white'}`}>
                          {Number(ing.currentStock).toFixed(2)}
                          {isLow && <span className="ml-1 text-xs text-[#D62B2B]">▼ LOW</span>}
                          {ing.hasVariants && <span className="ml-1 text-[#666] text-[10px]">(agg)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#999] font-body text-sm">{Number(ing.minimumStock).toFixed(2)}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-sm">৳{(Number(ing.costPerUnit) / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-xs">
                        {ing.suppliers && ing.suppliers.length > 0
                          ? ing.suppliers.map((s) => s.supplier.name).join(', ')
                          : ing.supplier?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 flex gap-2 flex-wrap">
                        {!ing.hasVariants && (
                          <button onClick={() => openAdjust(ing)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Adjust</button>
                        )}
                        <button onClick={() => openEditIng(ing)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                        {!ing.hasVariants && !ing.parentId && (
                          <button onClick={() => { if (confirm(`Convert "${ing.name}" to a parent with variants?`)) convertToParentMut.mutate(ing.id); }} className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Variants</button>
                        )}
                        {ing.isActive && Number(ing.currentStock) === 0 && !hasVars && (
                          <button onClick={() => { setDeleteError(''); if (confirm(`Delete "${ing.name}"? This cannot be undone.`)) deleteMutation.mutate(ing.id); }} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* Variant sub-rows */}
                    {isExpanded && ing.variants?.map((v) => {
                      return (
                        <tr key={v.id} className="border-b border-[#2A2A2A] bg-[#0D0D0D]">
                          <td className="pl-12 pr-4 py-2 font-body text-sm">
                            <span className="text-[#FFA726]">{v.brandName}</span>
                            {v.packSize && <span className="text-[#666] ml-1">{v.packSize}</span>}
                            {v.piecesPerPack && <span className="text-[#666] ml-1">({v.piecesPerPack} {ing.unit}/{ing.purchaseUnit || 'PACK'})</span>}
                          </td>
                          <td className="px-4 py-2 text-[#666] font-mono text-xs">{v.sku ?? '—'}</td>
                          <td className="px-4 py-2 text-[#999] font-body text-xs">{ing.purchaseUnit ?? '—'}</td>
                          <td className="px-4 py-2 text-[#999] font-body text-sm">{v.unit}</td>
                          <td className="px-4 py-2">
                            <span className="font-body text-sm font-medium text-white">
                              {Number(v.currentStock).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-[#555] font-body text-sm">—</td>
                          <td className="px-4 py-2 text-[#999] font-body text-sm">৳{(Number(v.costPerUnit) / 100).toFixed(2)}</td>
                          <td className="px-4 py-2 text-[#999] font-body text-xs">
                            {v.suppliers && v.suppliers.length > 0 ? v.suppliers.map((s) => s.supplier.name).join(', ') : v.supplier?.name ?? '—'}
                          </td>
                          <td className="px-4 py-2 flex gap-2">
                            <button onClick={() => openAdjust(v as Ingredient)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Adjust</button>
                            <button onClick={() => setVariantDialog({ parent: ing, variant: v as Ingredient })} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                    {isExpanded && (
                      <tr className="border-b border-[#2A2A2A] bg-[#0D0D0D]">
                        <td colSpan={9} className="px-12 py-2">
                          <button onClick={() => setVariantDialog({ parent: ing })}
                            className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">
                            + Add Variant
                          </button>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
                {filteredIngredients.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666] font-body text-sm">No ingredients match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        )
      )}

      {/* Movements Tab */}
      {tab === 'movements' && (
        movLoading ? <p className="text-[#666] font-body text-sm">Loading…</p> : (
          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Date', 'Ingredient', 'Type', 'Qty', 'Notes'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(m.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-white font-body text-sm">{m.ingredient?.name ?? m.ingredientId}</td>
                    <td className="px-4 py-3">
                      <span className={`font-body text-xs tracking-widest uppercase ${movTypeColor[m.type] ?? 'text-white'}`}>{m.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-body text-sm font-medium ${Number(m.quantity) >= 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>
                        {Number(m.quantity) >= 0 ? '+' : ''}{Number(m.quantity).toFixed(4)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#666] font-body text-xs">{m.notes ?? '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[#666] font-body text-sm">No movements yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Stock Report Tab */}
      {tab === 'report' && <StockReportTab />}

      {/* Add/Edit Ingredient Dialog */}
      {showIngDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeIngDialog}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">
              {editingIng ? 'EDIT INGREDIENT' : 'ADD INGREDIENT'}
            </h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Name *</label>
                <input
                  value={ingForm.name}
                  onChange={(e) => setIngForm((f) => ({ ...f, name: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Item Code</label>
                  <input
                    value={ingForm.itemCode}
                    onChange={(e) => setIngForm((f) => ({ ...f, itemCode: e.target.value }))}
                    placeholder="e.g. RAW-001"
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body font-mono focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Category</label>
                  <select
                    value={ingForm.category}
                    onChange={(e) => setIngForm((f) => ({ ...f, category: e.target.value as IngredientCategory }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Unit *</label>
                <select
                  value={ingForm.unit}
                  onChange={(e) => setIngForm((f) => ({ ...f, unit: e.target.value as StockUnit }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Min Stock</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={ingForm.minimumStock}
                    onChange={(e) => setIngForm((f) => ({ ...f, minimumStock: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Cost/Unit (৳)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={ingForm.costPerUnit}
                    onChange={(e) => setIngForm((f) => ({ ...f, costPerUnit: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              </div>
              {/* Purchase Unit — how supplier sells this item */}
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-3">
                <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase">Purchase Unit (Supplier's selling unit)</p>
                <p className="text-[#666] font-body text-[10px]">
                  If the supplier sells in a different unit than stock (e.g., PACK, BOTTLE, BOX), set it here.
                  Leave empty if supplier sells in the same unit as stock.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Purchase Unit</label>
                    <input
                      value={ingForm.purchaseUnit}
                      onChange={(e) => setIngForm((f) => ({ ...f, purchaseUnit: e.target.value.toUpperCase() }))}
                      placeholder="e.g. PACK, BOTTLE, BOX"
                      className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">1 {ingForm.purchaseUnit || 'PACK'} = ? {ingForm.unit}</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={ingForm.purchaseUnitQty}
                      onChange={(e) => setIngForm((f) => ({ ...f, purchaseUnitQty: e.target.value }))}
                      placeholder="e.g. 200"
                      className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Cost per {ingForm.purchaseUnit || 'PACK'} (৳)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={ingForm.costPerPurchaseUnit}
                      onChange={(e) => setIngForm((f) => ({ ...f, costPerPurchaseUnit: e.target.value }))}
                      placeholder="e.g. 20"
                      className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                  </div>
                </div>
                {ingForm.purchaseUnit && parseFloat(ingForm.purchaseUnitQty) > 0 && (
                  <p className="text-[#999] font-body text-[10px]">
                    1 {ingForm.purchaseUnit} = {ingForm.purchaseUnitQty} {ingForm.unit}
                    {parseFloat(ingForm.costPerPurchaseUnit) > 0 && ` | ৳${ingForm.costPerPurchaseUnit}/${ingForm.purchaseUnit} = ৳${(parseFloat(ingForm.costPerPurchaseUnit) / parseFloat(ingForm.purchaseUnitQty)).toFixed(2)}/${ingForm.unit}`}
                  </p>
                )}
              </div>

              {/* Website Display */}
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-3">
                <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase">Website Display</p>
                <label className="flex items-center gap-2 text-sm font-body text-[#999]">
                  <input type="checkbox" checked={ingForm.showOnWebsite ?? true}
                    onChange={(e) => setIngForm((f) => ({ ...f, showOnWebsite: e.target.checked }))} className="accent-[#D62B2B]" />
                  Show ingredient name on website menu pages
                </label>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Ingredient Image (square, for website)</label>
                  {ingForm.ingredientImageUrl && (
                    <div className="flex items-center gap-2 mb-1">
                      <img src={ingForm.ingredientImageUrl} alt="" className="w-12 h-12 object-cover border border-[#2A2A2A]" />
                      <button onClick={() => setIngForm((f) => ({ ...f, ingredientImageUrl: '' }))} className="text-[#D62B2B] text-xs">Remove</button>
                    </div>
                  )}
                  <input type="file" accept="image/*" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { resizeImage: resize } = await import('../lib/image-resize');
                      const resized = await resize(file, 'ingredient');
                      const result = await api.upload<{ url: string }>('/upload/image', resized);
                      setIngForm((f) => ({ ...f, ingredientImageUrl: result.url }));
                    } catch { /* */ }
                  }} className="text-[#666] text-xs" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
                  Suppliers ({ingForm.supplierIds.length} selected)
                </label>
                <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-2 max-h-32 overflow-y-auto space-y-1">
                  {suppliers.filter((s) => s.isActive).map((s) => {
                    const checked = ingForm.supplierIds.includes(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-2 px-1 py-0.5 hover:bg-[#1F1F1F] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setIngForm((f) => ({
                              ...f,
                              supplierIds: checked
                                ? f.supplierIds.filter((id) => id !== s.id)
                                : [...f.supplierIds, s.id],
                              supplierId: checked
                                ? (f.supplierIds.filter((id) => id !== s.id)[0] ?? '')
                                : (f.supplierIds.length === 0 ? s.id : f.supplierId),
                            }));
                          }}
                          className="accent-[#D62B2B]"
                        />
                        <span className="text-white font-body text-sm">{s.name}</span>
                        <span className="text-[#666] font-body text-xs ml-auto">{s.category}</span>
                      </label>
                    );
                  })}
                  {suppliers.filter((s) => s.isActive).length === 0 && (
                    <p className="text-[#666] text-xs font-body text-center py-2">No suppliers</p>
                  )}
                </div>
              </div>
            </div>
            {saveIngMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(saveIngMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={closeIngDialog} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => saveIngMutation.mutate(ingForm)}
                disabled={!ingForm.name || saveIngMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {saveIngMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Stock Dialog */}
      {adjusting && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setAdjusting(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-1">ADJUST STOCK</h2>
            <p className="text-[#999] font-body text-sm mb-6">{adjusting.name} — Current: {Number(adjusting.currentStock).toFixed(2)} {adjusting.unit}</p>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Type</label>
                <select
                  value={adjustForm.type}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, type: e.target.value as AdjustForm['type'] }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  <option value="PURCHASE">Purchase (add stock)</option>
                  <option value="ADJUSTMENT">Adjustment (±)</option>
                  <option value="WASTE">Waste (remove)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
                  Quantity ({adjustForm.type === 'PURCHASE' ? '+' : adjustForm.type === 'WASTE' ? '−' : '±'}) in {adjusting.unit}
                </label>
                <input
                  type="number" step="0.01"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
                <p className="text-[#666] text-xs font-body">Use negative for ADJUSTMENT to reduce stock.</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={adjustForm.notes}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            {adjustMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(adjustMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setAdjusting(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => adjustMutation.mutate(adjustForm)}
                disabled={adjustForm.quantity === '0' || adjustMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {adjustMutation.isPending ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant Add/Edit Dialog */}
      {variantDialog && (
        <VariantDialog
          parent={variantDialog.parent}
          variant={variantDialog.variant}
          onClose={() => setVariantDialog(null)}
        />
      )}
    </div>
  );
}

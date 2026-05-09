import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatVariantLabel, formatCurrency } from '@restora/utils';
import type { WasteReason, Ingredient, MenuItem } from '@restora/types';
import VariantPickerModal from '../components/VariantPickerModal';

interface WasteLogRow {
  id: string;
  ingredientId: string;
  ingredient: { id: string; name: string; unit: string };
  quantity: number;
  unitCostPaisa: number;
  valuePaisa: number;
  isApprox: boolean;
  reason: WasteReason;
  notes: string | null;
  recordedBy: { id: string; name: string } | null;
  createdAt: string;
}

interface WasteResponse {
  rows: WasteLogRow[];
  summary: {
    rowCount: number;
    totalQty: number;
    totalValuePaisa: number;
    byIngredient: Array<{ ingredientId: string; ingredientName: string; unit: string; qty: number; valuePaisa: number }>;
    byReason: Array<{ reason: string; rowCount: number; qty: number; valuePaisa: number }>;
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthAgoIso = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: 'SPOILAGE', label: 'Spoilage' },
  { value: 'PREPARATION_ERROR', label: 'Preparation Error' },
  { value: 'OVERCOOKED', label: 'Overcooked' },
  { value: 'CONTAMINATION', label: 'Contamination' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'OTHER', label: 'Other' },
];

const REASON_COLORS: Record<WasteReason, string> = {
  SPOILAGE: 'text-[#FFA726]',
  PREPARATION_ERROR: 'text-[#29B6F6]',
  OVERCOOKED: 'text-[#EF5350]',
  CONTAMINATION: 'text-[#D62B2B]',
  EXPIRED: 'text-[#CE93D8]',
  OTHER: 'text-[#666]',
};

export default function WastePage() {
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [showMenuWasteDialog, setShowMenuWasteDialog] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [form, setForm] = useState({ ingredientId: '', quantity: '0', reason: 'SPOILAGE' as WasteReason, notes: '' });
  const [wasteIngSearch, setWasteIngSearch] = useState<string | undefined>(undefined);
  const [menuWasteForm, setMenuWasteForm] = useState({ menuItemId: '', quantity: '1', reason: 'PREPARATION_ERROR' as WasteReason, notes: '' });

  // Date range — defaults to last 30 days. Server widens its row-cap
  // (200 → 1000) when from/to are present so a range scan can return
  // the full window without paging.
  const [from, setFrom] = useState<string>(monthAgoIso());
  const [to, setTo] = useState<string>(todayIso());

  const { data, isLoading } = useQuery<WasteResponse>({
    queryKey: ['waste-logs', from, to],
    queryFn: () => api.get<WasteResponse>(`/waste?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  });
  const wasteRows = data?.rows ?? [];
  const summary = data?.summary ?? { rowCount: 0, totalQty: 0, totalValuePaisa: 0, byIngredient: [], byReason: [] };

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    select: (d) => d.filter((i) => i.isActive),
  });

  const [variantPicker, setVariantPicker] = useState<Ingredient | null>(null);
  const [variantLabel, setVariantLabel] = useState<string | undefined>(undefined);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/waste', {
        ingredientId: form.ingredientId,
        quantity: parseFloat(form.quantity),
        reason: form.reason,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['waste-logs'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['stock-movements'] });
      setShowDialog(false);
      setForm({ ingredientId: '', quantity: '0', reason: 'SPOILAGE', notes: '' });
      setWasteIngSearch(undefined);
    },
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu-items'],
    queryFn: () => api.get('/menu'),
    select: (d) => d.filter((m) => m.isAvailable),
  });

  const menuWasteMutation = useMutation({
    mutationFn: () =>
      api.post('/waste/menu', {
        menuItemId: menuWasteForm.menuItemId,
        quantity: parseFloat(menuWasteForm.quantity),
        reason: menuWasteForm.reason,
        notes: menuWasteForm.notes || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['waste-logs'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['stock-movements'] });
      setShowMenuWasteDialog(false);
      setMenuWasteForm({ menuItemId: '', quantity: '1', reason: 'PREPARATION_ERROR', notes: '' });
      setMenuSearch('');
    },
  });

  const filteredMenuItems = useMemo(() => {
    if (!menuSearch.trim()) return menuItems;
    const q = menuSearch.toLowerCase();
    return menuItems.filter((m) => m.name.toLowerCase().includes(q));
  }, [menuItems, menuSearch]);

  const filteredWasteLogs = useMemo(() => {
    if (!searchFilter.trim()) return wasteRows;
    const q = searchFilter.toLowerCase();
    return wasteRows.filter((log) => (log.ingredient?.name ?? '').toLowerCase().includes(q));
  }, [wasteRows, searchFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">WASTE LOG</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowMenuWasteDialog(true)} className="bg-[#161616] border border-[#2A2A2A] hover:border-[#D62B2B] text-white font-body text-sm px-4 py-2 transition-colors">
            + LOG MENU WASTE
          </button>
          <button onClick={() => setShowDialog(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
            + LOG WASTE
          </button>
        </div>
      </div>

      {/* Filters: date range + ingredient search */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">Search</label>
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search by ingredient name…"
            className="w-full max-w-sm bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors placeholder:text-[#666]"
          />
        </div>
      </div>

      {/* Headline tiles — qty + value totals over the chosen range. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#161616] border border-[#2A2A2A] px-5 py-4">
          <p className="text-[10px] uppercase tracking-widest text-[#888]">Total Waste Entries</p>
          <p className="font-display text-2xl text-white mt-1">{summary.rowCount}</p>
          <p className="text-[11px] text-[#888] mt-1">{from} → {to}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] px-5 py-4">
          <p className="text-[10px] uppercase tracking-widest text-[#888]">Total Wasted Quantity</p>
          <p className="font-display text-2xl text-[#D62B2B] mt-1">
            {summary.byIngredient.length === 1
              ? `${summary.totalQty.toFixed(3)} ${summary.byIngredient[0].unit}`
              : `${summary.totalQty.toFixed(3)} (mixed units)`}
          </p>
          <p className="text-[11px] text-[#888] mt-1">{summary.byIngredient.length} distinct ingredient{summary.byIngredient.length === 1 ? '' : 's'}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] px-5 py-4">
          <p className="text-[10px] uppercase tracking-widest text-[#888]">Total Wasted Value</p>
          <p className="font-display text-2xl text-[#FFA726] mt-1">{formatCurrency(summary.totalValuePaisa)}</p>
          <p className="text-[11px] text-[#888] mt-1">qty × cost-at-time-of-waste</p>
        </div>
      </div>

      {/* By-ingredient breakdown — clicking an ingredient name pre-
          fills the search box so admin can drill in. */}
      {summary.byIngredient.length > 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[#999] font-body text-xs tracking-widest uppercase mb-3">Breakdown by Ingredient</p>
          <div className="flex flex-wrap gap-2">
            {summary.byIngredient.map((s) => (
              <button
                key={s.ingredientId}
                onClick={() => setSearchFilter(s.ingredientName)}
                className="bg-[#0D0D0D] border border-[#2A2A2A] hover:border-[#444] px-3 py-2 text-left transition-colors"
              >
                <p className="text-white font-body text-sm">{s.ingredientName}</p>
                <p className="text-[#D62B2B] font-display text-base">{s.qty.toFixed(3)} {s.unit}</p>
                <p className="text-[#FFA726] text-[11px]">{formatCurrency(s.valuePaisa)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* By-reason breakdown so admin can spot patterns ("60% of the
          waste this month was Spoilage — let's check the walk-in"). */}
      {summary.byReason.length > 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[#999] font-body text-xs tracking-widest uppercase mb-3">Breakdown by Reason</p>
          <div className="flex flex-wrap gap-2">
            {summary.byReason.map((s) => (
              <div key={s.reason} className="bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2">
                <p className={`font-body text-xs tracking-widest uppercase ${REASON_COLORS[s.reason as WasteReason] ?? 'text-[#999]'}`}>
                  {s.reason.replace('_', ' ')}
                </p>
                <p className="text-white font-display text-base">{s.rowCount} entr{s.rowCount === 1 ? 'y' : 'ies'}</p>
                <p className="text-[#FFA726] text-[11px]">{formatCurrency(s.valuePaisa)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log table */}
      {isLoading ? <p className="text-[#999] font-body text-sm">Loading…</p> : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Date', 'Ingredient', 'Quantity', 'Unit Cost', 'Value', 'Reason', 'Notes', 'Logged By'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredWasteLogs.map((log) => (
                <tr key={log.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#0D0D0D]">
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-white font-body text-sm">{log.ingredient?.name ?? log.ingredientId}</td>
                  <td className="px-4 py-3 text-[#D62B2B] font-body text-sm">−{Number(log.quantity).toFixed(3)} {log.ingredient?.unit}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">
                    {formatCurrency(log.unitCostPaisa)}/{log.ingredient?.unit}
                    {log.isApprox && <span className="text-[#888] text-[10px] ml-1">(approx.)</span>}
                  </td>
                  <td className="px-4 py-3 text-[#FFA726] font-body text-sm">{formatCurrency(log.valuePaisa)}</td>
                  <td className="px-4 py-3">
                    <span className={`font-body text-xs tracking-widest uppercase ${REASON_COLORS[log.reason]}`}>{log.reason.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{log.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{log.recordedBy?.name ?? '—'}</td>
                </tr>
              ))}
              {filteredWasteLogs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#999] font-body text-sm">{searchFilter ? 'No matching waste logs.' : 'No waste logs in this date range.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Menu Waste Dialog */}
      {showMenuWasteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowMenuWasteDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">LOG MENU WASTE</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Menu Item *</label>
                <input
                  type="text"
                  value={menuSearch}
                  onChange={(e) => { setMenuSearch(e.target.value); setMenuWasteForm((f) => ({ ...f, menuItemId: '' })); }}
                  placeholder="Search menu items..."
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors placeholder:text-[#666]"
                />
                {menuSearch.trim() && !menuWasteForm.menuItemId && (
                  <div className="max-h-40 overflow-y-auto border border-[#2A2A2A] bg-[#111]">
                    {filteredMenuItems.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setMenuWasteForm((f) => ({ ...f, menuItemId: m.id })); setMenuSearch(m.name); }}
                        className="w-full text-left px-3 py-2 text-sm font-body text-white hover:bg-[#2A2A2A] transition-colors"
                      >
                        {m.name}
                      </button>
                    ))}
                    {filteredMenuItems.length === 0 && (
                      <p className="px-3 py-2 text-sm font-body text-[#666]">No items found</p>
                    )}
                  </div>
                )}
                {menuWasteForm.menuItemId && (
                  <p className="text-xs font-body text-[#4CAF50]">Selected: {menuSearch}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Quantity *</label>
                <input
                  type="number" step="1" min="1"
                  value={menuWasteForm.quantity}
                  onChange={(e) => setMenuWasteForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Reason *</label>
                <select
                  value={menuWasteForm.reason}
                  onChange={(e) => setMenuWasteForm((f) => ({ ...f, reason: e.target.value as WasteReason }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {WASTE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={menuWasteForm.notes}
                  onChange={(e) => setMenuWasteForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            {menuWasteMutation.error && (
              <p className="text-[#D62B2B] text-xs font-body mt-3">{(menuWasteMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowMenuWasteDialog(false)} className="flex-1 bg-[#F2F1EE] hover:bg-[#DDD9D3] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => menuWasteMutation.mutate()}
                disabled={!menuWasteForm.menuItemId || parseFloat(menuWasteForm.quantity) <= 0 || menuWasteMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {menuWasteMutation.isPending ? 'Logging...' : 'Log Menu Waste'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">LOG WASTE</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Ingredient *</label>
                <input
                  list="waste-ing-list"
                  value={wasteIngSearch !== undefined ? wasteIngSearch : (variantLabel ?? (() => {
                    const sel = ingredients.find((i) => i.id === form.ingredientId);
                    return sel ? `${sel.name} (${sel.unit})` : '';
                  })())}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWasteIngSearch(val);
                    const match = ingredients.find((i) => `${i.name} (${i.unit})` === val || (i.itemCode ?? '') === val);
                    if (match) {
                      if (match.hasVariants && match.variants && match.variants.length > 0) {
                        setVariantPicker(match);
                        setWasteIngSearch(undefined);
                        return;
                      }
                      setForm((f) => ({ ...f, ingredientId: match.id }));
                      setVariantLabel(undefined);
                      setWasteIngSearch(undefined);
                    }
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="Type ingredient name or code…"
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors placeholder:text-[#666]"
                />
                <datalist id="waste-ing-list">
                  {ingredients.filter((i) => {
                    const s = (wasteIngSearch ?? '').toLowerCase().trim();
                    return !s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s);
                  }).slice(0, 30).map((i) => (
                    <option key={i.id} value={`${i.name} (${i.unit})`}>
                      {i.hasVariants ? `[${i.variants?.length ?? 0} variants] ` : ''}Stock: {Number(i.currentStock).toFixed(2)} {i.unit}
                    </option>
                  ))}
                </datalist>
                {form.ingredientId && (() => {
                  const sel = ingredients.find((i) => i.id === form.ingredientId);
                  return sel ? <p className="text-[#666] font-body text-[10px] mt-1">Stock: {Number(sel.currentStock).toFixed(2)} {sel.unit}</p> : null;
                })()}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Quantity *</label>
                <input
                  type="number" step="0.001" min="0"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Reason *</label>
                <select
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as WasteReason }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  {WASTE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            {createMutation.error && (
              <p className="text-[#D62B2B] text-xs font-body mt-3">{(createMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowDialog(false)} className="flex-1 bg-[#F2F1EE] hover:bg-[#DDD9D3] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!form.ingredientId || parseFloat(form.quantity) <= 0 || createMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Logging…' : 'Log Waste'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant Picker */}
      {variantPicker && (
        <VariantPickerModal
          parent={variantPicker}
          onSelect={(variant) => {
            setForm((f) => ({ ...f, ingredientId: variant.id }));
            setVariantLabel(formatVariantLabel({
              parentName: variantPicker.name,
              brandName: variant.brandName,
              packSize: variant.packSize,
              piecesPerPack: variant.piecesPerPack ?? null,
              purchaseUnit: variantPicker.purchaseUnit ?? variant.purchaseUnit ?? null,
              purchaseUnitQty: Number(variant.purchaseUnitQty) || null,
              unit: variantPicker.unit ?? variant.unit ?? null,
              id: variant.id,
            }));
            setVariantPicker(null);
          }}
          onClose={() => setVariantPicker(null)}
        />
      )}
    </div>
  );
}

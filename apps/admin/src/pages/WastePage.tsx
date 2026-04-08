import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { WasteLog, WasteReason, Ingredient, MenuItem } from '@restora/types';

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

  const { data: wasteLogs = [], isLoading } = useQuery<WasteLog[]>({
    queryKey: ['waste-logs'],
    queryFn: () => api.get('/waste'),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    select: (d) => d.filter((i) => i.isActive),
  });

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

  // Summary: total waste by ingredient
  const wasteSummary = wasteLogs.reduce<Record<string, { name: string; unit: string; totalQty: number }>>((acc, log) => {
    const key = log.ingredientId;
    if (!acc[key]) acc[key] = { name: log.ingredient?.name ?? key, unit: log.ingredient?.unit ?? '', totalQty: 0 };
    acc[key].totalQty += Number(log.quantity);
    return acc;
  }, {});

  const filteredWasteLogs = useMemo(() => {
    if (!searchFilter.trim()) return wasteLogs;
    const q = searchFilter.toLowerCase();
    return wasteLogs.filter((log) => (log.ingredient?.name ?? '').toLowerCase().includes(q));
  }, [wasteLogs, searchFilter]);

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

      {/* Search bar */}
      <div>
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Search by ingredient name..."
          className="w-full max-w-sm bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors placeholder:text-[#666]"
        />
      </div>

      {/* Summary */}
      {Object.keys(wasteSummary).length > 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[#999] font-body text-xs tracking-widest uppercase mb-3">Waste Summary (All Time)</p>
          <div className="flex flex-wrap gap-4">
            {Object.values(wasteSummary).sort((a, b) => b.totalQty - a.totalQty).map((s) => (
              <div key={s.name} className="bg-[#0D0D0D] border border-[#2A2A2A] px-4 py-2">
                <p className="text-white font-body text-sm">{s.name}</p>
                <p className="text-[#D62B2B] font-display text-lg">{s.totalQty.toFixed(3)} {s.unit}</p>
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
                {['Date', 'Ingredient', 'Quantity', 'Reason', 'Notes', 'Logged By'].map((h) => (
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
                  <td className="px-4 py-3">
                    <span className={`font-body text-xs tracking-widest uppercase ${REASON_COLORS[log.reason]}`}>{log.reason.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{log.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{log.recordedBy?.name ?? '—'}</td>
                </tr>
              ))}
              {filteredWasteLogs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[#999] font-body text-sm">{searchFilter ? 'No matching waste logs.' : 'No waste logs yet.'}</td></tr>
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
                  value={wasteIngSearch !== undefined ? wasteIngSearch : (ingredients.find((i) => i.id === form.ingredientId) ? `${ingredients.find((i) => i.id === form.ingredientId)!.name} (${ingredients.find((i) => i.id === form.ingredientId)!.unit})` : '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWasteIngSearch(val);
                    const match = ingredients.find((i) => `${i.name} (${i.unit})` === val || (i.itemCode ?? '') === val);
                    if (match) {
                      setForm((f) => ({ ...f, ingredientId: match.id }));
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
                    <option key={i.id} value={`${i.name} (${i.unit})`}>Stock: {Number(i.currentStock).toFixed(2)} {i.unit}</option>
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
    </div>
  );
}

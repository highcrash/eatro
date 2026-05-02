import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, X, Save } from 'lucide-react';

import type { MenuCategory } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

type CustomItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  costPrice: number;
  category: { id: string; name: string } | null;
  createdAt: string;
  recipe: {
    id: string;
    items: Array<{
      ingredientId: string;
      ingredientName: string;
      stockUnit: string;
      costPerStockUnit: number;
      quantity: number;
      unit: string;
    }>;
  } | null;
  soldQuantity: number;
  soldRevenue: number;
  lastSoldAt: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function marginPct(price: number, cost: number): string {
  if (price <= 0) return '—';
  return `${(((price - cost) / price) * 100).toFixed(1)}%`;
}

export default function CustomMenuPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promoteFor, setPromoteFor] = useState<CustomItem | null>(null);
  const [search, setSearch] = useState('');

  const { data: items = [], isLoading } = useQuery<CustomItem[]>({
    queryKey: ['custom-menu-items'],
    queryFn: () => api.get('/menu/custom-items'),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((i) =>
      i.name.toLowerCase().includes(q) ||
      (i.description ?? '').toLowerCase().includes(q) ||
      (i.recipe?.items ?? []).some((r) => r.ingredientName.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const totalRevenue = items.reduce((s, i) => s + i.soldRevenue, 0);
  const totalSold = items.reduce((s, i) => s + i.soldQuantity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Audit</p>
          <h1 className="font-display text-4xl text-white tracking-wide">CUSTOM MENU</h1>
          <p className="text-[#999] text-xs font-body mt-1">
            Ad-hoc dishes built from POS Custom Order. Promote re-usable ones to the regular menu.
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or ingredient..."
          className="border border-[#2A2A2A] bg-[#0D0D0D] text-white px-3 py-2 text-sm font-body placeholder:text-[#555] focus:outline-none focus:border-[#D62B2B] w-64 transition-colors"
        />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Custom items recorded" value={items.length.toString()} />
        <SummaryTile label="Times sold (lifetime)" value={totalSold.toString()} />
        <SummaryTile label="Lifetime revenue" value={formatCurrency(totalRevenue)} />
      </div>

      {/* Table */}
      <div className="border border-[#2A2A2A] bg-[#0D0D0D]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-[#2A2A2A] text-[10px] tracking-widest uppercase text-[#666]">
              <th className="text-left px-4 py-3 font-medium">Item</th>
              <th className="text-right px-4 py-3 font-medium">Price</th>
              <th className="text-right px-4 py-3 font-medium">Cost</th>
              <th className="text-right px-4 py-3 font-medium">Margin</th>
              <th className="text-right px-4 py-3 font-medium">Sold</th>
              <th className="text-right px-4 py-3 font-medium">Revenue</th>
              <th className="text-left  px-4 py-3 font-medium">Last sold</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[#666]">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[#666]">
                No custom items yet. They appear here when a cashier builds a one-off dish from POS Custom Order.
              </td></tr>
            )}
            {filtered.map((it) => {
              const expanded = expandedId === it.id;
              return (
                <FragmentRow
                  key={it.id}
                  item={it}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : it.id)}
                  onPromote={() => setPromoteFor(it)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {promoteFor && (
        <PromoteDialog
          item={promoteFor}
          onClose={() => setPromoteFor(null)}
          onDone={() => {
            setPromoteFor(null);
            void qc.invalidateQueries({ queryKey: ['custom-menu-items'] });
            void qc.invalidateQueries({ queryKey: ['menu'] });
          }}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#2A2A2A] bg-[#0D0D0D] px-4 py-3">
      <p className="text-[10px] font-body tracking-widest uppercase text-[#666]">{label}</p>
      <p className="text-2xl font-display text-white mt-1">{value}</p>
    </div>
  );
}

function FragmentRow({
  item, expanded, onToggle, onPromote,
}: {
  item: CustomItem;
  expanded: boolean;
  onToggle: () => void;
  onPromote: () => void;
}) {
  return (
    <>
      <tr className="border-b border-[#1A1A1A] hover:bg-[#161616] transition-colors">
        <td className="px-4 py-3">
          <button onClick={onToggle} className="text-left w-full">
            <p className="text-white font-medium">{item.name}</p>
            <p className="text-[#666] text-xs">
              {item.recipe?.items.length ?? 0} ingredient{item.recipe?.items.length === 1 ? '' : 's'} • created {fmtDate(item.createdAt)}
            </p>
          </button>
        </td>
        <td className="px-4 py-3 text-right text-white">{formatCurrency(item.price)}</td>
        <td className="px-4 py-3 text-right text-[#999]">{formatCurrency(item.costPrice)}</td>
        <td className="px-4 py-3 text-right text-[#DDD9D3]">{marginPct(item.price, item.costPrice)}</td>
        <td className="px-4 py-3 text-right text-white">{item.soldQuantity}</td>
        <td className="px-4 py-3 text-right text-white">{formatCurrency(item.soldRevenue)}</td>
        <td className="px-4 py-3 text-[#999]">{fmtDate(item.lastSoldAt)}</td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={onPromote}
            className="inline-flex items-center gap-1.5 bg-[#D62B2B] text-white px-3 py-1.5 text-xs font-body font-medium hover:bg-[#F03535] transition-colors"
            title="Add this to the regular menu so cashiers can re-order it"
          >
            <ChefHat size={12} /> Save to Menu
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#0A0A0A] border-b border-[#2A2A2A]">
          <td colSpan={8} className="px-4 py-4">
            <p className="text-[10px] font-body tracking-widest uppercase text-[#666] mb-2">Recipe</p>
            {item.recipe && item.recipe.items.length > 0 ? (
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-[#555]">
                    <th className="text-left  py-1 font-medium">Ingredient</th>
                    <th className="text-right py-1 font-medium">Qty per serving</th>
                    <th className="text-right py-1 font-medium">Stock unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {item.recipe.items.map((r) => (
                    <tr key={r.ingredientId} className="border-t border-[#1A1A1A]">
                      <td className="py-1.5 text-white">{r.ingredientName}</td>
                      <td className="py-1.5 text-right text-[#DDD9D3]">{r.quantity} {r.unit}</td>
                      <td className="py-1.5 text-right text-[#999]">{formatCurrency(r.costPerStockUnit)} / {r.stockUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[#666] text-xs">No recipe attached.</p>
            )}
            {item.description && (
              <p className="text-[#999] text-xs mt-3"><span className="text-[#666]">Notes:</span> {item.description}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PromoteDialog({
  item, onClose, onDone,
}: {
  item: CustomItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: categories = [] } = useQuery<MenuCategory[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/menu/categories'),
  });

  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState<string>(item.category?.id ?? '');
  const [websiteVisible, setWebsiteVisible] = useState(true);
  const [error, setError] = useState('');

  // Build a flat picker that prefixes sub-categories with their parent
  // name so the admin can tell "Mains › Wraps" from "Sides › Wraps" at
  // a glance, mirroring the bulk-move dropdown elsewhere.
  const flatCats = useMemo(() => {
    const top = categories.filter((c) => !c.parentId);
    const out: Array<{ id: string; label: string }> = [];
    for (const t of top) {
      out.push({ id: t.id, label: t.name });
      for (const sub of t.children ?? []) {
        out.push({ id: sub.id, label: `${t.name} › ${sub.name}` });
      }
    }
    return out;
  }, [categories]);

  const promote = useMutation({
    mutationFn: () => api.post(`/menu/${item.id}/promote`, {
      name: name.trim() || undefined,
      categoryId: categoryId || undefined,
      websiteVisible,
    }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2A2A]">
          <h2 className="font-display text-xl text-white tracking-wide">SAVE TO MENU</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-[#999]">
            Adds <span className="text-white font-medium">{item.name}</span> to the regular menu.
            Recipe and price are kept; cashiers can re-order it from the standard picker.
          </p>

          <div>
            <label className="text-[10px] font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-[#2A2A2A] bg-[#0D0D0D] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B]"
            />
          </div>

          <div>
            <label className="text-[10px] font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border border-[#2A2A2A] bg-[#0D0D0D] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B]"
            >
              <option value="">— Keep current ({item.category?.name ?? 'Custom Orders'}) —</option>
              {flatCats.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-[#666] mt-1">
              Default keeps the auto "Custom Orders" category. Pick a real category to surface it on the website.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={websiteVisible}
              onChange={(e) => setWebsiteVisible(e.target.checked)}
              className="accent-[#D62B2B]"
            />
            Show on website / QR menu
          </label>

          {error && <p className="text-xs text-[#D62B2B]">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="border border-[#2A2A2A] text-[#999] px-4 py-2 text-xs font-body tracking-widest uppercase hover:border-[#555]"
            >
              Cancel
            </button>
            <button
              onClick={() => promote.mutate()}
              disabled={promote.isPending}
              className="inline-flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-xs font-body font-medium tracking-widest uppercase hover:bg-[#F03535] disabled:opacity-40"
            >
              <Save size={12} /> {promote.isPending ? 'Saving…' : 'Save to Menu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

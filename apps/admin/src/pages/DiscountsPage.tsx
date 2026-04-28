import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Search, ChevronRight } from 'lucide-react';
import type { MenuItem, MenuCategory } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface Discount {
  id: string; name: string; type: string; value: number; scope: string; targetItems: string | null; isActive: boolean;
}
interface Coupon {
  id: string; code: string; name: string; type: string; value: number; scope: string; targetItems: string | null;
  maxUses: number; usedCount: number; expiresAt: string | null; isActive: boolean;
}
interface MenuItemDiscount {
  id: string; menuItemId: string; type: string; value: number; startDate: string; endDate: string;
  applicableDays: string | null; isActive: boolean; menuItem?: { id: string; name: string; price: number };
}

const SCOPE_LABELS: Record<string, string> = { ALL_ITEMS: 'All Items', SPECIFIC_ITEMS: 'Specific Items', ALL_EXCEPT: 'All Except' };
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// ─── Item Selector ───────────────────────────────────────────────────────────
// Category-grouped checkbox tree. Each category row carries a tri-state
// checkbox: empty (no items selected), filled (all items selected), or
// indeterminate (some items selected). Toggling the parent toggles every
// item *currently visible* under it (so a search-filtered category only
// flips the matching items, not the hidden ones — admin doesn't get
// surprised by off-screen selections changing).
function CategoryCheckbox({ state, onChange, label, count }: {
  state: 'none' | 'some' | 'all';
  onChange: (next: 'all' | 'none') => void;
  label: string;
  count: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 bg-[#161616] hover:bg-[#1F1F1F] cursor-pointer text-xs font-body text-white">
      <input
        ref={ref}
        type="checkbox"
        checked={state === 'all'}
        onChange={(e) => onChange(e.target.checked ? 'all' : 'none')}
      />
      <ChevronRight size={11} className="text-[#666]" />
      <span className="font-medium tracking-wide uppercase">{label}</span>
      <span className="text-[#555] ml-auto">{count}</span>
    </label>
  );
}

function ItemSelector({ menuItems, categories, selected, onChange }: {
  menuItems: MenuItem[];
  categories: MenuCategory[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  // Group items by their direct categoryId, but show each top-level
  // category as a section that includes items from every sub-category
  // under it (so admin doesn't have to tick "Drinks → Cold" + "Drinks
  // → Hot" separately when "Drinks" is the conceptual group).
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const rootIdFor = (catId: string): string => {
    const seen = new Set<string>();
    let cur = categoryById.get(catId);
    while (cur && cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const next = categoryById.get(cur.parentId);
      if (!next) break;
      cur = next;
    }
    return cur?.id ?? catId;
  };

  // groups: rootCategoryId → MenuItem[], plus a synthetic "uncategorised"
  // bucket for items whose categoryId doesn't resolve.
  const groups = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      const root = rootIdFor(item.categoryId);
      const arr = m.get(root) ?? [];
      arr.push(item);
      m.set(root, arr);
    }
    // Sort groups by category sortOrder + name; sort items alphabetically.
    const sorted: Array<{ id: string; name: string; items: MenuItem[] }> = [];
    for (const [id, items] of m.entries()) {
      const cat = categoryById.get(id);
      sorted.push({ id, name: cat?.name ?? 'Uncategorised', items: [...items].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return sorted.sort((a, b) => {
      const av = categoryById.get(a.id)?.sortOrder ?? 999;
      const bv = categoryById.get(b.id)?.sortOrder ?? 999;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name);
    });
  }, [menuItems, categoryById]);

  // Apply search filter inside each group; drop empty groups so the
  // tree collapses naturally as the user types.
  const visibleGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((m) => m.name.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0 || g.name.toLowerCase().includes(q));
  }, [groups, q]);

  // Track which groups are user-collapsed. Default: all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selSet = useMemo(() => new Set(selected), [selected]);
  const toggleItem = (id: string, on: boolean) => {
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  };

  // Bulk toggle every visible (search-filtered) item under a group.
  const toggleGroup = (groupItems: MenuItem[], next: 'all' | 'none') => {
    const groupIds = groupItems.map((i) => i.id);
    if (next === 'all') {
      const merged = new Set(selected);
      for (const id of groupIds) merged.add(id);
      onChange(Array.from(merged));
    } else {
      const groupSet = new Set(groupIds);
      onChange(selected.filter((id) => !groupSet.has(id)));
    }
  };

  // Top-level "Select all visible" — handy after a search narrows the list.
  const totalVisible = visibleGroups.reduce((s, g) => s + g.items.length, 0);
  const visibleSelected = visibleGroups.reduce(
    (s, g) => s + g.items.filter((i) => selSet.has(i.id)).length,
    0,
  );
  const allState: 'none' | 'some' | 'all' =
    visibleSelected === 0 ? 'none' : visibleSelected === totalVisible ? 'all' : 'some';
  const toggleAllVisible = (next: 'all' | 'none') => {
    const allIds = visibleGroups.flatMap((g) => g.items.map((i) => i.id));
    if (next === 'all') {
      const merged = new Set(selected);
      for (const id of allIds) merged.add(id);
      onChange(Array.from(merged));
    } else {
      const allSet = new Set(allIds);
      onChange(selected.filter((id) => !allSet.has(id)));
    }
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] pl-8 pr-3 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B] placeholder:text-[#555]" />
      </div>
      <div className="max-h-[260px] overflow-auto border border-[#2A2A2A] bg-[#0D0D0D]">
        {totalVisible > 0 && (
          <CategoryCheckbox
            state={allState}
            onChange={toggleAllVisible}
            label={q ? `All (${totalVisible} visible)` : 'Select all'}
            count={totalVisible}
          />
        )}
        {visibleGroups.map((g) => {
          const groupSelectedCount = g.items.filter((i) => selSet.has(i.id)).length;
          const state: 'none' | 'some' | 'all' =
            groupSelectedCount === 0 ? 'none' : groupSelectedCount === g.items.length ? 'all' : 'some';
          const isCollapsed = collapsed.has(g.id);
          return (
            <div key={g.id} className="border-t border-[#1F1F1F] first:border-0">
              <div
                className="flex items-center"
                onClick={(e) => {
                  // Clicking the row body (not the checkbox) toggles collapse.
                  if ((e.target as HTMLElement).tagName !== 'INPUT') {
                    toggleCollapse(g.id);
                  }
                }}
              >
                <CategoryCheckbox
                  state={state}
                  onChange={(next) => toggleGroup(g.items, next)}
                  label={g.name}
                  count={g.items.length}
                />
              </div>
              {!isCollapsed && g.items.map((m) => (
                <label key={m.id} className="flex items-center gap-2 pl-9 pr-3 py-1.5 hover:bg-[#161616] cursor-pointer text-xs font-body text-[#999]">
                  <input type="checkbox" checked={selSet.has(m.id)} onChange={(e) => toggleItem(m.id, e.target.checked)} />
                  {m.name}
                  <span className="text-[#555] ml-auto">{formatCurrency(Number(m.price))}</span>
                </label>
              ))}
            </div>
          );
        })}
        {visibleGroups.length === 0 && (
          <p className="px-3 py-4 text-center text-[10px] font-body text-[#555]">No items match "{search}"</p>
        )}
      </div>
      {selected.length > 0 && <p className="text-[10px] text-[#666] mt-1">{selected.length} item{selected.length > 1 ? 's' : ''} selected</p>}
    </div>
  );
}

// ─── Discount Dialog ─────────────────────────────────────────────────────────
function DiscountDialog({ initial, menuItems, categories, onClose, onSave }: { initial?: Discount; menuItems: MenuItem[]; categories: MenuCategory[]; onClose: () => void; onSave: (d: any) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'PERCENTAGE');
  const [value, setValue] = useState(initial ? String(type === 'FLAT' ? Number(initial.value) / 100 : initial.value) : '');
  const [scope, setScope] = useState(initial?.scope ?? 'ALL_ITEMS');
  const [targets, setTargets] = useState<string[]>(initial?.targetItems ? JSON.parse(initial.targetItems) : []);

  const handleSave = () => {
    const v = type === 'FLAT' ? Math.round(parseFloat(value) * 100) : parseFloat(value);
    onSave({ name, type, value: v, scope, targetItems: scope !== 'ALL_ITEMS' ? targets : undefined, ...(initial ? { isActive: initial.isActive } : {}) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[440px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide text-white">{initial ? 'EDIT' : 'ADD'} DISCOUNT</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Discount name"
          className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none">
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FLAT">Flat Amount (Tk)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Value</label>
            <input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'FLAT' ? '0.00' : '10'}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
        <div>
          <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Applies To</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none">
            <option value="ALL_ITEMS">All Items</option>
            <option value="SPECIFIC_ITEMS">Specific Items Only</option>
            <option value="ALL_EXCEPT">All Items Except</option>
          </select>
        </div>
        {scope !== 'ALL_ITEMS' && <ItemSelector menuItems={menuItems} categories={categories} selected={targets} onChange={setTargets} />}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={handleSave} disabled={!name || !value} className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Coupon Dialog ───────────────────────────────────────────────────────────
function CouponDialog({ initial, menuItems, categories, onClose, onSave }: { initial?: Coupon; menuItems: MenuItem[]; categories: MenuCategory[]; onClose: () => void; onSave: (d: any) => void }) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'PERCENTAGE');
  const [value, setValue] = useState(initial ? String(type === 'FLAT' ? Number(initial.value) / 100 : initial.value) : '');
  const [scope, setScope] = useState(initial?.scope ?? 'ALL_ITEMS');
  const [targets, setTargets] = useState<string[]>(initial?.targetItems ? JSON.parse(initial.targetItems) : []);
  const [maxUses, setMaxUses] = useState(initial?.maxUses?.toString() ?? '0');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt?.slice(0, 10) ?? '');

  const handleSave = () => {
    const v = type === 'FLAT' ? Math.round(parseFloat(value) * 100) : parseFloat(value);
    onSave({ code, name, type, value: v, scope, targetItems: scope !== 'ALL_ITEMS' ? targets : undefined, maxUses: parseInt(maxUses) || 0, expiresAt: expiresAt || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[440px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide text-white">{initial ? 'EDIT' : 'ADD'} COUPON</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex gap-3">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="flex-1 border border-[#2A2A2A] px-3 py-2.5 text-sm font-body font-mono tracking-widest outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white uppercase" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="flex-1 border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none">
              <option value="PERCENTAGE">Percentage</option>
              <option value="FLAT">Flat (Tk)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Value</label>
            <input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Max Uses (0=unlimited)</label>
            <input type="number" min="0" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Expires</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
        <div>
          <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Applies To</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none">
            <option value="ALL_ITEMS">All Items</option>
            <option value="SPECIFIC_ITEMS">Specific Items Only</option>
            <option value="ALL_EXCEPT">All Items Except</option>
          </select>
        </div>
        {scope !== 'ALL_ITEMS' && <ItemSelector menuItems={menuItems} categories={categories} selected={targets} onChange={setTargets} />}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={handleSave} disabled={!code || !name || !value} className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Menu Discount Dialog ────────────────────────────────────────────────────
function MenuDiscountDialog({ initial, menuItems, onClose, onSave }: { initial?: MenuItemDiscount; menuItems: MenuItem[]; onClose: () => void; onSave: (d: any) => void }) {
  const [menuItemId, setMenuItemId] = useState(initial?.menuItemId ?? '');
  const [type, setType] = useState(initial?.type ?? 'PERCENTAGE');
  const [value, setValue] = useState(initial ? String(type === 'FLAT' ? Number(initial.value) / 100 : initial.value) : '');
  const [startDate, setStartDate] = useState(initial?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate?.slice(0, 10) ?? '');
  const [days, setDays] = useState<string[]>(initial?.applicableDays ? JSON.parse(initial.applicableDays) : []);
  const [itemSearch, setItemSearch] = useState('');

  const filteredItems = itemSearch.trim() ? menuItems.filter((m) => m.name.toLowerCase().includes(itemSearch.toLowerCase())) : menuItems;

  const handleSave = () => {
    const v = type === 'FLAT' ? Math.round(parseFloat(value) * 100) : parseFloat(value);
    onSave({ menuItemId, type, value: v, startDate, endDate, applicableDays: days.length > 0 ? days : null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[440px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide text-white">{initial ? 'EDIT' : 'ADD'} MENU DISCOUNT</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        {!initial && (
          <div>
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Menu Item</label>
            <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search menu items..."
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B] mb-1 placeholder:text-[#555]" />
            <select value={menuItemId} onChange={(e) => setMenuItemId(e.target.value)} size={5}
              className="w-full border border-[#2A2A2A] text-sm font-body bg-[#0D0D0D] text-white outline-none">
              {filteredItems.map((m) => <option key={m.id} value={m.id}>{m.name} — {formatCurrency(Number(m.price))}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none">
              <option value="PERCENTAGE">Percentage</option>
              <option value="FLAT">Flat (Tk)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Value</label>
            <input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body bg-[#0D0D0D] text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
        <div>
          <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Active Days (leave empty = all days)</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1 text-xs font-body text-[#999] cursor-pointer">
                <input type="checkbox" checked={days.includes(d)} onChange={(e) => {
                  if (e.target.checked) setDays([...days, d]);
                  else setDays(days.filter((x) => x !== d));
                }} />
                {d.slice(0, 3)}
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={handleSave} disabled={!menuItemId || !value || !startDate || !endDate} className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function DiscountsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'discounts' | 'coupons' | 'menu'>('discounts');
  const [discountDialog, setDiscountDialog] = useState<{ open: boolean; item?: Discount }>({ open: false });
  const [couponDialog, setCouponDialog] = useState<{ open: boolean; item?: Coupon }>({ open: false });
  const [menuDiscDialog, setMenuDiscDialog] = useState<{ open: boolean; item?: MenuItemDiscount }>({ open: false });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({ queryKey: ['menu'], queryFn: () => api.get('/menu') });
  const { data: categories = [] } = useQuery<MenuCategory[]>({ queryKey: ['menu-categories'], queryFn: () => api.get('/menu/categories') });
  const { data: discounts = [] } = useQuery<Discount[]>({ queryKey: ['discounts'], queryFn: () => api.get('/discounts') });
  const { data: coupons = [] } = useQuery<Coupon[]>({ queryKey: ['coupons'], queryFn: () => api.get('/discounts/coupons') });
  const { data: menuDiscounts = [] } = useQuery<MenuItemDiscount[]>({ queryKey: ['menu-discounts'], queryFn: () => api.get('/discounts/menu-discounts') });

  const saveDiscount = useMutation({
    mutationFn: (d: any) => discountDialog.item ? api.patch(`/discounts/${discountDialog.item.id}`, d) : api.post('/discounts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discounts'] }); setDiscountDialog({ open: false }); },
  });
  const deleteDiscount = useMutation({
    mutationFn: (id: string) => api.delete(`/discounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });
  const toggleDiscount = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/discounts/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });

  const saveCoupon = useMutation({
    mutationFn: (d: any) => couponDialog.item ? api.patch(`/discounts/coupons/${couponDialog.item.id}`, d) : api.post('/discounts/coupons', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['coupons'] }); setCouponDialog({ open: false }); },
  });
  const deleteCoupon = useMutation({
    mutationFn: (id: string) => api.delete(`/discounts/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });

  const saveMenuDisc = useMutation({
    mutationFn: (d: any) => menuDiscDialog.item ? api.patch(`/discounts/menu-discounts/${menuDiscDialog.item.id}`, d) : api.post('/discounts/menu-discounts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['menu-discounts'] }); setMenuDiscDialog({ open: false }); },
  });
  const deleteMenuDisc = useMutation({
    mutationFn: (id: string) => api.delete(`/discounts/menu-discounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-discounts'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Promotions</p>
          <h1 className="font-display text-4xl text-white tracking-wide">DISCOUNTS & COUPONS</h1>
        </div>
        <button onClick={() => {
          if (tab === 'discounts') setDiscountDialog({ open: true });
          else if (tab === 'coupons') setCouponDialog({ open: true });
          else setMenuDiscDialog({ open: true });
        }} className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
          <Plus size={14} /> Add {tab === 'discounts' ? 'Discount' : tab === 'coupons' ? 'Coupon' : 'Menu Discount'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#2A2A2A]">
        {(['discounts', 'coupons', 'menu'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${
              tab === t ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#999]'
            }`}
          >
            {t === 'menu' ? 'Menu Discounts' : t}
          </button>
        ))}
      </div>

      {/* Discounts Tab */}
      {tab === 'discounts' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full text-sm font-body">
            <thead><tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Name</th><th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Value</th><th className="px-5 py-3 font-medium">Scope</th>
              <th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium w-24">Actions</th>
            </tr></thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-5 py-3 text-white font-medium">{d.name}</td>
                  <td className="px-5 py-3 text-[#999]">{d.type}</td>
                  <td className="px-5 py-3 text-white">{d.type === 'FLAT' ? formatCurrency(Number(d.value)) : `${d.value}%`}</td>
                  <td className="px-5 py-3 text-[#999] text-xs">{SCOPE_LABELS[d.scope]}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleDiscount.mutate({ id: d.id, isActive: !d.isActive })}
                      className={`text-xs font-medium ${d.isActive ? 'text-green-600' : 'text-[#666]'}`}>
                      {d.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setDiscountDialog({ open: true, item: d })} className="text-[#999] hover:text-white"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('Delete?')) deleteDiscount.mutate(d.id); }} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {discounts.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[#999]">No discounts</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Coupons Tab */}
      {tab === 'coupons' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full text-sm font-body">
            <thead><tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Code</th><th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Discount</th><th className="px-5 py-3 font-medium">Uses</th>
              <th className="px-5 py-3 font-medium">Expires</th><th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium w-24">Actions</th>
            </tr></thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-5 py-3 text-white font-mono tracking-widest">{c.code}</td>
                  <td className="px-5 py-3 text-[#999]">{c.name}</td>
                  <td className="px-5 py-3 text-white">{c.type === 'FLAT' ? formatCurrency(Number(c.value)) : `${c.value}%`}</td>
                  <td className="px-5 py-3 text-[#999]">{c.usedCount}{c.maxUses > 0 ? `/${c.maxUses}` : '/∞'}</td>
                  <td className="px-5 py-3 text-[#999] text-xs">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                  <td className="px-5 py-3"><span className={`text-xs font-medium ${c.isActive ? 'text-green-600' : 'text-[#666]'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setCouponDialog({ open: true, item: c })} className="text-[#999] hover:text-white"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('Delete?')) deleteCoupon.mutate(c.id); }} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-[#999]">No coupons</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Menu Discounts Tab */}
      {tab === 'menu' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full text-sm font-body">
            <thead><tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Item</th><th className="px-5 py-3 font-medium">Discount</th>
              <th className="px-5 py-3 font-medium">Period</th><th className="px-5 py-3 font-medium">Days</th>
              <th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium w-24">Actions</th>
            </tr></thead>
            <tbody>
              {menuDiscounts.map((d) => (
                <tr key={d.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-5 py-3 text-white font-medium">{d.menuItem?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-white">{d.type === 'FLAT' ? formatCurrency(Number(d.value)) : `${d.value}%`} off</td>
                  <td className="px-5 py-3 text-[#999] text-xs">{new Date(d.startDate).toLocaleDateString()} — {new Date(d.endDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-[#999] text-xs">{d.applicableDays ? JSON.parse(d.applicableDays).map((x: string) => x.slice(0, 3)).join(', ') : 'All'}</td>
                  <td className="px-5 py-3"><span className={`text-xs font-medium ${d.isActive ? 'text-green-600' : 'text-[#666]'}`}>{d.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setMenuDiscDialog({ open: true, item: d })} className="text-[#999] hover:text-white"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('Delete?')) deleteMenuDisc.mutate(d.id); }} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {menuDiscounts.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[#999]">No menu discounts</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {discountDialog.open && <DiscountDialog initial={discountDialog.item} menuItems={menuItems} categories={categories} onClose={() => setDiscountDialog({ open: false })} onSave={(d) => saveDiscount.mutate(d)} />}
      {couponDialog.open && <CouponDialog initial={couponDialog.item} menuItems={menuItems} categories={categories} onClose={() => setCouponDialog({ open: false })} onSave={(d) => saveCoupon.mutate(d)} />}
      {menuDiscDialog.open && <MenuDiscountDialog initial={menuDiscDialog.item} menuItems={menuItems} onClose={() => setMenuDiscDialog({ open: false })} onSave={(d) => saveMenuDisc.mutate(d)} />}
    </div>
  );
}

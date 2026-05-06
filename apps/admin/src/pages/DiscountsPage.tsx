import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Search, ChevronRight, ChevronDown } from 'lucide-react';
import type { MenuItem, MenuCategory } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import ScheduledPostsPanel from './discounts/ScheduledPostsPanel';

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

/** A node in the selector tree. Two shapes:
 *   - 'leaf': a sellable MenuItem (standalone, or a variant child).
 *             Has its own selectable id.
 *   - 'parent': a non-sellable variant shell. Selecting it toggles
 *               all its children; the shell id is never persisted.
 */
type SelectorNode =
  | { kind: 'leaf'; item: MenuItem }
  | { kind: 'parent'; item: MenuItem; children: MenuItem[] };

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

  // groups: rootCategoryId → SelectorNode[]. Variant children are
  // attached under their parent shell rather than appearing as flat
  // siblings, which avoids the "Pizza Margherita ($0)" + "Pizza
  // Margherita Small ($200)" + "Pizza Margherita Large ($350)"
  // duplication that was confusing admins, and lets the discount tick
  // the entire family in one click.
  const groups = useMemo(() => {
    // Index variant children by their parent so we can attach them.
    const childrenByParent = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      if (item.variantParentId) {
        const arr = childrenByParent.get(item.variantParentId) ?? [];
        arr.push(item);
        childrenByParent.set(item.variantParentId, arr);
      }
    }

    const m = new Map<string, SelectorNode[]>();
    for (const item of menuItems) {
      // Skip variant children — they get rendered under their parent's
      // node instead of as siblings.
      if (item.variantParentId) continue;
      const root = rootIdFor(item.categoryId);
      const arr = m.get(root) ?? [];
      if (item.isVariantParent) {
        const kids = (childrenByParent.get(item.id) ?? []).sort(
          (a, b) => Number(a.price) - Number(b.price) || a.name.localeCompare(b.name),
        );
        arr.push({ kind: 'parent', item, children: kids });
      } else {
        arr.push({ kind: 'leaf', item });
      }
      m.set(root, arr);
    }
    // Sort groups by category sortOrder + name; sort nodes alphabetically.
    const nodeName = (n: SelectorNode) => n.item.name;
    const sorted: Array<{ id: string; name: string; nodes: SelectorNode[] }> = [];
    for (const [id, nodes] of m.entries()) {
      const cat = categoryById.get(id);
      sorted.push({
        id,
        name: cat?.name ?? 'Uncategorised',
        nodes: [...nodes].sort((a, b) => nodeName(a).localeCompare(nodeName(b))),
      });
    }
    return sorted.sort((a, b) => {
      const av = categoryById.get(a.id)?.sortOrder ?? 999;
      const bv = categoryById.get(b.id)?.sortOrder ?? 999;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name);
    });
  }, [menuItems, categoryById]);

  // Apply search filter inside each group. A variant parent matches
  // when ITS name OR any child's name matches; the matching children
  // (or all children when only the parent name matched) are kept.
  const visibleGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => {
        const filtered: SelectorNode[] = [];
        for (const node of g.nodes) {
          if (node.kind === 'leaf') {
            if (node.item.name.toLowerCase().includes(q)) filtered.push(node);
            continue;
          }
          const parentMatch = node.item.name.toLowerCase().includes(q);
          const matchedKids = parentMatch
            ? node.children
            : node.children.filter((c) => c.name.toLowerCase().includes(q));
          if (parentMatch || matchedKids.length > 0) {
            filtered.push({ kind: 'parent', item: node.item, children: matchedKids });
          }
        }
        return { ...g, nodes: filtered };
      })
      .filter((g) => g.nodes.length > 0 || g.name.toLowerCase().includes(q));
  }, [groups, q]);

  // Track which categories AND variant parents are user-collapsed.
  // Default: all expanded for categories; variant parents COLLAPSED by
  // default so the tree stays scannable in branches with many variants.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleCategoryCollapse = (id: string) => {
    setCollapsedCategories((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleParentExpand = (id: string) => {
    setExpandedParents((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  // Auto-expand a variant parent that matched the search by name OR by
  // child match — admin who searches "Large" should see the Large
  // variants without manually clicking each parent open.
  const searchExpanded = useMemo(() => {
    if (!q) return new Set<string>();
    const s = new Set<string>();
    for (const g of visibleGroups) {
      for (const n of g.nodes) {
        if (n.kind === 'parent') s.add(n.item.id);
      }
    }
    return s;
  }, [q, visibleGroups]);

  const selSet = useMemo(() => new Set(selected), [selected]);
  const toggleItem = (id: string, on: boolean) => {
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  };

  /** Toggle a variant parent: tick / untick all its (currently visible
   *  given the search filter) children at once. The shell's own id is
   *  never persisted — the discount engine targets sellable rows. */
  const toggleParent = (children: MenuItem[], next: 'all' | 'none') => {
    const ids = children.map((c) => c.id);
    if (next === 'all') {
      const merged = new Set(selected);
      for (const id of ids) merged.add(id);
      onChange(Array.from(merged));
    } else {
      const idSet = new Set(ids);
      onChange(selected.filter((id) => !idSet.has(id)));
    }
  };

  // Bulk toggle every visible leaf under a category, including each
  // variant parent's children.
  const flattenLeafIds = (nodes: SelectorNode[]): string[] => {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.kind === 'leaf') out.push(n.item.id);
      else for (const c of n.children) out.push(c.id);
    }
    return out;
  };
  const toggleGroup = (nodes: SelectorNode[], next: 'all' | 'none') => {
    const groupIds = flattenLeafIds(nodes);
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
  const totalVisible = visibleGroups.reduce((s, g) => s + flattenLeafIds(g.nodes).length, 0);
  const visibleSelected = visibleGroups.reduce(
    (s, g) => s + flattenLeafIds(g.nodes).filter((id) => selSet.has(id)).length,
    0,
  );
  const allState: 'none' | 'some' | 'all' =
    visibleSelected === 0 ? 'none' : visibleSelected === totalVisible ? 'all' : 'some';
  const toggleAllVisible = (next: 'all' | 'none') => {
    const allIds = visibleGroups.flatMap((g) => flattenLeafIds(g.nodes));
    if (next === 'all') {
      const merged = new Set(selected);
      for (const id of allIds) merged.add(id);
      onChange(Array.from(merged));
    } else {
      const allSet = new Set(allIds);
      onChange(selected.filter((id) => !allSet.has(id)));
    }
  };

  // First-match navigation. Build a flat ordered list of leaves +
  // parents so Enter in the search box can target the topmost
  // matching row. Parents come first in their slot so a search like
  // "Pizza" hits the Pizza family with one keystroke.
  const firstMatch = useMemo((): { kind: 'leaf' | 'parent'; id: string; ids: string[] } | null => {
    if (!q) return null;
    for (const g of visibleGroups) {
      for (const n of g.nodes) {
        if (n.kind === 'parent') {
          return { kind: 'parent', id: n.item.id, ids: n.children.map((c) => c.id) };
        }
        return { kind: 'leaf', id: n.item.id, ids: [n.item.id] };
      }
    }
    return null;
  }, [q, visibleGroups]);

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !firstMatch) return;
    e.preventDefault();
    const allOn = firstMatch.ids.every((id) => selSet.has(id));
    if (allOn) {
      const drop = new Set(firstMatch.ids);
      onChange(selected.filter((id) => !drop.has(id)));
    } else {
      const merged = new Set(selected);
      for (const id of firstMatch.ids) merged.add(id);
      onChange(Array.from(merged));
    }
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Search items… (press Enter to add the highlighted match)"
          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] pl-8 pr-3 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B] placeholder:text-[#555]"
        />
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
          const groupLeafIds = flattenLeafIds(g.nodes);
          const groupSelectedCount = groupLeafIds.filter((id) => selSet.has(id)).length;
          const state: 'none' | 'some' | 'all' =
            groupSelectedCount === 0 ? 'none' : groupSelectedCount === groupLeafIds.length ? 'all' : 'some';
          const isCollapsed = collapsedCategories.has(g.id);
          return (
            <div key={g.id} className="border-t border-[#1F1F1F] first:border-0">
              <div
                className="flex items-center"
                onClick={(e) => {
                  // Clicking the row body (not the checkbox) toggles collapse.
                  if ((e.target as HTMLElement).tagName !== 'INPUT') {
                    toggleCategoryCollapse(g.id);
                  }
                }}
              >
                <CategoryCheckbox
                  state={state}
                  onChange={(next) => toggleGroup(g.nodes, next)}
                  label={g.name}
                  count={groupLeafIds.length}
                />
              </div>
              {!isCollapsed && g.nodes.map((node) => {
                if (node.kind === 'leaf') {
                  const isFirstMatch = firstMatch?.kind === 'leaf' && firstMatch.id === node.item.id;
                  return (
                    <label
                      key={node.item.id}
                      className={`flex items-center gap-2 pl-9 pr-3 py-1.5 cursor-pointer text-xs font-body ${
                        isFirstMatch ? 'bg-[#1F1F1F] text-white ring-1 ring-[#D62B2B]/40' : 'text-[#999] hover:bg-[#161616]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selSet.has(node.item.id)}
                        onChange={(e) => toggleItem(node.item.id, e.target.checked)}
                      />
                      {node.item.name}
                      <span className="text-[#555] ml-auto">{formatCurrency(Number(node.item.price))}</span>
                    </label>
                  );
                }
                // Variant parent shell row + (optionally) its children.
                const childIds = node.children.map((c) => c.id);
                const childSelected = childIds.filter((id) => selSet.has(id)).length;
                const parentState: 'none' | 'some' | 'all' =
                  childSelected === 0 ? 'none' : childSelected === childIds.length ? 'all' : 'some';
                const isExpanded = expandedParents.has(node.item.id) || searchExpanded.has(node.item.id);
                const prices = node.children.map((c) => Number(c.price)).filter((n) => Number.isFinite(n) && n > 0);
                const priceLabel = prices.length === 0
                  ? `${node.children.length} variant${node.children.length === 1 ? '' : 's'}`
                  : prices.length === 1 || Math.min(...prices) === Math.max(...prices)
                    ? formatCurrency(prices[0])
                    : `${formatCurrency(Math.min(...prices))} – ${formatCurrency(Math.max(...prices))}`;
                const isFirstMatch = firstMatch?.kind === 'parent' && firstMatch.id === node.item.id;
                return (
                  <div key={node.item.id}>
                    <div
                      className={`flex items-center pl-7 pr-3 py-1.5 cursor-pointer text-xs font-body ${
                        isFirstMatch ? 'bg-[#1F1F1F] text-white ring-1 ring-[#D62B2B]/40' : 'text-[#999] hover:bg-[#161616]'
                      }`}
                      onClick={(e) => {
                        // Clicking anywhere except the arrow / checkbox
                        // toggles ALL the variant children. Click the
                        // arrow to expand without selecting.
                        const tgt = e.target as HTMLElement;
                        if (tgt.dataset.role === 'expand') {
                          toggleParentExpand(node.item.id);
                          return;
                        }
                        if (tgt.tagName === 'INPUT') return;
                        toggleParent(node.children, parentState === 'all' ? 'none' : 'all');
                      }}
                    >
                      <button
                        type="button"
                        data-role="expand"
                        className="text-[#555] hover:text-[#999] mr-1"
                        onClick={(e) => { e.stopPropagation(); toggleParentExpand(node.item.id); }}
                        title={isExpanded ? 'Hide variants' : 'Show variants'}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                      <ParentCheckbox state={parentState} />
                      <span className="ml-2">{node.item.name}</span>
                      <span className="text-[#666] ml-2 text-[10px]">({node.children.length})</span>
                      <span className="text-[#555] ml-auto">{priceLabel}</span>
                    </div>
                    {isExpanded && node.children.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 pl-14 pr-3 py-1.5 hover:bg-[#161616] cursor-pointer text-xs font-body text-[#999]"
                      >
                        <input
                          type="checkbox"
                          checked={selSet.has(c.id)}
                          onChange={(e) => toggleItem(c.id, e.target.checked)}
                        />
                        {c.name}
                        <span className="text-[#555] ml-auto">{formatCurrency(Number(c.price))}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
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

/** Tri-state checkbox that's purely visual — toggling is handled by
 *  the parent row's onClick (which decides whether to flip ALL kids on
 *  or off based on current state). Kept as a plain checkbox so HTML
 *  semantics + indeterminate behavior carry over. */
function ParentCheckbox({ state }: { state: 'none' | 'some' | 'all' }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      readOnly
      // Stop the row click handler from double-firing when the
      // checkbox is the click target. The row's onClick still owns
      // the "select all kids" semantics.
      onClick={(e) => e.stopPropagation()}
    />
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
  const [tab, setTab] = useState<'discounts' | 'coupons' | 'menu' | 'scheduled'>('discounts');
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
        {tab !== 'scheduled' && (
          <button onClick={() => {
            if (tab === 'discounts') setDiscountDialog({ open: true });
            else if (tab === 'coupons') setCouponDialog({ open: true });
            else setMenuDiscDialog({ open: true });
          }} className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
            <Plus size={14} /> Add {tab === 'discounts' ? 'Discount' : tab === 'coupons' ? 'Coupon' : 'Menu Discount'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#2A2A2A]">
        {(['discounts', 'coupons', 'menu', 'scheduled'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${
              tab === t ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#999]'
            }`}
          >
            {t === 'menu' ? 'Menu Discounts' : t === 'scheduled' ? 'Facebook Posts' : t}
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

      {tab === 'scheduled' && <ScheduledPostsPanel />}

      {discountDialog.open && <DiscountDialog initial={discountDialog.item} menuItems={menuItems} categories={categories} onClose={() => setDiscountDialog({ open: false })} onSave={(d) => saveDiscount.mutate(d)} />}
      {couponDialog.open && <CouponDialog initial={couponDialog.item} menuItems={menuItems} categories={categories} onClose={() => setCouponDialog({ open: false })} onSave={(d) => saveCoupon.mutate(d)} />}
      {menuDiscDialog.open && <MenuDiscountDialog initial={menuDiscDialog.item} menuItems={menuItems} onClose={() => setMenuDiscDialog({ open: false })} onSave={(d) => saveMenuDisc.mutate(d)} />}
    </div>
  );
}

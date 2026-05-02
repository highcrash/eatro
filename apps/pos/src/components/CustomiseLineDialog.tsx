import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Plus, Trash2, Search } from 'lucide-react';

import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface RecipeLine {
  ingredientId: string;
  ingredient: { id: string; name: string };
}

interface RecipeResponse {
  items: RecipeLine[];
}

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  hasVariants?: boolean;
  parentId?: string | null;
}

interface BranchSettingsLite {
  customMenuCostMargin: number | null;
  customMenuMaxMargin: number | null;
}

export interface AddedIngredientLine {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  /** Per-unit surcharge in paisa. */
  surcharge: number;
}

interface Props {
  menuItemId: string;
  menuItemName: string;
  initialRemovedIds: string[];
  initialAdded?: AddedIngredientLine[];
  onClose: () => void;
  onSave: (
    removedIngredientIds: string[],
    removedNames: string[],
    addedIngredients: AddedIngredientLine[],
  ) => void;
}

/**
 * Per-line ingredient editor. Two sections:
 *
 * 1. **Remove** — tick recipe ingredients the customer doesn't want.
 *    KT prints "NO X" lines and the recipe-deduction engine skips
 *    that ingredient.
 *
 * 2. **Add** — pick any branch ingredient + qty + unit + surcharge
 *    in paisa. Surcharge is gated to the branch's customMenu band:
 *    floor = COGS × (1 + costMargin) (strict, no negotiation here),
 *    ceiling = COGS × (1 + maxMargin). Validates client-side then
 *    re-validates server-side. Total surcharge gets added to the
 *    line's unit price; the cashier sees it on the cart and the
 *    receipt totals.
 */
export default function CustomiseLineDialog({ menuItemId, menuItemName, initialRemovedIds, initialAdded, onClose, onSave }: Props) {
  const [removed, setRemoved] = useState<Set<string>>(new Set(initialRemovedIds));
  const [added, setAdded] = useState<AddedIngredientLine[]>(initialAdded ?? []);
  const [showIngredientPicker, setShowIngredientPicker] = useState<number | null>(null);

  const { data: recipe, isLoading } = useQuery<RecipeResponse | null>({
    queryKey: ['recipe-by-menu-item', menuItemId],
    queryFn: async () => {
      try {
        return await api.get<RecipeResponse>(`/cashier-ops/recipes/menu-item/${menuItemId}`);
      } catch {
        return null;
      }
    },
  });

  const { data: ingredients = [] } = useQuery<IngredientRow[]>({
    queryKey: ['custom-menu-ingredients'],
    queryFn: () => api.get<IngredientRow[]>('/ingredients'),
  });

  const { data: branchSettings } = useQuery<BranchSettingsLite>({
    queryKey: ['branch-settings'],
    queryFn: () => api.get<BranchSettingsLite>('/branch-settings'),
  });

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const cheapestVariantCost = useMemo(() => {
    const map = new Map<string, number>();
    for (const ing of ingredients) {
      if (ing.parentId) {
        const cost = Number(ing.costPerUnit) || 0;
        if (cost > 0) {
          const cur = map.get(ing.parentId);
          if (cur == null || cost < cur) map.set(ing.parentId, cost);
        }
      }
    }
    return map;
  }, [ingredients]);

  const lines = recipe?.items ?? [];
  const costMarginPct = branchSettings?.customMenuCostMargin != null ? Number(branchSettings.customMenuCostMargin) : 0;
  const maxMarginPct = branchSettings?.customMenuMaxMargin != null ? Number(branchSettings.customMenuMaxMargin) : null;

  const computeBand = (line: AddedIngredientLine) => {
    const ing = ingredientById.get(line.ingredientId);
    if (!ing) return { cogs: 0, floor: 0, ceiling: null as number | null };
    let unitCost = Number(ing.costPerUnit) || 0;
    if (unitCost === 0 && ing.hasVariants) unitCost = cheapestVariantCost.get(ing.id) ?? 0;
    const cogs = Math.round(unitCost * line.quantity);
    const floor = Math.round(cogs * (1 + costMarginPct / 100));
    const ceiling = maxMarginPct != null ? Math.round(cogs * (1 + maxMarginPct / 100)) : null;
    return { cogs, floor, ceiling };
  };

  const toggle = (id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addEmptyAdded = () => {
    setAdded((prev) => [...prev, { ingredientId: '', ingredientName: '', quantity: 0, unit: 'G', surcharge: 0 }]);
    setShowIngredientPicker(added.length);
  };
  const updateAdded = (idx: number, patch: Partial<AddedIngredientLine>) => {
    setAdded((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeAdded = (idx: number) => setAdded((prev) => prev.filter((_, i) => i !== idx));

  const validations = added.map((line) => {
    if (!line.ingredientId || !(line.quantity > 0)) return { ok: true as const };
    const band = computeBand(line);
    if (band.cogs > 0 && line.surcharge < band.floor) {
      return { ok: false as const, error: `Below floor ${formatCurrency(band.floor)}` };
    }
    if (band.ceiling != null && line.surcharge > band.ceiling) {
      return { ok: false as const, error: `Above ceiling ${formatCurrency(band.ceiling)}` };
    }
    return { ok: true as const };
  });
  const hasInvalid = validations.some((v) => !v.ok);

  const save = () => {
    const ids = Array.from(removed);
    const idToName = new Map(lines.map((l) => [l.ingredient.id, l.ingredient.name] as const));
    const names = ids.map((id) => idToName.get(id) ?? '');
    // Drop incomplete added rows (no ingredient picked or qty 0)
    // and stamp the ingredient name from the catalogue snapshot.
    const cleanedAdded = added
      .filter((a) => a.ingredientId && a.quantity > 0)
      .map((a) => {
        const ing = ingredientById.get(a.ingredientId);
        return {
          ingredientId: a.ingredientId,
          ingredientName: ing?.name ?? a.ingredientName,
          quantity: a.quantity,
          unit: a.unit.toUpperCase(),
          surcharge: Math.max(0, Math.round(a.surcharge)),
        };
      });
    onSave(ids, names.filter((n) => n), cleanedAdded);
  };

  const totalSurcharge = added.reduce((s, a) => (a.ingredientId && a.quantity > 0 ? s + a.surcharge : s), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Customise</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{menuItemName}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-auto p-3 space-y-4">
          {/* ── Remove section ──────────────────────────────────────────── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
              Remove from recipe
            </p>
            {isLoading ? (
              <p className="text-xs text-theme-text-muted text-center py-6">Loading recipe…</p>
            ) : lines.length === 0 ? (
              <p className="text-xs text-theme-text-muted text-center py-6">No recipe — nothing to remove.</p>
            ) : (
              <div className="space-y-1">
                {lines.map((line) => {
                  const checked = removed.has(line.ingredient.id);
                  return (
                    <button
                      key={line.ingredient.id}
                      onClick={() => toggle(line.ingredient.id)}
                      className={`w-full text-left rounded-theme px-3 py-2 flex items-center gap-3 transition-colors ${
                        checked ? 'bg-theme-danger/10 border border-theme-danger' : 'bg-theme-bg hover:bg-theme-surface-alt border border-theme-border'
                      }`}
                    >
                      <input type="checkbox" checked={checked} readOnly className="accent-theme-danger" />
                      <span className={`flex-1 text-sm ${checked ? 'text-theme-danger font-bold line-through' : 'text-theme-text'}`}>{line.ingredient.name}</span>
                      {checked && <span className="text-[10px] font-bold uppercase tracking-wider text-theme-danger">No</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Add section ─────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
                Add ingredients
              </p>
              <button type="button" onClick={addEmptyAdded}
                className="bg-theme-accent text-white rounded-theme px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:opacity-90 inline-flex items-center gap-1">
                <Plus size={11} /> Add
              </button>
            </div>
            {added.length === 0 ? (
              <p className="text-[11px] text-theme-text-muted py-2">
                Optional — add extras like cheese, sauce, eggs. Price must stay between cost-margin floor and max ceiling set in admin.
              </p>
            ) : (
              <div className="space-y-2">
                {added.map((line, idx) => {
                  const ing = ingredientById.get(line.ingredientId);
                  const band = computeBand(line);
                  const v = validations[idx];
                  return (
                    <div key={idx} className="bg-theme-bg rounded-theme p-2 space-y-1.5">
                      <div className="flex gap-1.5 items-center">
                        <button type="button" onClick={() => setShowIngredientPicker(idx)}
                          className="flex-1 text-left bg-theme-surface rounded-theme px-2 py-1.5 text-sm text-theme-text hover:border-theme-accent border border-transparent">
                          {ing ? ing.name : <span className="text-theme-text-muted italic">Pick ingredient…</span>}
                        </button>
                        <button type="button" onClick={() => removeAdded(idx)}
                          className="text-theme-danger p-1 hover:bg-theme-bg rounded-theme"><Trash2 size={14} /></button>
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <input type="number" step="0.01" min="0" value={line.quantity || ''}
                          onChange={(e) => updateAdded(idx, { quantity: Number(e.target.value) || 0 })}
                          placeholder="Qty"
                          className="w-20 bg-theme-surface border border-theme-border rounded-theme px-2 py-1.5 text-sm text-theme-text outline-none focus:border-theme-accent text-right" />
                        <input value={line.unit}
                          onChange={(e) => updateAdded(idx, { unit: e.target.value.toUpperCase() })}
                          className="w-16 bg-theme-surface border border-theme-border rounded-theme px-2 py-1.5 text-sm text-theme-text outline-none focus:border-theme-accent uppercase" />
                        <span className="text-[10px] text-theme-text-muted ml-auto">Price</span>
                        <input type="number" step="0.01" min="0" value={line.surcharge ? (line.surcharge / 100).toFixed(2) : ''}
                          onChange={(e) => updateAdded(idx, { surcharge: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })}
                          placeholder="0.00"
                          className={`w-24 bg-theme-surface border rounded-theme px-2 py-1.5 text-sm font-bold text-theme-text outline-none text-right ${
                            v && !v.ok ? 'border-theme-danger' : 'border-theme-border focus:border-theme-accent'
                          }`} />
                      </div>
                      {ing && line.quantity > 0 && (
                        <div className="text-[10px] text-theme-text-muted flex justify-between">
                          <span>COGS {formatCurrency(band.cogs)}</span>
                          <span>Floor {formatCurrency(band.floor)}{band.ceiling != null ? ` • Ceiling ${formatCurrency(band.ceiling)}` : ''}</span>
                        </div>
                      )}
                      {v && !v.ok && (
                        <p className="text-[10px] text-theme-danger">{v.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t border-theme-border space-y-2">
          {totalSurcharge > 0 && (
            <p className="text-[11px] text-theme-text flex justify-between">
              <span>Per-unit additions surcharge</span>
              <span className="font-bold">{formatCurrency(totalSurcharge)}</span>
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
            <button onClick={save} disabled={hasInvalid}
              className="flex-1 bg-theme-accent text-white font-bold px-4 py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-50">
              Save ({removed.size} removed{added.filter((a) => a.ingredientId && a.quantity > 0).length > 0 ? `, ${added.filter((a) => a.ingredientId && a.quantity > 0).length} added` : ''})
            </button>
          </div>
        </div>
      </div>

      {showIngredientPicker != null && (
        <IngredientPicker
          ingredients={ingredients}
          onPick={(ing) => {
            updateAdded(showIngredientPicker, { ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit });
            setShowIngredientPicker(null);
          }}
          onClose={() => setShowIngredientPicker(null)}
        />
      )}
    </div>
  );
}

function IngredientPicker({ ingredients, onPick, onClose }: {
  ingredients: IngredientRow[];
  onPick: (i: IngredientRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const lower = q.trim().toLowerCase();
  const filtered = lower
    ? ingredients.filter((i) => i.name.toLowerCase().includes(lower))
    : ingredients.slice(0, 50);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-theme-border flex items-center justify-between">
          <p className="text-sm font-bold text-theme-text">Pick Ingredient</p>
          <button onClick={onClose} className="text-theme-text-muted"><X size={14} /></button>
        </header>
        <div className="p-3 border-b border-theme-border">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="w-full bg-theme-bg border border-theme-border rounded-theme pl-8 pr-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
          </div>
        </div>
        <div className="overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-theme-text-muted text-center py-12">No matches.</p>
          ) : filtered.map((i) => (
            <button key={i.id} onClick={() => onPick(i)}
              className="w-full text-left px-4 py-2.5 hover:bg-theme-bg border-b border-theme-border flex items-center justify-between">
              <span className="text-sm text-theme-text">{i.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{i.unit}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

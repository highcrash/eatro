import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Plus, Trash2, Search, Copy, History, Pencil } from 'lucide-react';

import type { CreateCustomMenuDto, MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import ApprovalOtpDialog from './ApprovalOtpDialog';

interface RecentCustomItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  createdAt: string;
  recipe: { ingredientId: string; quantity: number; unit: string }[];
}

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  hasVariants?: boolean;
  parentId?: string | null;
}

interface RecipeLineWithIngredient {
  ingredientId: string;
  quantity: number;
  unit: string;
}

interface RecipeSourceItem {
  id: string;
  name: string;
  kind: 'menu' | 'preReady';
  yieldQty: number;
  items: RecipeLineWithIngredient[];
}

interface BranchSettingsLite {
  customMenuCostMargin: number | null;
  customMenuNegotiateMargin: number | null;
  customMenuMaxMargin: number | null;
}

interface Props {
  /** AUTO or OTP — drives the OTP dialog gate. */
  approval: 'AUTO' | 'OTP';
  onClose: () => void;
  /** Called once the new MenuItem is persisted; caller adds it to its cart. */
  onCreated: (item: MenuItem) => void;
}

/** Merge duplicate (ingredientId, unit) lines by summing quantity. */
function mergeLines(lines: RecipeLineWithIngredient[]): RecipeLineWithIngredient[] {
  const map = new Map<string, RecipeLineWithIngredient>();
  for (const l of lines) {
    if (!l.ingredientId || !(l.quantity > 0)) continue;
    const key = `${l.ingredientId}::${l.unit.toUpperCase()}`;
    const existing = map.get(key);
    if (existing) existing.quantity += l.quantity;
    else map.set(key, { ...l, unit: l.unit.toUpperCase() });
  }
  return [...map.values()];
}

export default function CustomMenuDialog({ approval, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [recipe, setRecipe] = useState<RecipeLineWithIngredient[]>([]);
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [touchedPrice, setTouchedPrice] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [showRecentPicker, setShowRecentPicker] = useState(false);
  const [showIngredientPicker, setShowIngredientPicker] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState(false);

  // Catalogues — pulled once when the dialog opens.
  const { data: ingredients = [] } = useQuery<IngredientRow[]>({
    queryKey: ['custom-menu-ingredients'],
    queryFn: () => api.get<IngredientRow[]>('/ingredients'),
  });

  const { data: branchSettings } = useQuery<BranchSettingsLite>({
    queryKey: ['branch-settings'],
    queryFn: () => api.get<BranchSettingsLite>('/branch-settings'),
  });

  // Source recipes (menu + pre-ready) — single backend roundtrip.
  const { data: sources = [] } = useQuery<RecipeSourceItem[]>({
    queryKey: ['custom-menu-sources'],
    queryFn: () => api.get<RecipeSourceItem[]>('/cashier-ops/custom-menu/sources'),
  });

  // Recent custom items (last 30 days, max 20) — for the "Recent"
  // picker that lets the cashier reuse a prior custom dish either
  // as-is (adds the existing MenuItem to cart) or as an editable
  // template (prefills the form, save creates a NEW custom item).
  const { data: recents = [] } = useQuery<RecentCustomItem[]>({
    queryKey: ['custom-menu-recent'],
    queryFn: () => api.get<RecentCustomItem[]>('/cashier-ops/custom-menu/recent'),
  });

  // Variant fallback for cost lookup (mirrors server engine).
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

  // Live COGS — recomputed every render from the current recipe + costs.
  const cogs = useMemo(() => {
    let total = 0;
    for (const line of recipe) {
      const ing = ingredientById.get(line.ingredientId);
      if (!ing) continue;
      let unitCost = Number(ing.costPerUnit) || 0;
      if (unitCost === 0 && ing.hasVariants) {
        unitCost = cheapestVariantCost.get(ing.id) ?? 0;
      }
      total += unitCost * line.quantity;
    }
    return Math.round(total);
  }, [recipe, ingredientById, cheapestVariantCost]);

  const costMargin = branchSettings?.customMenuCostMargin ?? null;
  const negotiate = branchSettings?.customMenuNegotiateMargin ?? null;
  const maxMargin = branchSettings?.customMenuMaxMargin ?? null;

  const floorPrice = costMargin != null ? Math.round(cogs * (1 + Number(costMargin) / 100)) : cogs;
  const minPrice = negotiate != null && Number(negotiate) > 0
    ? Math.round(floorPrice * (1 - Number(negotiate) / 100))
    : floorPrice;
  const maxPrice = maxMargin != null ? Math.round(cogs * (1 + Number(maxMargin) / 100)) : null;

  // Pre-fill the price field with the floor when COGS first becomes known
  // and the user hasn't typed anything yet.
  const displayedPrice = touchedPrice
    ? sellingPrice
    : floorPrice > 0 ? (floorPrice / 100).toFixed(2) : '';

  const sellingPaisa = Math.round((Number(displayedPrice) || 0) * 100);
  const belowMin = cogs > 0 && sellingPaisa < minPrice;
  const aboveMax = maxPrice != null && sellingPaisa > maxPrice;

  const createMut = useMutation({
    mutationFn: (dto: CreateCustomMenuDto) => api.post<MenuItem>('/cashier-ops/custom-menu', dto),
    onSuccess: (item) => onCreated(item),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Could not save custom menu'),
  });

  const submit = (otp: string | null) => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    const merged = mergeLines(recipe);
    if (merged.length === 0) { setError('Add at least one ingredient'); return; }
    if (sellingPaisa <= 0) { setError('Set a selling price'); return; }
    if (belowMin) { setError(`Price below allowed minimum (${formatCurrency(minPrice)})`); return; }
    if (aboveMax) { setError(`Price above allowed maximum (${formatCurrency(maxPrice!)})`); return; }
    createMut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      sellingPrice: sellingPaisa,
      items: merged.map((m) => ({ ingredientId: m.ingredientId, quantity: m.quantity, unit: m.unit })),
      actionOtp: otp ?? undefined,
    });
  };

  const onSave = () => {
    if (approval === 'OTP') { setPendingOtp(true); return; }
    submit(null);
  };

  const addEmptyLine = () => {
    setRecipe([...recipe, { ingredientId: '', quantity: 0, unit: 'G' }]);
    setShowIngredientPicker(recipe.length);
  };

  const importSource = (source: RecipeSourceItem) => {
    // Scale by yield = 1 portion. Pre-ready yields per recipe.yieldQuantity
    // produced units, so 1-of-output requires lines / yieldQty.
    const ratio = source.kind === 'preReady' && source.yieldQty > 0 ? 1 / source.yieldQty : 1;
    const scaled = source.items.map((i) => ({
      ingredientId: i.ingredientId,
      quantity: i.quantity * ratio,
      unit: i.unit,
    }));
    setRecipe(mergeLines([...recipe, ...scaled]));
    setShowCopyPicker(false);
  };

  // "Edit & Save as new" path from the Recent picker: prefill the form
  // with the prior custom item's name (suffixed " (copy)" so the
  // unique-name constraint plays nice and the cashier can rename), its
  // recipe, and its selling price. The submit path always creates a
  // fresh MenuItem — the original row is untouched, which matches the
  // "save as new" intent and avoids editing history on already-sold
  // dishes.
  const editAsNew = (item: RecentCustomItem) => {
    setName(`${item.name} (copy)`);
    setDescription(item.description ?? '');
    setRecipe(mergeLines(item.recipe));
    setSellingPrice((item.price / 100).toFixed(2));
    setTouchedPrice(true);
    setShowRecentPicker(false);
  };

  const updateLine = (idx: number, patch: Partial<RecipeLineWithIngredient>) => {
    setRecipe(recipe.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx: number) => setRecipe(recipe.filter((_, i) => i !== idx));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between sticky top-0 bg-theme-surface z-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Customised Menu</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">Build a one-off dish</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Extra Spicy Chicken"
                className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Notes (optional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Allergens, prep notes…"
                className="w-full bg-theme-bg border border-theme-border rounded-theme px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
            </div>
          </div>

          {/* Recipe builder */}
          <div className="bg-theme-bg rounded-theme p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Recipe</p>
              <div className="flex gap-2">
                {recents.length > 0 && (
                  <button type="button" onClick={() => setShowRecentPicker(true)}
                    className="bg-theme-surface border border-theme-border rounded-theme px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text hover:border-theme-accent inline-flex items-center gap-1">
                    <History size={12} /> Recent ({recents.length})
                  </button>
                )}
                <button type="button" onClick={() => setShowCopyPicker(true)}
                  className="bg-theme-surface border border-theme-border rounded-theme px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text hover:border-theme-accent inline-flex items-center gap-1">
                  <Copy size={12} /> Copy From Recipe
                </button>
                <button type="button" onClick={addEmptyLine}
                  className="bg-theme-accent text-white rounded-theme px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider hover:opacity-90 inline-flex items-center gap-1">
                  <Plus size={12} /> Add Ingredient
                </button>
              </div>
            </div>

            {recipe.length === 0 ? (
              <p className="text-xs text-theme-text-muted py-3 text-center">No ingredients yet — copy from an existing recipe or add manually.</p>
            ) : (
              <div className="space-y-1.5">
                {recipe.map((line, idx) => {
                  const ing = ingredientById.get(line.ingredientId);
                  return (
                    <div key={idx} className="flex gap-2 items-center bg-theme-surface rounded-theme px-2 py-1.5">
                      <button type="button" onClick={() => setShowIngredientPicker(idx)}
                        className="flex-1 text-left px-2 py-1.5 text-sm text-theme-text hover:bg-theme-bg rounded-theme">
                        {ing ? ing.name : <span className="text-theme-text-muted italic">Pick ingredient…</span>}
                      </button>
                      <input type="number" step="0.01" min="0" value={line.quantity || ''}
                        onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                        placeholder="0"
                        className="w-20 bg-theme-bg border border-theme-border rounded-theme px-2 py-1.5 text-sm text-theme-text outline-none focus:border-theme-accent text-right" />
                      <input value={line.unit}
                        onChange={(e) => updateLine(idx, { unit: e.target.value.toUpperCase() })}
                        className="w-16 bg-theme-bg border border-theme-border rounded-theme px-2 py-1.5 text-sm text-theme-text outline-none focus:border-theme-accent uppercase" />
                      <button type="button" onClick={() => removeLine(idx)}
                        className="text-theme-danger p-1 hover:bg-theme-bg rounded-theme"><Trash2 size={14} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="bg-theme-bg rounded-theme p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Computed COGS</span>
              <span className="text-sm text-theme-text font-bold">{formatCurrency(cogs)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
                Floor {costMargin != null && <span className="text-theme-text-muted">(+{Number(costMargin)}%)</span>}
              </span>
              <span className="text-sm text-theme-text">{formatCurrency(floorPrice)}</span>
            </div>
            {negotiate != null && Number(negotiate) > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Negotiate Floor (−{Number(negotiate)}%)</span>
                <span className="text-sm text-[#FFA726]">{formatCurrency(minPrice)}</span>
              </div>
            )}
            {maxPrice != null && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Ceiling (+{Number(maxMargin)}%)</span>
                <span className="text-sm text-theme-text">{formatCurrency(maxPrice)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Selling Price</label>
              <input type="number" step="0.01" value={displayedPrice}
                onChange={(e) => { setSellingPrice(e.target.value); setTouchedPrice(true); }}
                className={`flex-1 bg-theme-surface border rounded-theme px-3 py-2 text-base font-bold text-theme-text outline-none text-right ${
                  belowMin || aboveMax ? 'border-theme-danger' : 'border-theme-border focus:border-theme-accent'
                }`} />
            </div>
            {(belowMin || aboveMax) && (
              <p className="text-[11px] text-theme-danger">
                {belowMin && `Below allowed minimum ${formatCurrency(minPrice)}.`}
                {aboveMax && `Above allowed maximum ${formatCurrency(maxPrice!)}.`}
              </p>
            )}
          </div>

          {error && <div className="bg-theme-danger/10 border border-theme-danger/30 rounded-theme px-3 py-2 text-xs text-theme-danger">{error}</div>}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={createMut.isPending}
              className="flex-1 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
            <button type="button" onClick={onSave} disabled={createMut.isPending}
              className="flex-1 bg-theme-accent text-white font-bold px-4 py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-50">
              {createMut.isPending ? 'Saving…' : 'Add to Order'}
            </button>
          </div>
        </div>
      </div>

      {/* Copy-from-recipe picker */}
      {showCopyPicker && (
        <RecipeSourcePicker
          sources={sources}
          onPick={importSource}
          onClose={() => setShowCopyPicker(false)}
        />
      )}

      {/* Recent custom-menu picker */}
      {showRecentPicker && (
        <RecentCustomPicker
          recents={recents}
          onReuse={(item) => {
            // Hand the existing MenuItem straight to the cart — no new
            // row created. The order pricer + recipe deduction ride
            // the item's existing id, so reusing the same custom dish
            // ten times costs ten ingredient draws against the same
            // recipe rather than creating ten near-identical
            // MenuItem rows.
            onCreated({ id: item.id, name: item.name, price: item.price } as MenuItem);
          }}
          onEdit={editAsNew}
          onClose={() => setShowRecentPicker(false)}
        />
      )}

      {/* Ingredient picker for a specific row */}
      {showIngredientPicker != null && (
        <IngredientPicker
          ingredients={ingredients}
          onPick={(ing) => {
            updateLine(showIngredientPicker, { ingredientId: ing.id, unit: ing.unit });
            setShowIngredientPicker(null);
          }}
          onClose={() => setShowIngredientPicker(null)}
        />
      )}

      {pendingOtp && (
        <ApprovalOtpDialog
          action="createCustomMenu"
          summary={`Create custom item ${name || '(untitled)'} ${formatCurrency(sellingPaisa)}`}
          onClose={() => setPendingOtp(false)}
          onApproved={(otp) => { setPendingOtp(false); submit(otp); }}
        />
      )}
    </div>
  );
}

// ─── Recipe source picker ────────────────────────────────────────────────────

function RecipeSourcePicker({ sources, onPick, onClose }: {
  sources: RecipeSourceItem[];
  onPick: (s: RecipeSourceItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const lower = q.trim().toLowerCase();
  const filtered = lower ? sources.filter((s) => s.name.toLowerCase().includes(lower)) : sources;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-theme-border flex items-center justify-between">
          <p className="text-sm font-bold text-theme-text">Copy From Recipe</p>
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
            <p className="text-xs text-theme-text-muted text-center py-12">No recipes found.</p>
          ) : filtered.map((s) => (
            <button key={`${s.kind}:${s.id}`} onClick={() => onPick(s)}
              className="w-full text-left px-4 py-3 hover:bg-theme-bg border-b border-theme-border flex items-center justify-between">
              <span className="text-sm text-theme-text">{s.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{s.items.length} ingredients</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Recent custom-menu picker ───────────────────────────────────────────────

function RecentCustomPicker({ recents, onReuse, onEdit, onClose }: {
  recents: RecentCustomItem[];
  onReuse: (item: RecentCustomItem) => void;
  onEdit: (item: RecentCustomItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const lower = q.trim().toLowerCase();
  const filtered = lower
    ? recents.filter((r) => r.name.toLowerCase().includes(lower))
    : recents;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-theme-text">Recent Custom Items</p>
            <p className="text-[10px] text-theme-text-muted">Re-add to cart, or edit and save as new</p>
          </div>
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
            <p className="text-xs text-theme-text-muted text-center py-12">No recent custom items.</p>
          ) : filtered.map((r) => (
            <div key={r.id} className="px-4 py-3 border-b border-theme-border hover:bg-theme-bg">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm text-theme-text font-semibold truncate">{r.name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                    {r.recipe.length} ingredient{r.recipe.length === 1 ? '' : 's'} • {formatCurrency(r.price)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => onReuse(r)}
                  className="flex-1 bg-theme-accent text-white rounded-theme px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider hover:opacity-90 inline-flex items-center justify-center gap-1">
                  <Plus size={12} /> Add
                </button>
                <button type="button" onClick={() => onEdit(r)}
                  className="flex-1 bg-theme-surface border border-theme-border rounded-theme px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text hover:border-theme-accent inline-flex items-center justify-center gap-1">
                  <Pencil size={12} /> Edit & Save New
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Ingredient picker ───────────────────────────────────────────────────────

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
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredient…"
              className="w-full bg-theme-bg border border-theme-border rounded-theme pl-8 pr-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent" />
          </div>
        </div>
        <div className="overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-theme-text-muted text-center py-12">No ingredients.</p>
          ) : filtered.map((i) => (
            <button key={i.id} onClick={() => onPick(i)}
              className="w-full text-left px-4 py-3 hover:bg-theme-bg border-b border-theme-border flex items-center justify-between">
              <span className="text-sm text-theme-text">{i.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{i.unit}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

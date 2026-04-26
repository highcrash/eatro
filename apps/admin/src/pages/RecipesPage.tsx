import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { MenuItem, Ingredient, Recipe, PreReadyItem } from '@restora/types';

const CSV_EXAMPLE = `ingredient_name,quantity,unit
Chicken Breast,0.25,KG
Salt,5,G
Oil,20,ML`;

function downloadExampleCSV() {
  const blob = new Blob([CSV_EXAMPLE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'recipe-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface CostBreakdown {
  menuItemId: string;
  totalCost: number;
  breakdown: { ingredient: string; quantity: number; unit: string; cost: number }[];
}

// Hardcoded conversion helpers (same as PreReadyPage)
const CONVERSION_MAP: Record<string, Record<string, number>> = {
  KG: { G: 1000 }, G: { KG: 0.001 },
  L: { ML: 1000 }, ML: { L: 0.001 },
  DOZEN: { PCS: 12 }, PCS: { DOZEN: 1 / 12 },
};

function getConvertibleUnits(unit: string): string[] {
  return [unit, ...Object.keys(CONVERSION_MAP[unit] ?? {})];
}

function convertLocally(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  const f = CONVERSION_MAP[from]?.[to];
  return f != null ? value * f : null;
}

interface RecipeLineItem {
  ingredientId: string;
  quantity: string;
  unit: string;
}

export default function RecipesPage() {
  const qc = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lines, setLines] = useState<RecipeLineItem[]>([]);
  const [notes, setNotes] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ingredientFilter, setIngredientFilter] = useState('');
  const [ingSearch, setIngSearch] = useState<Record<number, string>>({});
  const [showAutofill, setShowAutofill] = useState(false);
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [copySearch, setCopySearch] = useState('');
  const [csvErrors, setCsvErrors] = useState<Record<number, string>>({});
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ menuItemName: string; ingredientName: string; quantity: number; unit?: string }[]>([]);
  const [bulkResult, setBulkResult] = useState<{ updated: number; skipped: number; errors: string[]; totalRows: number } | null>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu-items'],
    // includeAddons=true so addons (Cheese Sauce, Garlic Nun, etc.)
    // appear in the recipe-builder dropdown — the /menu endpoint
    // defaults to isAddon=false because the website + POS grid hide
    // them. Owner needs to attach recipes to addons just like any
    // other menu item so stock + COGS deduct correctly.
    queryFn: () => api.get('/menu?includeAddons=true'),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    // Hide SUPPLY-category items (parcel bags, tissues, cleaner) from
    // the recipe ingredient picker. They're tracked via Inventory →
    // Supplies and the server rejects them on /recipes upsert anyway.
    select: (data) => data.filter((i) => i.isActive && i.category !== 'SUPPLY'),
  });

  const { data: preReadyItems = [] } = useQuery<PreReadyItem[]>({
    queryKey: ['pre-ready-items'],
    queryFn: () => api.get('/pre-ready/items'),
  });

  const { data: ingredientMap = {} } = useQuery<Record<string, string[]>>({
    queryKey: ['recipe-ingredient-map'],
    queryFn: () => api.get('/recipes/ingredient-map'),
  });

  const { data: recipe, isLoading: recipeLoading } = useQuery<Recipe | null>({
    queryKey: ['recipe', selectedItemId],
    queryFn: () => api.get(`/recipes/menu-item/${selectedItemId}`),
    enabled: !!selectedItemId,
    select: (data) => data ?? null,
  });

  const { data: costData } = useQuery<CostBreakdown | null>({
    queryKey: ['recipe-cost', selectedItemId],
    queryFn: () => api.get(`/recipes/menu-item/${selectedItemId}/cost`),
    enabled: !!selectedItemId,
  });

  // All recipe costs for the left list
  const { data: allCosts = {} } = useQuery<Record<string, number>>({
    queryKey: ['all-recipe-costs'],
    queryFn: () => api.get('/recipes/costs'),
  });

  const selectedMenuItem = menuItems.find((m) => m.id === selectedItemId);

  // Combined selectable list: ingredients + pre-ready items tagged [PR]
  const allSelectableItems = [
    ...ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, itemCode: i.itemCode ?? null, type: 'ingredient' as const })),
    ...preReadyItems.filter((pr) => pr.isActive).map((pr) => ({ id: `preready:${pr.id}`, name: `[PR] ${pr.name}`, unit: pr.unit, itemCode: null, type: 'preready' as const })),
  ];

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    setIngSearch({});
  };

  // Auto-populate lines when recipe data loads or changes
  useEffect(() => {
    if (recipe) {
      setLines(recipe.items.map((i) => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: i.unit ?? i.ingredient?.unit ?? 'G' })));
      setNotes(recipe.notes ?? '');
    } else if (selectedItemId && !recipeLoading) {
      setLines([]);
      setNotes('');
    }
    setIngSearch({});
  }, [recipe, selectedItemId, recipeLoading]);

  // All existing recipes (menu items + pre-ready) for copy-from feature
  const allRecipeSources = [
    ...menuItems.filter((m) => m.id !== selectedItemId).map((m) => ({ id: m.id, name: m.name, type: 'menu' as const })),
    ...preReadyItems.filter((pr) => pr.recipe && pr.recipe.items.length > 0).map((pr) => ({ id: pr.id, name: `[PR] ${pr.name}`, type: 'preready' as const })),
  ];

  const handleCopyFromMenu = async (sourceId: string) => {
    try {
      const r = await api.get<Recipe>(`/recipes/menu-item/${sourceId}`);
      if (r && r.items) {
        setLines(r.items.map((i) => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: i.unit ?? 'G' })));
        setNotes(r.notes ?? notes);
      }
    } catch { /* no recipe */ }
    setShowCopyFrom(false);
    setCopySearch('');
    setIngSearch({});
    setCsvErrors({});
  };

  const handleCopyFromPreReady = (sourceId: string) => {
    const pr = preReadyItems.find((p) => p.id === sourceId);
    if (pr?.recipe?.items) {
      setLines(pr.recipe.items.map((i) => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: (i as any).unit ?? i.ingredient?.unit ?? 'G' })));
      setNotes(pr.recipe.notes ?? notes);
    }
    setShowCopyFrom(false);
    setCopySearch('');
    setIngSearch({});
    setCsvErrors({});
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.trim().split('\n').map((r) => r.split(',').map((c) => c.trim()));
      if (rows.length < 2) return;

      // Skip header row
      const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
      const nameIdx = header.findIndex((h) => h.includes('ingredient') || h.includes('name'));
      const qtyIdx = header.findIndex((h) => h.includes('qty') || h.includes('quantity'));
      const unitIdx = header.findIndex((h) => h.includes('unit'));

      if (nameIdx === -1 || qtyIdx === -1) {
        setCsvErrors({ [-1]: 'CSV must have ingredient_name and quantity columns' });
        return;
      }

      const newLines: RecipeLineItem[] = [];
      const errors: Record<number, string> = {};

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[nameIdx]) continue;

        const ingName = row[nameIdx].toLowerCase();
        const qty = parseFloat(row[qtyIdx]) || 0;
        const unit = unitIdx >= 0 && row[unitIdx] ? row[unitIdx].toUpperCase() : '';

        // Find matching ingredient by name (fuzzy)
        const match = ingredients.find((ing) =>
          ing.name.toLowerCase() === ingName ||
          ing.name.toLowerCase().includes(ingName) ||
          ingName.includes(ing.name.toLowerCase()) ||
          (ing.itemCode ?? '').toLowerCase() === ingName
        );

        if (!match) {
          errors[i] = `"${row[nameIdx]}" not found in inventory`;
          newLines.push({ ingredientId: '', quantity: String(qty), unit: unit || 'G' });
        } else if (qty <= 0) {
          errors[i] = 'Invalid quantity';
          newLines.push({ ingredientId: match.id, quantity: String(qty), unit: unit || match.unit });
        } else {
          newLines.push({ ingredientId: match.id, quantity: String(qty), unit: unit || match.unit });
        }
      }

      setLines(newLines);
      setCsvErrors(errors);
      setIngSearch({});
      setShowAutofill(false);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/recipes/menu-item/${selectedItemId}`, {
        notes: notes || undefined,
        items: lines
          .filter((l) => l.ingredientId && parseFloat(l.quantity) > 0)
          .map((l) => ({ ingredientId: l.ingredientId, quantity: parseFloat(l.quantity), unit: l.unit })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipe', selectedItemId] });
      void qc.invalidateQueries({ queryKey: ['recipe-cost', selectedItemId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/recipes/menu-item/${selectedItemId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipe', selectedItemId] });
      void qc.invalidateQueries({ queryKey: ['recipe-cost', selectedItemId] });
      setLines([]);
      setNotes('');
    },
  });

  // ─── Bulk Recipe CSV ─────────────────────────────────────────────────────
  const bulkMutation = useMutation({
    mutationFn: (rows: typeof bulkRows) =>
      api.post<{ updated: number; skipped: number; errors: string[]; totalRows: number }>('/recipes/bulk', { rows }),
    onSuccess: (data) => {
      setBulkResult(data);
      void qc.invalidateQueries({ queryKey: ['all-recipe-costs'] });
      if (selectedItemId) {
        void qc.invalidateQueries({ queryKey: ['recipe', selectedItemId] });
        void qc.invalidateQueries({ queryKey: ['recipe-cost', selectedItemId] });
      }
    },
  });

  const handleBulkCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { alert('CSV must have a header row and at least one data row'); return; }

      const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
      const miIdx = header.findIndex((h) => h === 'menu_item_name' || h === 'menu_item' || h === 'item');
      const ingIdx = header.findIndex((h) => h === 'ingredient_name' || h === 'ingredient');
      const qtyIdx = header.findIndex((h) => h === 'quantity' || h === 'qty');
      const unitIdx = header.findIndex((h) => h === 'unit');

      if (miIdx === -1 || ingIdx === -1 || qtyIdx === -1) {
        alert('CSV must have columns: menu_item_name, ingredient_name, quantity (unit is optional)');
        return;
      }

      const parsed: typeof bulkRows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const mi = cols[miIdx];
        const ing = cols[ingIdx];
        const qty = parseFloat(cols[qtyIdx]);
        if (!mi || !ing || !qty || isNaN(qty)) continue;
        parsed.push({
          menuItemName: mi,
          ingredientName: ing,
          quantity: qty,
          unit: unitIdx >= 0 ? cols[unitIdx]?.toUpperCase() || undefined : undefined,
        });
      }
      setBulkRows(parsed);
      setBulkResult(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadBulkTemplate = () => {
    const csv = `menu_item_name,ingredient_name,quantity,unit
Chicken Curry,Chicken Breast,0.25,KG
Chicken Curry,Salt,5,G
Chicken Curry,Onion,50,G
Mango Lassi,Mango,100,G
Mango Lassi,Yogurt,150,ML
Mango Lassi,Sugar,15,G`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipes-bulk-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export all current recipes in the same flat shape the bulk import
  // accepts. Round-trip: edit in Excel → re-upload → recipes are fully
  // replaced per menu item (the API upserts with deleteMany+createMany).
  const downloadCurrentRecipes = async () => {
    const esc = (v: string | number | null | undefined) => {
      const s = (v ?? '').toString();
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    // Grab the full recipe set for this branch. /recipes returns all
    // recipes' items already joined via the ingredient-map endpoint
    // pattern, but there's no list endpoint yet — fetch per menu item
    // in parallel, capped to items that have a non-zero cost (fast
    // signal that a recipe exists).
    const candidates = menuItems.filter((m) => !m.deletedAt && (allCosts[m.id] ?? 0) > 0);
    const results = await Promise.all(
      candidates.map((m) =>
        api.get<{ items: { ingredient: { name: string }; quantity: number; unit: string }[] } | null>(
          `/recipes/menu-item/${m.id}`,
        ).then((r) => ({ menuItem: m, recipe: r })).catch(() => ({ menuItem: m, recipe: null })),
      ),
    );
    const lines: string[] = [];
    for (const { menuItem, recipe } of results) {
      if (!recipe?.items?.length) continue;
      for (const it of recipe.items) {
        lines.push([
          esc(menuItem.name),
          esc(it.ingredient?.name ?? ''),
          esc(Number(it.quantity)),
          esc(it.unit ?? ''),
        ].join(','));
      }
    }
    const csv = ['menu_item_name,ingredient_name,quantity,unit', ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addLine = () => setLines((l) => [...l, { ingredientId: '', quantity: '0', unit: 'G' }]);
  const removeLine = (idx: number) => {
    setLines((l) => l.filter((_, i) => i !== idx));
    setIngSearch((s) => { const next = { ...s }; delete next[idx]; return next; });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">RECIPES</h1>
          <p className="text-[#666] font-body text-sm mt-1">Link menu items to ingredients to enable automatic stock deduction on orders.</p>
        </div>
        <button
          onClick={() => { setBulkOpen(true); setBulkRows([]); setBulkResult(null); }}
          className="bg-[#2A2A2A] hover:bg-[#D62B2B] text-[#999] hover:text-white font-body text-xs px-4 py-2 tracking-widest uppercase transition-colors"
        >
          Bulk Import CSV
        </button>
      </div>

      <div className="grid grid-cols-5 gap-6" style={{ height: 'calc(100vh - 180px)' }}>
        {/* Left: Menu Items list */}
        <div className="col-span-2 bg-[#161616] border border-[#2A2A2A] flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[#2A2A2A] space-y-2">
            <input
              placeholder="Search items…"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
            <div className="relative">
              <input
                list="ing-filter-list"
                placeholder="🔍 Filter by ingredient…"
                value={ingredientFilter}
                onChange={(e) => setIngredientFilter(e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-[#C8FF00] px-3 py-2 text-xs font-body focus:outline-none focus:border-[#C8FF00]/50 transition-colors placeholder:text-[#555]"
              />
              <datalist id="ing-filter-list">
                {ingredients.map((i) => <option key={i.id} value={i.name} />)}
              </datalist>
              {ingredientFilter && (
                <button onClick={() => setIngredientFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666] hover:text-white text-xs">✕</button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {menuItems
              .filter((m) => !m.deletedAt && m.isAvailable !== false)
              .filter((m) => !categoryFilter || m.name.toLowerCase().includes(categoryFilter.toLowerCase()))
              .filter((m) => {
                if (!ingredientFilter) return true;
                const matchIng = ingredients.find((i) => i.name.toLowerCase() === ingredientFilter.toLowerCase());
                if (!matchIng) return true;
                return ingredientMap[matchIng.id]?.includes(m.id) ?? false;
              })
              .map((m) => {
                const sell = Number(m.price);
                const cost = allCosts[m.id] ?? 0;
                const profit = sell - cost;
                const pct = sell > 0 && cost > 0 ? Math.round((cost / sell) * 100) : 0;
                const isSelected = selectedItemId === m.id;
                const hasCost = cost > 0;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelectItem(m.id)}
                    className={`w-full text-left px-4 py-2 border-b border-[#2A2A2A] transition-colors ${
                      isSelected ? 'bg-[#D62B2B] text-white' : 'hover:bg-[#1F1F1F] text-[#999]'
                    }`}
                  >
                    <p className="font-body text-sm text-white leading-tight">{m.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {hasCost ? (
                        <>
                          <span className={`font-body text-[10px] ${isSelected ? 'text-[#ffcccc]' : 'text-[#888]'}`}>
                            {formatCurrency(sell)}
                          </span>
                          <span className={`font-body text-[10px] ${isSelected ? 'text-[#ffcccc]' : 'text-[#555]'}`}>−</span>
                          <span className={`font-body text-[10px] ${isSelected ? 'text-[#ffcccc]' : 'text-[#888]'}`}>
                            {formatCurrency(cost)}
                          </span>
                          <span className={`font-body text-[10px] ${isSelected ? 'text-[#ffcccc]' : 'text-[#555]'}`}>=</span>
                          <span className={`font-body text-[10px] font-medium ${profit > 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>
                            {formatCurrency(profit)}
                          </span>
                          <span className={`font-body text-[10px] font-medium ${pct <= 30 ? 'text-[#4CAF50]' : pct <= 40 ? 'text-[#FFA726]' : 'text-[#D62B2B]'}`}>
                            {pct}%
                          </span>
                        </>
                      ) : (
                        <span className={`font-body text-[10px] ${isSelected ? 'text-[#ffcccc]' : 'text-[#444]'}`}>
                          {formatCurrency(sell)} · no recipe
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            {menuItems.length === 0 && (
              <p className="p-4 text-[#666] font-body text-sm">No menu items found.</p>
            )}
          </div>
        </div>

        {/* Right: Recipe Editor */}
        <div className="col-span-3 bg-[#161616] border border-[#2A2A2A] flex flex-col overflow-hidden">
          {!selectedItemId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[#2A2A2A] font-display text-2xl tracking-widest">SELECT A MENU ITEM</p>
            </div>
          ) : recipeLoading ? (
            <p className="p-6 text-[#666] font-body text-sm">Loading recipe…</p>
          ) : (
            <>
              {/* Fixed header */}
              <div className="px-5 py-4 border-b border-[#2A2A2A]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-display text-xl text-white tracking-widest">{selectedMenuItem?.name}</h2>
                    {costData && costData.totalCost > 0 ? (
                      <p className="text-[#666] font-body text-xs mt-1">
                        {formatCurrency(Number(selectedMenuItem?.price ?? 0))} − {formatCurrency(costData.totalCost)} = <span className={Number(selectedMenuItem?.price ?? 0) - costData.totalCost > 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}>{formatCurrency(Number(selectedMenuItem?.price ?? 0) - costData.totalCost)}</span>
                        {' '}<span className={(() => { const p = Math.round((costData.totalCost / Number(selectedMenuItem?.price ?? 1)) * 100); return p <= 30 ? 'text-[#4CAF50]' : p <= 40 ? 'text-[#FFA726]' : 'text-[#D62B2B]'; })()}>({Math.round((costData.totalCost / Number(selectedMenuItem?.price ?? 1)) * 100)}% cost)</span>
                      </p>
                    ) : (
                      <p className="text-[#666] font-body text-xs mt-1">{recipe ? `${recipe.items.length} ingredient(s)` : 'No recipe yet'}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {recipe && (
                      <button
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                        className="bg-[#2A2A2A] hover:bg-[#D62B2B] text-[#999] hover:text-white font-body text-xs px-3 py-2 tracking-widest uppercase transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (recipe) {
                          setLines(recipe.items.map((i) => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: i.unit ?? i.ingredient?.unit ?? 'G' })));
                          setNotes(recipe.notes ?? '');
                        } else { setLines([]); setNotes(''); }
                        setIngSearch({});
                      }}
                      className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999] hover:text-white font-body text-xs px-3 py-2 tracking-widest uppercase transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Notes - compact */}
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Recipe notes (optional)…"
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-1.5 text-xs font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>

              {/* Autofill bar + Ingredient Lines — scrollable */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                {/* Autofill actions */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowAutofill(!showAutofill)}
                      className="bg-[#0D0D0D] border border-[#2A2A2A] hover:border-[#D62B2B] text-[#999] hover:text-white font-body text-xs px-3 py-1.5 transition-colors"
                    >
                      Autofill ▾
                    </button>
                    {showAutofill && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-[#161616] border border-[#2A2A2A] w-56 shadow-lg">
                        <button
                          onClick={() => { setShowAutofill(false); setShowCopyFrom(true); setCopySearch(''); }}
                          className="w-full text-left px-3 py-2.5 text-sm font-body text-[#999] hover:bg-[#1F1F1F] hover:text-white transition-colors border-b border-[#2A2A2A]"
                        >
                          Copy from existing recipe
                          <span className="block text-[10px] text-[#666] mt-0.5">Menu items & Pre-Ready</span>
                        </button>
                        <button
                          onClick={() => { setShowAutofill(false); csvInputRef.current?.click(); }}
                          className="w-full text-left px-3 py-2.5 text-sm font-body text-[#999] hover:bg-[#1F1F1F] hover:text-white transition-colors border-b border-[#2A2A2A]"
                        >
                          Upload CSV
                          <span className="block text-[10px] text-[#666] mt-0.5">Import ingredients from file</span>
                        </button>
                        <button
                          onClick={() => { setShowAutofill(false); downloadExampleCSV(); }}
                          className="w-full text-left px-3 py-2 text-xs font-body text-[#666] hover:bg-[#1F1F1F] hover:text-[#999] transition-colors"
                        >
                          ↓ Download CSV template
                        </button>
                      </div>
                    )}
                  </div>
                  <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
                  {Object.keys(csvErrors).length > 0 && (
                    <span className="text-[#FFA726] font-body text-[10px]">
                      {Object.keys(csvErrors).length} issue(s) from CSV — check red borders below
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-12 gap-2 mb-1">
                  <div className="col-span-5 text-[#666] text-xs font-body tracking-widest uppercase">Ingredient (type to search)</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Qty</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Unit</div>
                  <div className="col-span-3"></div>
                </div>
                {lines.map((line, idx) => {
                  const selectedIng = ingredients.find((i) => i.id === line.ingredientId);
                  const nativeUnit = selectedIng?.unit ?? 'G';
                  const convertibleUnits = getConvertibleUnits(nativeUnit);
                  const qty = parseFloat(line.quantity) || 0;
                  const showConvHelper = selectedIng && line.unit !== nativeUnit && qty > 0;
                  const searchVal = ingSearch[idx] !== undefined ? ingSearch[idx] : '';
                  const preReadyMatch = searchVal && allSelectableItems.some((i) => i.type === 'preready' && `${i.name} (${i.unit})` === searchVal);
                  const csvErr = csvErrors[idx + 1]; // CSV rows are 1-indexed (header is 0)

                  let convertedText = '';
                  if (showConvHelper) {
                    const c = convertLocally(qty, line.unit, nativeUnit);
                    convertedText = c !== null ? `= ${c.toFixed(4).replace(/\.?0+$/, '')} ${nativeUnit} deducted` : '';
                  }

                  return (
                    <div key={idx} className="space-y-1">
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-5 relative">
                          <input
                            list={`recipe-ing-${idx}`}
                            value={ingSearch[idx] !== undefined ? ingSearch[idx] : (selectedIng ? `${selectedIng.name} (${selectedIng.unit})` : '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              setIngSearch((s) => ({ ...s, [idx]: val }));
                              // Clear CSV error for this row on edit
                              if (csvErr) setCsvErrors((errs) => { const next = { ...errs }; delete next[idx + 1]; return next; });
                              const match = allSelectableItems.find((i) => i.type === 'ingredient' && (`${i.name} (${i.unit})` === val || i.itemCode === val));
                              if (match) {
                                setLines((l) => l.map((item, i) => i === idx ? { ...item, ingredientId: match.id, unit: match.unit } : item));
                                setIngSearch((s) => { const next = { ...s }; delete next[idx]; return next; });
                              }
                            }}
                            onFocus={(e) => e.target.select()}
                            placeholder="Type name or code…"
                            className={`w-full bg-[#0D0D0D] border text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] ${csvErr ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'}`}
                          />
                          <datalist id={`recipe-ing-${idx}`}>
                            {allSelectableItems.filter((i) => {
                              const s = (ingSearch[idx] ?? '').toLowerCase().trim();
                              return !s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s);
                            }).slice(0, 30).map((i) => (
                              <option key={i.id} value={`${i.name} (${i.unit})`}>{i.itemCode ? `[${i.itemCode}] ` : ''}{i.name}</option>
                            ))}
                          </datalist>
                          {preReadyMatch && (
                            <p className="text-[#FFA726] font-body text-[10px] mt-0.5">Pre-Ready item — add to Inventory to use</p>
                          )}
                          {csvErr && (
                            <p className="text-[#D62B2B] font-body text-[10px] mt-0.5">{csvErr}</p>
                          )}
                        </div>
                        <div className="col-span-2">
                          <input
                            type="number" step="0.001" min="0"
                            value={line.quantity}
                            onChange={(e) => setLines((l) => l.map((item, i) => i === idx ? { ...item, quantity: e.target.value } : item))}
                            className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                          />
                        </div>
                        <div className="col-span-2">
                          <select
                            value={line.unit}
                            onChange={(e) => setLines((l) => l.map((item, i) => i === idx ? { ...item, unit: e.target.value } : item))}
                            className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                          >
                            {convertibleUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3 flex items-center gap-2">
                          {showConvHelper && convertedText && (
                            <span className="text-[#666] font-body text-[10px]">{convertedText}</span>
                          )}
                          <button
                            onClick={() => removeLine(idx)}
                            className="text-[#666] hover:text-[#D62B2B] font-body text-xs transition-colors ml-auto"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={addLine}
                  className="mt-2 text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors border border-dashed border-[#2A2A2A] hover:border-[#D62B2B] w-full py-2"
                >
                  + Add Ingredient
                </button>
              </div>

              {/* Pinned bottom: cost summary + save */}
              <div className="border-t border-[#2A2A2A] px-5 py-3 shrink-0">
                {/* Compact cost breakdown */}
                {costData && costData.breakdown.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                    {costData.breakdown.map((item, idx) => (
                      <span key={idx} className="text-[#666] font-body text-[10px]">
                        {item.ingredient}: ৳{(item.cost / 100).toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}

                {saveMutation.error && (
                  <p className="text-[#F03535] text-xs font-body mb-2">{(saveMutation.error as Error).message}</p>
                )}
                {saveMutation.isSuccess && (
                  <p className="text-[#4CAF50] text-xs font-body mb-2">Recipe saved!</p>
                )}

                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="w-full bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Recipe'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Copy from existing recipe modal */}
      {showCopyFrom && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowCopyFrom(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2A2A2A]">
              <h2 className="font-display text-lg text-white tracking-widest">COPY RECIPE FROM</h2>
              <p className="text-[#666] font-body text-xs mt-1">Select a menu item or pre-ready item to copy its recipe ingredients.</p>
              <input
                value={copySearch}
                onChange={(e) => setCopySearch(e.target.value)}
                placeholder="Search items…"
                className="w-full mt-3 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {allRecipeSources
                .filter((s) => !copySearch || s.name.toLowerCase().includes(copySearch.toLowerCase()))
                .map((source) => (
                  <button
                    key={`${source.type}-${source.id}`}
                    onClick={() => source.type === 'menu' ? void handleCopyFromMenu(source.id) : handleCopyFromPreReady(source.id)}
                    className="w-full text-left px-5 py-3 border-b border-[#2A2A2A] hover:bg-[#1F1F1F] transition-colors"
                  >
                    <span className="text-white font-body text-sm">{source.name}</span>
                    <span className="text-[#666] font-body text-xs ml-2">{source.type === 'preready' ? 'Pre-Ready' : 'Menu Item'}</span>
                  </button>
                ))}
              {allRecipeSources.filter((s) => !copySearch || s.name.toLowerCase().includes(copySearch.toLowerCase())).length === 0 && (
                <p className="px-5 py-8 text-center text-[#666] font-body text-sm">No items with recipes found.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[#2A2A2A]">
              <button onClick={() => setShowCopyFrom(false)} className="w-full bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Recipe CSV Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setBulkOpen(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl text-white tracking-widest">BULK RECIPE IMPORT</h2>
                <p className="font-body text-[#666] text-xs mt-1">
                  One row per ingredient. Group by menu item. Existing recipes will be overwritten.
                </p>
              </div>
              <button onClick={() => setBulkOpen(false)} className="text-[#666] hover:text-white text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {!bulkResult && bulkRows.length === 0 && (
                <div className="space-y-3">
                  <button
                    onClick={downloadBulkTemplate}
                    className="w-full border border-[#2A2A2A] hover:border-[#D62B2B] text-[#999] hover:text-white font-body text-sm px-4 py-3 transition-colors tracking-widest uppercase"
                  >
                    ↓ Download CSV Template
                  </button>
                  <button
                    onClick={downloadCurrentRecipes}
                    className="w-full border border-[#2A2A2A] hover:border-[#C8FF00] text-[#999] hover:text-white font-body text-sm px-4 py-3 transition-colors tracking-widest uppercase"
                  >
                    ↓ Export Current Recipes
                  </button>
                  <button
                    onClick={() => bulkInputRef.current?.click()}
                    className="w-full bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-3 transition-colors tracking-widest uppercase"
                  >
                    Upload CSV
                  </button>
                  <input ref={bulkInputRef} type="file" accept=".csv" onChange={handleBulkCsvFile} className="hidden" />
                  <div className="border border-[#2A2A2A] bg-[#0D0D0D] p-4 text-xs font-body text-[#888] space-y-1.5">
                    <p className="text-white">Required columns:</p>
                    <p><span className="text-[#C8FF00]">menu_item_name</span> — must match an existing menu item (case-insensitive)</p>
                    <p><span className="text-[#C8FF00]">ingredient_name</span> — for variants, use the full "Parent — Brand" name</p>
                    <p><span className="text-[#C8FF00]">quantity</span> — numeric</p>
                    <p><span className="text-[#888]">unit</span> — optional; defaults to the ingredient's own unit</p>
                  </div>
                </div>
              )}

              {bulkRows.length > 0 && !bulkResult && (
                <>
                  <div className="border border-[#2A2A2A] overflow-auto max-h-[40vh]">
                    <table className="w-full text-xs font-body">
                      <thead className="bg-[#0D0D0D] sticky top-0">
                        <tr className="text-[#999] uppercase tracking-widest">
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Menu Item</th>
                          <th className="px-3 py-2 text-left">Ingredient</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r, i) => (
                          <tr key={i} className="border-t border-[#2A2A2A] text-white">
                            <td className="px-3 py-1.5 text-[#666]">{i + 1}</td>
                            <td className="px-3 py-1.5">{r.menuItemName}</td>
                            <td className="px-3 py-1.5">{r.ingredientName}</td>
                            <td className="px-3 py-1.5 text-right">{r.quantity}</td>
                            <td className="px-3 py-1.5 text-[#999]">{r.unit ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-white font-body text-sm">
                    {bulkRows.length} line{bulkRows.length !== 1 ? 's' : ''} across{' '}
                    {new Set(bulkRows.map((r) => r.menuItemName.toLowerCase())).size} menu item
                    {new Set(bulkRows.map((r) => r.menuItemName.toLowerCase())).size !== 1 ? 's' : ''} ready to import
                  </p>
                </>
              )}

              {bulkResult && (
                <div className="border border-[#2A2A2A] bg-[#0D0D0D] p-4 space-y-2">
                  <p className="text-sm font-body">
                    <span className="text-[#4CAF50]">{bulkResult.updated} recipe{bulkResult.updated !== 1 ? 's' : ''} updated</span>
                    {bulkResult.skipped > 0 && <span className="text-[#FFA726] ml-3">{bulkResult.skipped} row{bulkResult.skipped !== 1 ? 's' : ''} skipped</span>}
                    <span className="text-[#666] ml-3">of {bulkResult.totalRows} total</span>
                  </p>
                  {bulkResult.errors.length > 0 && (
                    <div className="text-xs text-red-400 font-body space-y-0.5 max-h-40 overflow-auto">
                      {bulkResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end px-5 py-4 border-t border-[#2A2A2A]">
              <button
                onClick={() => setBulkOpen(false)}
                className="border border-[#2A2A2A] px-5 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors"
              >
                {bulkResult ? 'Done' : 'Cancel'}
              </button>
              {bulkRows.length > 0 && !bulkResult && (
                <button
                  onClick={() => bulkMutation.mutate(bulkRows)}
                  disabled={bulkMutation.isPending}
                  className="bg-[#D62B2B] text-white px-5 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors disabled:opacity-40"
                >
                  {bulkMutation.isPending ? 'Importing…' : `Import ${bulkRows.length} Line${bulkRows.length !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

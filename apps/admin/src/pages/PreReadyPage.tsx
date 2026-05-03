import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { PreReadyItem, ProductionOrder, PreReadyBatch, Ingredient, ProductionStatus, Recipe } from '@restora/types';
import type { MenuItem } from '@restora/types';
import { useStockUnits } from '../lib/units';

/**
 * Merge a list of pre-ready recipe lines, summing quantities for any
 * line that shares the same `ingredientId::UNIT` key. Mirrors the
 * POS Custom Menu Dialog mergeLines so admin can stack multiple
 * "Copy from" actions without losing prior copies and without
 * tripping the server-side unique-(recipeId, ingredientId) constraint.
 */
function mergeRecipeLines(
  lines: Array<{ ingredientId: string; quantity: string; unit: string }>,
): Array<{ ingredientId: string; quantity: string; unit: string }> {
  const map = new Map<string, { ingredientId: string; quantity: string; unit: string }>();
  const placeholders: typeof lines = [];
  for (const l of lines) {
    if (!l.ingredientId) {
      placeholders.push(l);
      continue;
    }
    const unitKey = (l.unit || 'G').toUpperCase();
    const key = `${l.ingredientId}::${unitKey}`;
    const qty = parseFloat(l.quantity) || 0;
    const existing = map.get(key);
    if (existing) {
      const sum = (parseFloat(existing.quantity) || 0) + qty;
      existing.quantity = String(parseFloat(sum.toFixed(6)));
    } else {
      map.set(key, { ingredientId: l.ingredientId, quantity: String(qty), unit: unitKey });
    }
  }
  return [...map.values(), ...placeholders];
}

// Calculate recipe cost for a pre-ready item from its recipe + ingredient costs
function calcPreReadyCost(item: PreReadyItem, ingredients: Ingredient[]): { recipeCost: number; yieldQty: number; costPerUnit: number } | null {
  if (!item.recipe || item.recipe.items.length === 0) return null;
  let recipeCost = 0;
  for (const ri of item.recipe.items) {
    const ing = ingredients.find((i) => i.id === ri.ingredientId);
    if (ing) {
      recipeCost += Number(ing.costPerUnit) * Number(ri.quantity);
    }
  }
  const yieldQty = Number(item.recipe.yieldQuantity) || 1;
  return { recipeCost, yieldQty, costPerUnit: recipeCost / yieldQty };
}

const PR_CSV_EXAMPLE = `ingredient_name,quantity,unit
Chicken Breast,0.25,KG
Salt,5,G
Oil,20,ML`;

function downloadPRExampleCSV() {
  const blob = new Blob([PR_CSV_EXAMPLE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'preready-recipe-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_COLORS: Record<ProductionStatus, string> = {
  PENDING: 'text-[#FFA726] bg-[#3a2e00]',
  APPROVED: 'text-[#29B6F6] bg-[#00243a]',
  IN_PROGRESS: 'text-[#CE93D8] bg-[#2a003a]',
  COMPLETED: 'text-[#4CAF50] bg-[#1a3a1a]',
  WASTED: 'text-[#D62B2B] bg-[#3a0000]',
  CANCELLED: 'text-[#666] bg-[#2A2A2A]',
};

// UNITS is now sourced per-render via useStockUnits() so custom units
// show up in dropdowns. See lib/units.ts.

// Hardcoded local conversion factors for UI display
const CONVERSION_MAP: Record<string, Record<string, number>> = {
  KG: { G: 1000 }, G: { KG: 0.001 },
  L: { ML: 1000 }, ML: { L: 0.001 },
  DOZEN: { PCS: 12 }, PCS: { DOZEN: 1 / 12 },
};

function getConvertibleUnitsLocal(unit: string): string[] {
  const related = Object.keys(CONVERSION_MAP[unit] ?? {});
  return [unit, ...related];
}

function convertLocally(value: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return value;
  const factor = CONVERSION_MAP[fromUnit]?.[toUnit];
  return factor != null ? value * factor : null;
}

export default function PreReadyPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'items' | 'production' | 'batches'>('items');
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemForm, setItemForm] = useState({ name: '', unit: 'PCS', minimumStock: '0' });
  const [showRecipe, setShowRecipe] = useState<PreReadyItem | null>(null);
  const [recipeLines, setRecipeLines] = useState<{ ingredientId: string; quantity: string; unit: string }[]>([]);
  const [recipeYield, setRecipeYield] = useState({ quantity: '1', unit: 'PCS', notes: '' });
  const [showCreateProd, setShowCreateProd] = useState(false);
  const [prodForm, setProdForm] = useState({ preReadyItemId: '', quantity: '0', notes: '' });
  const [completing, setCompleting] = useState<ProductionOrder | null>(null);
  const [completeForm, setCompleteForm] = useState({ makingDate: new Date().toISOString().split('T')[0], expiryDate: '' });
  const [showAutofillPR, setShowAutofillPR] = useState(false);
  const [showCopyFromPR, setShowCopyFromPR] = useState(false);
  const [copySearchPR, setCopySearchPR] = useState('');
  const [csvErrorsPR, setCsvErrorsPR] = useState<Record<number, string>>({});
  const csvInputRefPR = useRef<HTMLInputElement>(null);
  const [ingSearch, setIngSearch] = useState<Record<number, string>>({});
  const [ingredientFilter, setIngredientFilter] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  type PrItemSortKey = 'name' | 'unit' | 'currentStock' | 'minimumStock' | 'costPerUnit';
  const [itemSort, setItemSort] = useState<{ key: PrItemSortKey; dir: 'asc' | 'desc' } | null>(null);
  const toggleItemSort = (key: PrItemSortKey) => {
    setItemSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: 'asc' };
      if (cur.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };
  const [editingItem, setEditingItem] = useState<PreReadyItem | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    minimumStock: string;
    unit: string;
    autoDeductInputs: boolean;
    /**
     * Tri-state: undefined = field untouched (don't send), null = unlink,
     * string = link to that ingredient id. Lets the API distinguish a
     * deliberate unlink from "form just doesn't include this field".
     */
    producesIngredientId: string | null | undefined;
  }>({ name: '', minimumStock: '0', unit: 'PCS', autoDeductInputs: true, producesIngredientId: undefined });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ preReadyItemName: string; yieldQuantity?: number; yieldUnit?: string; ingredientName: string; quantity: number; unit?: string }[]>([]);
  const [bulkResult, setBulkResult] = useState<{ updated: number; skipped: number; errors: string[]; totalRows: number } | null>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);

  const { data: items = [] } = useQuery<PreReadyItem[]>({
    queryKey: ['pre-ready-items'],
    queryFn: () => api.get('/pre-ready/items'),
  });
  const { units: UNITS } = useStockUnits();

  const { data: productions = [] } = useQuery<ProductionOrder[]>({
    queryKey: ['productions'],
    queryFn: () => api.get('/pre-ready/productions'),
    enabled: tab === 'production',
  });

  const { data: batches = [] } = useQuery<(PreReadyBatch & { preReadyItem?: { name: string; unit: string } })[]>({
    queryKey: ['pre-ready-batches'],
    queryFn: () => api.get('/pre-ready/batches'),
    enabled: tab === 'batches',
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    // Hide SUPPLY-category items (parcel bags, tissues, cleaner) — they
    // can't be part of a pre-ready recipe; tracked via Inventory →
    // Supplies and the server rejects them on /recipes upsert.
    select: (d) => d.filter((i) => i.isActive && i.category !== 'SUPPLY'),
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu-items-for-copy'],
    queryFn: () => api.get('/menu'),
    enabled: showCopyFromPR,
  });

  const filteredSortedItems = (() => {
    const q = itemSearch.trim().toLowerCase();
    const matchIng = ingredientFilter
      ? ingredients.find((i) => i.name.toLowerCase() === ingredientFilter.toLowerCase())
      : null;
    const filtered = items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (matchIng) {
        return item.recipe?.items?.some((ri) => ri.ingredientId === matchIng.id) ?? false;
      }
      return true;
    });
    if (!itemSort) return filtered;
    const val = (item: PreReadyItem): string | number => {
      switch (itemSort.key) {
        case 'name': return item.name.toLowerCase();
        case 'unit': return (item.unit ?? '').toLowerCase();
        case 'currentStock': return Number(item.currentStock) || 0;
        case 'minimumStock': return Number(item.minimumStock) || 0;
        case 'costPerUnit': {
          const c = calcPreReadyCost(item, ingredients);
          return c?.costPerUnit ?? 0;
        }
      }
    };
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return itemSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  })();

  // Sources for copy-from: other pre-ready items + menu items with recipes
  const allCopySources = [
    ...items.filter((pr) => pr.id !== showRecipe?.id && pr.recipe && pr.recipe.items.length > 0)
      .map((pr) => ({ id: pr.id, name: `[PR] ${pr.name}`, type: 'preready' as const })),
    ...menuItems.map((m) => ({ id: m.id, name: m.name, type: 'menu' as const })),
  ];

  // Last-copied source id, used to flash a "Copied" indicator on the
  // picker row so admin can stack multiple sources without wondering
  // whether the click registered.
  const [lastCopiedPR, setLastCopiedPR] = useState<string | null>(null);
  const flashCopiedPR = (id: string) => {
    setLastCopiedPR(id);
    window.setTimeout(() => setLastCopiedPR((cur) => (cur === id ? null : cur)), 1200);
  };

  const handlePRCopyFromPreReady = (sourceId: string) => {
    const pr = items.find((p) => p.id === sourceId);
    if (pr?.recipe?.items) {
      // APPEND-AND-DEDUPE — never replace the working list, sum
      // quantities for any ingredient already present in the same
      // unit. Picker stays open so admin can stack copies.
      const incoming = pr.recipe.items.map((i) => ({
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
        unit: (i as any).unit ?? i.ingredient?.unit ?? 'G',
      }));
      setRecipeLines((cur) => mergeRecipeLines([...cur, ...incoming]));
      flashCopiedPR(sourceId);
    }
    setIngSearch({});
    setCsvErrorsPR({});
  };

  const handlePRCopyFromMenu = async (sourceId: string) => {
    try {
      const r = await api.get<Recipe>(`/recipes/menu-item/${sourceId}`);
      if (r && r.items) {
        const incoming = r.items.map((i) => ({
          ingredientId: i.ingredientId,
          quantity: String(i.quantity),
          unit: i.unit ?? 'G',
        }));
        setRecipeLines((cur) => mergeRecipeLines([...cur, ...incoming]));
        flashCopiedPR(sourceId);
      }
    } catch { /* no recipe */ }
    setIngSearch({});
    setCsvErrorsPR({});
  };

  const handlePRCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.trim().split('\n').map((r) => r.split(',').map((c) => c.trim()));
      if (rows.length < 2) return;

      const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
      const nameIdx = header.findIndex((h) => h.includes('ingredient') || h.includes('name'));
      const qtyIdx = header.findIndex((h) => h.includes('qty') || h.includes('quantity'));
      const unitIdx = header.findIndex((h) => h.includes('unit'));

      if (nameIdx === -1 || qtyIdx === -1) {
        setCsvErrorsPR({ [-1]: 'CSV must have ingredient_name and quantity columns' });
        return;
      }

      const newLines: { ingredientId: string; quantity: string; unit: string }[] = [];
      const errors: Record<number, string> = {};

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[nameIdx]) continue;
        const ingName = row[nameIdx].toLowerCase();
        const qty = parseFloat(row[qtyIdx]) || 0;
        const unit = unitIdx >= 0 && row[unitIdx] ? row[unitIdx].toUpperCase() : '';

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

      setRecipeLines(newLines);
      setCsvErrorsPR(errors);
      setIngSearch({});
      setShowAutofillPR(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Merge ingredients + pre-ready items into a single selectable list.
  // A pre-ready item is only added if its auto-mirrored ingredient
  // (name === "[PR] <pr.name>") DOESN'T already appear in the
  // ingredient list — which it almost always does, since createItem
  // auto-creates the mirror. Without this dedupe the picker shows the
  // same logical thing twice ("[PR] PG Basic Mayo" once from the
  // Ingredient table, once from PreReadyItem) and admin gets confused
  // about which to pick. Selecting the pre-ready row was already
  // blocked by the matcher (only `type === 'ingredient'` binds), so
  // hiding it is purely UX cleanup with zero behaviour change.
  const ingredientNameSet = new Set(ingredients.map((i) => i.name.toLowerCase()));
  const allSelectableItems = [
    ...ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, itemCode: (i as any).itemCode ?? null, type: 'ingredient' as const })),
    ...items
      .filter((pr) => pr.id !== showRecipe?.id)
      .filter((pr) => !ingredientNameSet.has(`[pr] ${pr.name}`.toLowerCase()))
      .map((pr) => ({ id: `preready:${pr.id}`, name: `[PR] ${pr.name}`, unit: pr.unit, itemCode: null, type: 'preready' as const })),
  ];

  const createItemMut = useMutation({
    mutationFn: () => api.post('/pre-ready/items', { ...itemForm, minimumStock: parseFloat(itemForm.minimumStock) || 0 }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pre-ready-items'] }); setShowAddItem(false); },
  });

  const saveRecipeMut = useMutation({
    mutationFn: () => api.put(`/pre-ready/items/${showRecipe!.id}/recipe`, {
      yieldQuantity: parseFloat(recipeYield.quantity) || 1,
      yieldUnit: recipeYield.unit,
      notes: recipeYield.notes || undefined,
      items: recipeLines.filter((l) => l.ingredientId && parseFloat(l.quantity) > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: parseFloat(l.quantity), unit: l.unit })),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pre-ready-items'] }); setShowRecipe(null); setIngSearch({}); },
  });

  const createProdMut = useMutation({
    mutationFn: () => api.post('/pre-ready/productions', { preReadyItemId: prodForm.preReadyItemId, quantity: parseFloat(prodForm.quantity), notes: prodForm.notes || undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['productions'] }); setShowCreateProd(false); },
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/pre-ready/productions/${id}/${action}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['productions'] }),
  });

  const completeMut = useMutation({
    mutationFn: () => api.post(`/pre-ready/productions/${completing!.id}/complete`, completeForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['productions'] }); void qc.invalidateQueries({ queryKey: ['pre-ready-items'] }); void qc.invalidateQueries({ queryKey: ['pre-ready-batches'] }); setCompleting(null); },
  });

  const updateItemMut = useMutation({
    mutationFn: () => api.patch(`/pre-ready/items/${editingItem!.id}`, {
      name: editForm.name || undefined,
      minimumStock: parseFloat(editForm.minimumStock),
      autoDeductInputs: editForm.autoDeductInputs,
      // Only include unit when admin actually changed it — unchanged
      // units skip the strict gates on the server side.
      ...(editingItem && editForm.unit !== editingItem.unit ? { unit: editForm.unit } : {}),
      // Only send the link field when admin touched it (tri-state on
      // the form). Sending undefined leaves the existing pairing
      // intact; null clears it; string sets/changes it.
      ...(editForm.producesIngredientId !== undefined ? { producesIngredientId: editForm.producesIngredientId } : {}),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      setEditingItem(null);
    },
  });

  const recalcCostMut = useMutation({
    mutationFn: (id: string) => api.post(`/pre-ready/items/${id}/recalc-cost`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
    },
  });

  const recalcAllCostMut = useMutation({
    mutationFn: () => api.post<{ updated: number; total: number }>('/pre-ready/items/recalc-cost-all', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
    },
  });

  const [backfillReport, setBackfillReport] = useState<{
    scanned: number;
    linkedCount: number;
    skippedCount: number;
    linked: Array<{ preReadyName: string }>;
    skipped: Array<{ preReadyName: string; reason: string }>;
  } | null>(null);
  const backfillLinksMut = useMutation({
    mutationFn: () => api.post<typeof backfillReport>('/pre-ready/items/backfill-links', {}),
    onSuccess: (r) => {
      setBackfillReport(r);
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
    },
  });

  const deleteItemMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pre-ready/items/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pre-ready-items'] }); setDeleteError(null); },
    onError: (err: Error) => { setDeleteError(err.message); },
  });

  // ─── Bulk Pre-Ready Recipe CSV ───────────────────────────────────────────
  const bulkMutation = useMutation({
    mutationFn: (rows: typeof bulkRows) =>
      api.post<{ updated: number; skipped: number; errors: string[]; totalRows: number }>('/pre-ready/recipes/bulk', { rows }),
    onSuccess: (data) => {
      setBulkResult(data);
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
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
      const prIdx = header.findIndex((h) => h === 'pre_ready_item_name' || h === 'pre_ready_name' || h === 'preready_name' || h === 'item_name' || h === 'item');
      const yqIdx = header.findIndex((h) => h === 'yield_quantity' || h === 'yield_qty' || h === 'yield');
      const yuIdx = header.findIndex((h) => h === 'yield_unit');
      const ingIdx = header.findIndex((h) => h === 'ingredient_name' || h === 'ingredient');
      const qtyIdx = header.findIndex((h) => h === 'quantity' || h === 'qty');
      const unitIdx = header.findIndex((h) => h === 'unit');

      if (prIdx === -1 || ingIdx === -1 || qtyIdx === -1) {
        alert('CSV must have columns: pre_ready_item_name, ingredient_name, quantity (yield_quantity, yield_unit, unit are optional)');
        return;
      }

      const parsed: typeof bulkRows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const pr = cols[prIdx];
        const ing = cols[ingIdx];
        const qty = parseFloat(cols[qtyIdx]);
        if (!pr || !ing || !qty || isNaN(qty)) continue;
        parsed.push({
          preReadyItemName: pr,
          yieldQuantity: yqIdx >= 0 && cols[yqIdx]?.trim() ? parseFloat(cols[yqIdx]) || undefined : undefined,
          yieldUnit: yuIdx >= 0 ? cols[yuIdx]?.toUpperCase() || undefined : undefined,
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
    const csv = `pre_ready_item_name,yield_quantity,yield_unit,ingredient_name,quantity,unit
Chicken Stock,5,L,Chicken Bones,1,KG
Chicken Stock,5,L,Onion,200,G
Chicken Stock,5,L,Salt,10,G
Fried Onion,500,G,Onion,1,KG
Fried Onion,500,G,Oil,100,ML`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pre-ready-recipes-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Round-trip current pre-ready recipes to the same template. Each pre-ready
  // item emits one row per ingredient; yield_quantity + yield_unit repeat on
  // every row of a group (Excel users edit them together).
  const downloadCurrentPreReadyRecipes = () => {
    const esc = (v: string | number | null | undefined) => {
      const s = (v ?? '').toString();
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const ingById = new Map(ingredients.map((i) => [i.id, i] as const));
    const lines: string[] = [];
    for (const it of items) {
      const r = it.recipe;
      if (!r?.items?.length) continue;
      const yq = Number(r.yieldQuantity ?? 1);
      const yu = r.yieldUnit ?? it.unit;
      for (const ri of r.items) {
        const ing = ingById.get(ri.ingredientId);
        if (!ing) continue;
        lines.push([
          esc(it.name),
          esc(yq),
          esc(yu),
          esc(ing.name),
          esc(Number(ri.quantity)),
          esc(ri.unit ?? ing.unit),
        ].join(','));
      }
    }
    const csv = ['pre_ready_item_name,yield_quantity,yield_unit,ingredient_name,quantity,unit', ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre-ready-recipes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openRecipe = (item: PreReadyItem) => {
    setShowRecipe(item);
    setIngSearch({});
    if (item.recipe) {
      setRecipeLines(item.recipe.items.map((i) => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: i.unit ?? i.ingredient?.unit ?? 'G' })));
      setRecipeYield({ quantity: String(item.recipe.yieldQuantity), unit: item.recipe.yieldUnit, notes: item.recipe.notes ?? '' });
    } else {
      setRecipeLines([]);
      setRecipeYield({ quantity: '1', unit: item.unit, notes: '' });
    }
  };

  const openEditItem = (item: PreReadyItem) => {
    setEditingItem(item);
    setEditForm({
      name: item.name,
      minimumStock: String(Number(item.minimumStock)),
      unit: item.unit,
      autoDeductInputs: (item as { autoDeductInputs?: boolean }).autoDeductInputs !== false,
      // undefined = "untouched" — only send producesIngredientId on the
      // PATCH if admin actually picked or cleared it in the dialog.
      producesIngredientId: undefined,
    });
  };

  const handleDeleteItem = (item: PreReadyItem) => {
    setDeleteError(null);
    if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteItemMut.mutate(item.id);
    }
  };

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">PRE-READY FOODS</h1>
        <div className="flex gap-2">
          {tab === 'items' && (
            <>
              <button
                onClick={() => { setBulkOpen(true); setBulkRows([]); setBulkResult(null); }}
                className="bg-[#2A2A2A] hover:bg-[#D62B2B] text-[#999] hover:text-white font-body text-xs px-4 py-2 tracking-widest uppercase transition-colors"
              >
                Bulk Import CSV
              </button>
              <button
                onClick={() => recalcAllCostMut.mutate()}
                disabled={recalcAllCostMut.isPending}
                title="Refresh cost-per-unit on every pre-ready item from current ingredient costs"
                className="border border-[#FFA726] text-[#FFA726] hover:bg-[#FFA726] hover:text-black font-body text-sm px-4 py-2 transition-colors disabled:opacity-50"
              >
                {recalcAllCostMut.isPending ? 'Recalculating…' : 'Recalculate Costs'}
              </button>
              <button
                onClick={() => {
                  if (!confirm('Auto-link every unlinked pre-ready item to its matching "[PR] <name>" inventory ingredient. Items already linked, name-collisions, and variant-parent ingredients are skipped silently. Re-running is safe.')) return;
                  backfillLinksMut.mutate();
                }}
                disabled={backfillLinksMut.isPending}
                title="One-shot retro-link: pair every unlinked pre-ready item with its matching inventory ingredient"
                className="border border-[#4CAF50] text-[#4CAF50] hover:bg-[#4CAF50] hover:text-black font-body text-sm px-4 py-2 transition-colors disabled:opacity-50"
              >
                {backfillLinksMut.isPending ? 'Linking…' : 'Auto-Link All'}
              </button>
              <button onClick={() => setShowAddItem(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">+ ADD ITEM</button>
            </>
          )}
          {tab === 'production' && <button onClick={() => setShowCreateProd(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">+ NEW PRODUCTION</button>}
        </div>
      </div>

      <div className="flex border-b border-[#2A2A2A]">
        {(['items', 'production', 'batches'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-6 py-3 font-body text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px ${tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Items Tab */}
      {tab === 'items' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          {/* Filters — name search + ingredient filter */}
          <div className="px-4 pt-4 pb-2 border-b border-[#2A2A2A] flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <input
                placeholder="🔍 Search by name…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body focus:outline-none focus:border-[#D62B2B] transition-colors placeholder:text-[#555]"
              />
              {itemSearch && (
                <button onClick={() => setItemSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666] hover:text-white text-xs">{'✕'}</button>
              )}
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <input
                list="pr-ing-filter"
                placeholder="🔍 Filter by ingredient…"
                value={ingredientFilter}
                onChange={(e) => setIngredientFilter(e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-[#C8FF00] px-3 py-2 text-xs font-body focus:outline-none focus:border-[#C8FF00]/50 transition-colors placeholder:text-[#555]"
              />
              <datalist id="pr-ing-filter">
                {ingredients.map((i) => <option key={i.id} value={i.name} />)}
              </datalist>
              {ingredientFilter && (
                <button onClick={() => setIngredientFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666] hover:text-white text-xs">{'✕'}</button>
              )}
            </div>
          </div>
          {deleteError && (
            <div className="mx-4 mt-4 p-3 bg-[#3a1a1a] border border-[#D62B2B] text-[#F03535] font-body text-sm flex items-center justify-between">
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError(null)} className="text-[#666] hover:text-white ml-4">{'\u2715'}</button>
            </div>
          )}
          <table className="w-full">
            <thead><tr className="border-b border-[#2A2A2A]">
              {([
                { label: 'Name', key: 'name' as const },
                { label: 'Unit', key: 'unit' as const },
                { label: 'Stock', key: 'currentStock' as const },
                { label: 'Min', key: 'minimumStock' as const },
                { label: 'Recipe Cost / Yield', key: null },
                { label: 'Cost/Unit', key: 'costPerUnit' as const },
                { label: 'Actions', key: null },
              ]).map((h) => {
                const active = h.key && itemSort?.key === h.key;
                const arrow = active ? (itemSort!.dir === 'asc' ? ' ↑' : ' ↓') : '';
                return (
                  <th
                    key={h.label}
                    onClick={h.key ? () => toggleItemSort(h.key as PrItemSortKey) : undefined}
                    className={`text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase ${h.key ? 'cursor-pointer hover:text-white transition-colors select-none' : ''} ${active ? 'text-white' : ''}`}
                  >
                    {h.label}{arrow}
                  </th>
                );
              })}
            </tr></thead>
            <tbody>
              {filteredSortedItems.map((item) => {
                const isLow = Number(item.minimumStock) > 0 && Number(item.currentStock) <= Number(item.minimumStock);
                const cost = calcPreReadyCost(item, ingredients);
                return (
                  <tr key={item.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-white font-body text-sm">{item.name}</td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">{item.unit}</td>
                    <td className="px-4 py-3"><span className={`font-body text-sm ${isLow ? 'text-[#D62B2B]' : 'text-white'}`}>{Number(item.currentStock).toFixed(2)}{isLow && ' \u25bc'}</span></td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">{Number(item.minimumStock).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {cost ? (
                        <span className="font-body text-xs">
                          <span className="text-[#D62B2B]">{formatCurrency(cost.recipeCost)}</span>
                          <span className="text-[#555]"> / {cost.yieldQty} {item.recipe?.yieldUnit ?? item.unit}</span>
                        </span>
                      ) : (
                        <span className="text-[#444] font-body text-xs">No recipe</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {Number(item.costPerUnit) > 0 ? (
                        <span className="font-body text-xs font-medium text-white">
                          {formatCurrency(Number(item.costPerUnit))}/{item.unit}
                        </span>
                      ) : cost && cost.costPerUnit > 0 ? (
                        <span className="font-body text-xs font-medium text-[#999]" title="Estimated from recipe — click Recalc to cache">
                          ~{formatCurrency(cost.costPerUnit)}/{item.unit}
                        </span>
                      ) : (
                        <span className="text-[#444] font-body text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => openRecipe(item)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Recipe</button>
                      <button
                        onClick={() => recalcCostMut.mutate(item.id)}
                        disabled={recalcCostMut.isPending}
                        title="Refresh the cached cost-per-unit from current ingredient costs"
                        className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors disabled:opacity-50"
                      >Recalc</button>
                      <button onClick={() => openEditItem(item)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Edit</button>
                      <button onClick={() => handleDeleteItem(item)} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">Delete</button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No pre-ready items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Production Tab */}
      {tab === 'production' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead><tr className="border-b border-[#2A2A2A]">
              {['Item', 'Qty', 'Est. Cost', 'Status', 'Requested By', 'Created', 'Actions'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {productions.map((po) => {
                const prItem = items.find((i) => i.id === po.preReadyItemId);
                const prCost = prItem ? calcPreReadyCost(prItem, ingredients) : null;
                const prodQty = Number(po.quantity);
                const ratio = prCost && prCost.yieldQty > 0 ? prodQty / prCost.yieldQty : 0;
                const estTotal = prCost ? prCost.recipeCost * ratio : 0;
                return (
                <tr key={po.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-white font-body text-sm">{po.preReadyItem?.name}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">{prodQty.toFixed(2)} {po.preReadyItem?.unit}</td>
                  <td className="px-4 py-3 text-[#D62B2B] font-body text-xs font-medium">{estTotal > 0 ? formatCurrency(estTotal) : '—'}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[po.status]}`}>{po.status}</span></td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{po.requestedBy?.name}</td>
                  <td className="px-4 py-3 text-[#666] font-body text-xs">{new Date(po.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 flex gap-2">
                    {po.status === 'PENDING' && <button onClick={() => actionMut.mutate({ id: po.id, action: 'approve' })} className="text-[#29B6F6] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Approve</button>}
                    {po.status === 'APPROVED' && <button onClick={() => actionMut.mutate({ id: po.id, action: 'start' })} className="text-[#CE93D8] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Start</button>}
                    {(po.status === 'IN_PROGRESS' || po.status === 'APPROVED') && <button onClick={() => { setCompleting(po); setCompleteForm({ makingDate: new Date().toISOString().split('T')[0], expiryDate: '' }); }} className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Complete</button>}
                    {po.status !== 'COMPLETED' && po.status !== 'CANCELLED' && <button onClick={() => actionMut.mutate({ id: po.id, action: 'cancel' })} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">Cancel</button>}
                  </td>
                </tr>
                );
              })}
              {productions.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No production orders.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Batches Tab */}
      {tab === 'batches' && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead><tr className="border-b border-[#2A2A2A]">
              {['Item', 'Batch Qty', 'Remaining', 'Making Date', 'Expiry Date', 'Status'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {batches.map((b) => {
                const expiry = new Date(b.expiryDate);
                const isExpired = expiry < now;
                const isExpiring = !isExpired && expiry <= threeDaysFromNow;
                return (
                  <tr key={b.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-white font-body text-sm">{b.preReadyItem?.name ?? '\u2014'}</td>
                    <td className="px-4 py-3 text-[#999] font-body text-sm">{Number(b.quantity).toFixed(2)}</td>
                    <td className="px-4 py-3 text-white font-body text-sm">{Number(b.remainingQty).toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(b.makingDate).toLocaleDateString()}</td>
                    <td className={`px-4 py-3 font-body text-xs ${isExpired ? 'text-[#D62B2B]' : isExpiring ? 'text-[#FFA726]' : 'text-[#999]'}`}>{expiry.toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {isExpired ? <span className="text-[#D62B2B] text-xs font-body px-2 py-0.5 bg-[#3a1a1a]">EXPIRED</span> :
                       isExpiring ? <span className="text-[#FFA726] text-xs font-body px-2 py-0.5 bg-[#3a2e00]">EXPIRING</span> :
                       <span className="text-[#4CAF50] text-xs font-body px-2 py-0.5 bg-[#1a3a1a]">FRESH</span>}
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#666] font-body text-sm">No active batches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Dialog */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowAddItem(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">ADD PRE-READY ITEM</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Name *</label><input value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Unit</label><select value={itemForm.unit} onChange={(e) => setItemForm((f) => ({ ...f, unit: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
                <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Min Stock</label><input type="number" value={itemForm.minimumStock} onChange={(e) => setItemForm((f) => ({ ...f, minimumStock: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddItem(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => createItemMut.mutate()} disabled={!itemForm.name || createItemMut.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{createItemMut.isPending ? 'Creating\u2026' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Dialog */}
      {/* Backfill-links report modal — shown after the "Auto-Link All"
          button finishes. Lists every PR that got linked + every PR
          that was skipped with the reason, so admin can decide which
          skipped items need manual attention via the picker. */}
      {backfillReport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setBackfillReport(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg p-6 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-4">AUTO-LINK REPORT</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-center">
                <p className="text-2xl font-display text-white">{backfillReport.scanned}</p>
                <p className="text-[10px] tracking-widest uppercase text-[#666] mt-1">Scanned</p>
              </div>
              <div className="bg-[#0D0D0D] border border-[#4CAF50] p-3 text-center">
                <p className="text-2xl font-display text-[#4CAF50]">{backfillReport.linkedCount}</p>
                <p className="text-[10px] tracking-widest uppercase text-[#666] mt-1">Linked</p>
              </div>
              <div className="bg-[#0D0D0D] border border-[#FFA726] p-3 text-center">
                <p className="text-2xl font-display text-[#FFA726]">{backfillReport.skippedCount}</p>
                <p className="text-[10px] tracking-widest uppercase text-[#666] mt-1">Skipped</p>
              </div>
            </div>
            {backfillReport.linked.length > 0 && (
              <div className="mb-4">
                <p className="text-[#4CAF50] text-xs font-body tracking-widest uppercase mb-2">Newly linked</p>
                <ul className="text-[#DDD] font-body text-xs space-y-1 max-h-32 overflow-auto">
                  {backfillReport.linked.map((l, i) => <li key={i}>· {l.preReadyName}</li>)}
                </ul>
              </div>
            )}
            {backfillReport.skipped.length > 0 && (
              <div>
                <p className="text-[#FFA726] text-xs font-body tracking-widest uppercase mb-2">Skipped — manual decision needed</p>
                <ul className="text-[#DDD] font-body text-xs space-y-1 max-h-40 overflow-auto">
                  {backfillReport.skipped.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>· {s.preReadyName}</span>
                      <span className="text-[#666] text-[10px]">{s.reason}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[#666] font-body text-[10px] mt-2">
                  Use the manual picker on each pre-ready item's edit dialog to resolve these.
                </p>
              </div>
            )}
            <button
              onClick={() => setBackfillReport(null)}
              className="mt-4 w-full bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {editingItem && <EditItemDialog
        item={editingItem}
        form={editForm}
        setForm={setEditForm}
        units={UNITS}
        saving={updateItemMut.isPending}
        error={updateItemMut.error as Error | null}
        onCancel={() => setEditingItem(null)}
        onSave={() => updateItemMut.mutate()}
      />}

      {/* Recipe Editor Dialog */}
      {showRecipe && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => { setShowRecipe(null); setIngSearch({}); }}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-1">RECIPE: {showRecipe.name}</h2>
            <p className="text-[#666] font-body text-xs mb-4">Define ingredients needed to produce this pre-ready item.</p>

            {/* Yield explanation */}
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4 mb-4 space-y-3">
              <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Recipe Yield</p>
              <p className="text-[#999] font-body text-xs leading-relaxed">
                "This recipe produces <strong className="text-white">{recipeYield.quantity || '?'} {recipeYield.unit}</strong> of {showRecipe.name}."
                When staff produces a different quantity, ingredients are scaled proportionally.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body tracking-widest uppercase">Yield Qty *</label>
                  <input type="number" step="0.01" min="0.01" value={recipeYield.quantity} onChange={(e) => setRecipeYield((f) => ({ ...f, quantity: e.target.value }))} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body tracking-widest uppercase">Yield Unit</label>
                  <div className="flex items-center gap-2">
                    <select value={recipeYield.unit} onChange={(e) => setRecipeYield((f) => ({ ...f, unit: e.target.value }))} className="flex-1 bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                      {getConvertibleUnitsLocal(showRecipe.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  {recipeYield.unit !== showRecipe.unit && (
                    <p className="text-[#FFA726] font-body text-[10px]">
                      Item stored in {showRecipe.unit} — will auto-convert
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body tracking-widest uppercase">Notes</label>
                  <input value={recipeYield.notes} onChange={(e) => setRecipeYield((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. Makes 1 batch" className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                </div>
              </div>
              {/* Production scaling example */}
              {parseFloat(recipeYield.quantity) > 0 && recipeLines.some((l) => l.ingredientId && parseFloat(l.quantity) > 0) && (
                <div className="border-t border-[#2A2A2A] pt-2 mt-2">
                  <p className="text-[#666] font-body text-[10px]">
                    Example: Producing {(parseFloat(recipeYield.quantity) * 2).toFixed(1)} {recipeYield.unit} → all ingredients below are multiplied by 2×
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {/* Autofill + Ingredients header */}
              <div className="flex items-center justify-between">
                <p className="text-[#666] text-xs font-body tracking-widest uppercase">Ingredients (for 1× recipe = {recipeYield.quantity} {recipeYield.unit})</p>
                <div className="relative">
                  <button
                    onClick={() => setShowAutofillPR(!showAutofillPR)}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] hover:border-[#D62B2B] text-[#999] hover:text-white font-body text-xs px-3 py-1 transition-colors"
                  >
                    Autofill ▾
                  </button>
                  {showAutofillPR && (
                    <div className="absolute top-full right-0 mt-1 z-20 bg-[#161616] border border-[#2A2A2A] w-56 shadow-lg">
                      <button
                        onClick={() => { setShowAutofillPR(false); setShowCopyFromPR(true); setCopySearchPR(''); }}
                        className="w-full text-left px-3 py-2.5 text-sm font-body text-[#999] hover:bg-[#1F1F1F] hover:text-white transition-colors border-b border-[#2A2A2A]"
                      >
                        Copy from existing recipe
                        <span className="block text-[10px] text-[#666] mt-0.5">Menu items & Pre-Ready</span>
                      </button>
                      <button
                        onClick={() => { setShowAutofillPR(false); csvInputRefPR.current?.click(); }}
                        className="w-full text-left px-3 py-2.5 text-sm font-body text-[#999] hover:bg-[#1F1F1F] hover:text-white transition-colors border-b border-[#2A2A2A]"
                      >
                        Upload CSV
                        <span className="block text-[10px] text-[#666] mt-0.5">Import ingredients from file</span>
                      </button>
                      <button
                        onClick={() => { setShowAutofillPR(false); downloadPRExampleCSV(); }}
                        className="w-full text-left px-3 py-2 text-xs font-body text-[#666] hover:bg-[#1F1F1F] hover:text-[#999] transition-colors"
                      >
                        ↓ Download CSV template
                      </button>
                    </div>
                  )}
                </div>
                <input ref={csvInputRefPR} type="file" accept=".csv" onChange={handlePRCSVUpload} className="hidden" />
              </div>
              {Object.keys(csvErrorsPR).length > 0 && (
                <p className="text-[#FFA726] font-body text-[10px]">{Object.keys(csvErrorsPR).length} issue(s) from CSV — check red borders below</p>
              )}
              {recipeLines.map((line, idx) => {
                const selectedIngredient = ingredients.find((i) => i.id === line.ingredientId);
                const nativeUnit = selectedIngredient?.unit ?? 'G';
                const convertibleUnits = getConvertibleUnitsLocal(nativeUnit);
                const qty = parseFloat(line.quantity) || 0;
                const showConvHelper = selectedIngredient && line.unit !== nativeUnit && qty > 0;
                let convertedDisplay = '';
                if (showConvHelper) {
                  const converted = convertLocally(qty, line.unit, nativeUnit);
                  convertedDisplay = converted !== null ? `= ${converted.toFixed(4).replace(/\.?0+$/, '')} ${nativeUnit} will be deducted from stock` : '(no conversion available)';
                }
                // Check if a pre-ready item was selected (for info message)
                const searchVal = ingSearch[idx] !== undefined ? ingSearch[idx] : '';
                const preReadyMatch = searchVal && allSelectableItems.some((i) => i.type === 'preready' && `${i.name} (${i.unit})` === searchVal);
                const csvErrPR = csvErrorsPR[idx + 1];
                return (
                <div key={idx} className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5 relative">
                      <input
                        list={`ing-list-${idx}`}
                        value={ingSearch[idx] !== undefined ? ingSearch[idx] : (selectedIngredient ? `${selectedIngredient.name} (${selectedIngredient.unit})` : '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          setIngSearch((s) => ({ ...s, [idx]: val }));
                          if (csvErrPR) setCsvErrorsPR((errs) => { const next = { ...errs }; delete next[idx + 1]; return next; });
                          const match = allSelectableItems.find((i) => i.type === 'ingredient' && (`${i.name} (${i.unit})` === val || i.itemCode === val));
                          if (match) {
                            setRecipeLines((l) => l.map((item, i) => i === idx ? { ...item, ingredientId: match.id, unit: match.unit } : item));
                            setIngSearch((s) => { const next = { ...s }; delete next[idx]; return next; });
                          }
                        }}
                        onFocus={(e) => e.target.select()}
                        placeholder="Type to search..."
                        className={`w-full bg-[#0D0D0D] border text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] ${csvErrPR ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'}`}
                      />
                      <datalist id={`ing-list-${idx}`}>
                        {allSelectableItems.filter((i) => {
                          const s = (ingSearch[idx] ?? '').toLowerCase().trim();
                          return !s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s);
                        }).slice(0, 30).map((i) => (
                          <option key={i.id} value={`${i.name} (${i.unit})`}>{i.itemCode ? `[${i.itemCode}] ` : ''}{i.name}</option>
                        ))}
                      </datalist>
                      {preReadyMatch && (
                        <p className="text-[#FFA726] font-body text-xs mt-1">This is a Pre-Ready item. Add it to Inventory to use in recipes.</p>
                      )}
                      {csvErrPR && (
                        <p className="text-[#D62B2B] font-body text-[10px] mt-0.5">{csvErrPR}</p>
                      )}
                    </div>
                    <div className="col-span-3">
                      <input type="number" step="0.001" min="0" value={line.quantity} onChange={(e) => setRecipeLines((l) => l.map((item, i) => i === idx ? { ...item, quantity: e.target.value } : item))} className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={line.unit}
                        onChange={(e) => setRecipeLines((l) => l.map((item, i) => i === idx ? { ...item, unit: e.target.value } : item))}
                        className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                      >
                        {convertibleUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => setRecipeLines((l) => l.filter((_, i) => i !== idx))} className="text-[#666] hover:text-[#D62B2B] font-body text-xs transition-colors">{'\u2715'}</button>
                    </div>
                  </div>
                  {showConvHelper && (
                    <p className="text-[#666] font-body text-xs pl-1">{convertedDisplay}</p>
                  )}
                </div>
                );
              })}
              <button onClick={() => setRecipeLines((l) => [...l, { ingredientId: '', quantity: '0', unit: 'G' }])} className="text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors border border-dashed border-[#2A2A2A] hover:border-[#D62B2B] w-full py-2">+ Add Ingredient</button>
            </div>
            {saveRecipeMut.error && <p className="text-[#F03535] text-xs font-body mt-2">{(saveRecipeMut.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowRecipe(null); setIngSearch({}); }} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => saveRecipeMut.mutate()} disabled={saveRecipeMut.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{saveRecipeMut.isPending ? 'Saving\u2026' : 'Save Recipe'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Production Dialog */}
      {showCreateProd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowCreateProd(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">NEW PRODUCTION ORDER</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Pre-Ready Item *</label><select value={prodForm.preReadyItemId} onChange={(e) => setProdForm((f) => ({ ...f, preReadyItemId: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"><option value="">-- Select --</option>{items.filter((i) => i.isActive).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></div>
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Quantity *</label><input type="number" step="0.01" min="0" value={prodForm.quantity} onChange={(e) => setProdForm((f) => ({ ...f, quantity: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Notes</label><input value={prodForm.notes} onChange={(e) => setProdForm((f) => ({ ...f, notes: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>

              {/* Estimated production cost */}
              {(() => {
                const selItem = items.find((i) => i.id === prodForm.preReadyItemId);
                if (!selItem) return null;
                const cost = calcPreReadyCost(selItem, ingredients);
                if (!cost) return null;
                const prodQty = parseFloat(prodForm.quantity) || 0;
                const ratio = cost.yieldQty > 0 ? prodQty / cost.yieldQty : 0;
                const totalCost = cost.recipeCost * ratio;
                const costPerUnit = prodQty > 0 ? totalCost / prodQty : 0;
                return (
                  <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-1">
                    <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase">Estimated Cost</p>
                    <div className="flex justify-between">
                      <span className="text-[#999] font-body text-xs">Recipe cost ({cost.yieldQty} {selItem.recipe?.yieldUnit ?? selItem.unit})</span>
                      <span className="text-white font-body text-xs">{formatCurrency(cost.recipeCost)}</span>
                    </div>
                    {prodQty > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[#999] font-body text-xs">Production ({prodQty} {selItem.unit}) × {ratio.toFixed(2)}</span>
                          <span className="text-[#D62B2B] font-body text-sm font-medium">{formatCurrency(totalCost)}</span>
                        </div>
                        <div className="flex justify-between border-t border-[#2A2A2A] pt-1 mt-1">
                          <span className="text-[#999] font-body text-xs">Cost per {selItem.unit}</span>
                          <span className="text-white font-body text-xs font-medium">{formatCurrency(costPerUnit)}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateProd(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => createProdMut.mutate()} disabled={!prodForm.preReadyItemId || createProdMut.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{createProdMut.isPending ? 'Creating\u2026' : 'Create Order'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Production Dialog */}
      {completing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setCompleting(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-1">COMPLETE PRODUCTION</h2>
            <p className="text-[#999] font-body text-sm mb-6">{completing.preReadyItem?.name} -- {Number(completing.quantity).toFixed(2)} {completing.preReadyItem?.unit}</p>
            <div className="space-y-4">
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Making Date *</label><input type="date" value={completeForm.makingDate} onChange={(e) => setCompleteForm((f) => ({ ...f, makingDate: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Expiry Date *</label><input type="date" value={completeForm.expiryDate} onChange={(e) => setCompleteForm((f) => ({ ...f, expiryDate: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
            </div>
            {completeMut.error && <p className="text-[#F03535] text-xs font-body mt-3">{(completeMut.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setCompleting(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => completeMut.mutate()} disabled={!completeForm.expiryDate || completeMut.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{completeMut.isPending ? 'Completing\u2026' : 'Complete'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Copy from existing recipe modal — additive: tapping a source
          merges its lines into the working recipe (sums any duplicate
          ingredient by id+unit). Modal stays open for stacking. */}
      {showCopyFromPR && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={() => { setShowCopyFromPR(false); setLastCopiedPR(null); }}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2A2A2A]">
              <h2 className="font-display text-lg text-white tracking-widest">COPY RECIPE FROM</h2>
              <p className="text-[#666] font-body text-xs mt-1">Tap a source to add its ingredients. Duplicate ingredients (same unit) are summed. Stack multiple sources, then click Done.</p>
              <input
                value={copySearchPR}
                onChange={(e) => setCopySearchPR(e.target.value)}
                placeholder="Search items…"
                className="w-full mt-3 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {allCopySources
                .filter((s) => !copySearchPR || s.name.toLowerCase().includes(copySearchPR.toLowerCase()))
                .map((source) => {
                  const justCopied = lastCopiedPR === source.id;
                  return (
                    <button
                      key={`${source.type}-${source.id}`}
                      onClick={() => source.type === 'menu' ? void handlePRCopyFromMenu(source.id) : handlePRCopyFromPreReady(source.id)}
                      className={`w-full text-left px-5 py-3 border-b border-[#2A2A2A] transition-colors flex items-center justify-between gap-2 ${justCopied ? 'bg-[#4CAF50]/10' : 'hover:bg-[#1F1F1F]'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-white font-body text-sm">{source.name}</span>
                        <span className="text-[#666] font-body text-xs ml-2">{source.type === 'preready' ? 'Pre-Ready' : 'Menu Item'}</span>
                      </span>
                      {justCopied && (
                        <span className="text-[#4CAF50] font-body text-[10px] tracking-widest uppercase whitespace-nowrap">✓ Copied</span>
                      )}
                    </button>
                  );
                })}
              {allCopySources.filter((s) => !copySearchPR || s.name.toLowerCase().includes(copySearchPR.toLowerCase())).length === 0 && (
                <p className="px-5 py-8 text-center text-[#666] font-body text-sm">No items with recipes found.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[#2A2A2A]">
              <button onClick={() => { setShowCopyFromPR(false); setLastCopiedPR(null); }} className="w-full bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2 transition-colors">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Pre-Ready Recipe CSV Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setBulkOpen(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl text-white tracking-widest">BULK PRE-READY RECIPE IMPORT</h2>
                <p className="font-body text-[#666] text-xs mt-1">
                  One row per ingredient. Group by pre-ready item. Existing recipes are overwritten.
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
                    onClick={downloadCurrentPreReadyRecipes}
                    className="w-full border border-[#2A2A2A] hover:border-[#C8FF00] text-[#999] hover:text-white font-body text-sm px-4 py-3 transition-colors tracking-widest uppercase"
                  >
                    ↓ Export Current Pre-Ready Recipes
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
                    <p><span className="text-[#C8FF00]">pre_ready_item_name</span> — must match an existing pre-ready item (case-insensitive)</p>
                    <p><span className="text-[#C8FF00]">ingredient_name</span> — match inventory ingredient by name</p>
                    <p><span className="text-[#C8FF00]">quantity</span> — numeric</p>
                    <p><span className="text-[#888]">yield_quantity + yield_unit</span> — optional; first row of each group wins, defaults to the pre-ready item's own unit</p>
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
                          <th className="px-3 py-2 text-left">Pre-Ready</th>
                          <th className="px-3 py-2 text-right">Yield</th>
                          <th className="px-3 py-2 text-left">Ingredient</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r, i) => (
                          <tr key={i} className="border-t border-[#2A2A2A] text-white">
                            <td className="px-3 py-1.5 text-[#666]">{i + 1}</td>
                            <td className="px-3 py-1.5">{r.preReadyItemName}</td>
                            <td className="px-3 py-1.5 text-right text-[#999]">{r.yieldQuantity ? `${r.yieldQuantity} ${r.yieldUnit ?? ''}` : '—'}</td>
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
                    {new Set(bulkRows.map((r) => r.preReadyItemName.toLowerCase())).size} pre-ready item
                    {new Set(bulkRows.map((r) => r.preReadyItemName.toLowerCase())).size !== 1 ? 's' : ''} ready to import
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

// ─── Edit Item Dialog ─────────────────────────────────────────────
//
// Unit on a pre-ready item is destructive to change — every Decimal
// that counts the item (currentStock, batch qty, mirror Ingredient
// stock, active production-order qty) is denominated in the unit.
// Server gates the change behind "every on-hand source is zero +
// no active production orders". The UI surfaces:
//   - the live stock so admin can see why the unit is locked,
//   - a list of menu recipes that reference the [PR] mirror
//     ingredient so admin knows what they need to re-edit after
//     flipping unit (recipe quantities are in their own unit and
//     don't auto-translate).
function EditItemDialog({
  item,
  form,
  setForm,
  units,
  saving,
  error,
  onCancel,
  onSave,
}: {
  item: PreReadyItem;
  form: { name: string; minimumStock: string; unit: string; autoDeductInputs: boolean; producesIngredientId: string | null | undefined };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; minimumStock: string; unit: string; autoDeductInputs: boolean; producesIngredientId: string | null | undefined }>>;
  units: string[];
  saving: boolean;
  error: Error | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  const stockOnHand = Number(item.currentStock ?? 0);
  const liveBatches = (item.batches ?? []).filter((b) => Number(b.remainingQty) > 0).length;
  const unitLocked = stockOnHand > 0 || liveBatches > 0;
  const unitChanged = form.unit !== item.unit;

  // Pulled lazily — only when admin actually intends to change the
  // unit, since the warning is only relevant in that case.
  const { data: menuRecipes } = useQuery<{ mirrorUnit: string | null; recipes: Array<{ recipeItemId: string; menuItemId: string; menuItemName: string; quantity: number; unit: string }> }>({
    queryKey: ['pre-ready-menu-recipes', item.id],
    queryFn: () => api.get(`/pre-ready/items/${item.id}/menu-recipes`),
    enabled: unitChanged,
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-white tracking-widest mb-6">EDIT ITEM</h2>
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body tracking-widest uppercase">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body tracking-widest uppercase">Minimum Stock</label>
            <input type="number" step="0.01" value={form.minimumStock} onChange={(e) => setForm((f) => ({ ...f, minimumStock: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body tracking-widest uppercase">Unit</label>
            {unitLocked ? (
              <>
                <input value={item.unit} disabled className="bg-[#0D0D0D] border border-[#2A2A2A] text-[#666] px-3 py-2 text-sm font-body cursor-not-allowed" />
                <p className="text-[#FFA726] font-body text-xs">
                  Unit is locked because{' '}
                  {stockOnHand > 0 && <>currentStock = {stockOnHand} {item.unit}</>}
                  {stockOnHand > 0 && liveBatches > 0 && ' and '}
                  {liveBatches > 0 && <>{liveBatches} batch{liveBatches > 1 ? 'es have' : ' has'} remaining stock</>}
                  . Run <strong>Data Cleanup → Set all pre-ready stock to 0</strong> (or use up the stock) before changing the unit.
                </p>
              </>
            ) : (
              <select
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              >
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
          </div>

          {/* Inventory ↔ Pre-Ready link panel.
              Auto-link: the link gets stamped automatically the first
              time a production batch finishes (system creates / reuses
              an "[PR] <name>" Ingredient row).
              Manual link: this picker lets admin point the pre-ready
              at any inventory ingredient — useful when the auto-link
              never ran, the names diverged from the "[PR] <name>"
              convention, or admin wants to repoint after a rename.
              Once linked, every menu sale that consumes the linked
              Ingredient also decrements this PreReadyItem. */}
          <PreReadyLinkPanel item={item} form={form} setForm={setForm} />

          <label className="flex items-start gap-2 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoDeductInputs}
              onChange={(e) => setForm((f) => ({ ...f, autoDeductInputs: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-[#DDD] font-body text-xs">
              Auto-deduct input ingredients on production
              <span className="block text-[#666] text-[10px]">
                When OFF, completing a production batch only adds the produced output and skips deducting the recipe's input ingredients from inventory. Use only if you reconcile raw stock manually.
              </span>
            </span>
          </label>
        </div>

        {/* Menu-recipe impact warning. The [PR] mirror ingredient's
            unit flips with the pre-ready unit, so any menu recipe
            line that says "use 50 G of [PR] Sauce" still has its
            qty in G — admin must re-enter the line in the new unit
            (or rely on a unit conversion that probably doesn't
            exist for this pre-ready). */}
        {unitChanged && menuRecipes && menuRecipes.recipes.length > 0 && (
          <div className="mt-4 bg-[#1A1A1A] border border-[#FFA726] p-3">
            <p className="text-[#FFA726] font-body text-xs font-medium uppercase tracking-widest mb-2">
              {menuRecipes.recipes.length} menu recipe{menuRecipes.recipes.length > 1 ? 's' : ''} use{menuRecipes.recipes.length > 1 ? '' : 's'} this pre-ready
            </p>
            <p className="text-[#999] font-body text-[11px] mb-2">
              Their RecipeItem qty is denominated in {menuRecipes.mirrorUnit ?? '(unknown)'}. After changing the unit you should re-edit each one so the deduction math stays correct:
            </p>
            <ul className="text-[#DDD] font-body text-xs space-y-0.5 max-h-32 overflow-auto">
              {menuRecipes.recipes.map((r) => (
                <li key={r.recipeItemId} className="flex justify-between">
                  <span>{r.menuItemName}</span>
                  <span className="text-[#666]">{r.quantity} {r.unit}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-[#F03535] text-xs font-body mt-2">{error.message}</p>}
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
          <button onClick={onSave} disabled={!form.name || saving} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inventory ↔ Pre-Ready manual link panel embedded inside the
 * EditItemDialog. Reads /ingredients (admins already have access),
 * lets admin pick / change / clear the pairing. Tri-state form
 * value (undefined / null / id) lets the parent skip the field on
 * the PATCH when admin didn't touch it — preserving any existing
 * auto-stamped link.
 */
function PreReadyLinkPanel({
  item,
  form,
  setForm,
}: {
  item: PreReadyItem;
  form: { producesIngredientId: string | null | undefined };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; minimumStock: string; unit: string; autoDeductInputs: boolean; producesIngredientId: string | null | undefined }>>;
}) {
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
  });

  // Persisted value on the PreReadyItem row (stamped by auto-link or
  // by a previous manual save). The picker reads this when the form
  // hasn't been touched yet (form.producesIngredientId === undefined).
  const persistedLinkId = (item as { producesIngredientId?: string | null }).producesIngredientId ?? null;
  const effectiveId = form.producesIngredientId !== undefined
    ? form.producesIngredientId
    : persistedLinkId;
  const linked = ingredients.find((i) => i.id === effectiveId) || null;

  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Guard: linking a variant-parent ingredient won't work cleanly —
  // production yield needs to land on a single Ingredient row, not
  // be split across variants. Strip parents from the picker.
  const pickable = ingredients.filter((i) => !(i as { hasVariants?: boolean }).hasVariants);
  const filtered = search.trim()
    ? pickable.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : pickable.slice(0, 50);

  const dirty = form.producesIngredientId !== undefined && form.producesIngredientId !== persistedLinkId;

  return (
    <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">
          Linked Inventory Ingredient
        </p>
        {dirty && <span className="text-[#FFA726] text-[10px] font-body uppercase tracking-widest">unsaved</span>}
      </div>

      {linked ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-body text-sm truncate">{linked.name}</p>
            <p className="text-[#666] font-body text-[10px] uppercase tracking-widest">
              {(linked as { itemCode?: string | null }).itemCode ?? linked.unit} · stock {Number(linked.currentStock).toFixed(2)} {linked.unit}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => { setSearch(''); setPickerOpen(true); }}
              className="bg-[#161616] border border-[#2A2A2A] text-white text-[10px] font-body uppercase tracking-widest px-2.5 py-1 hover:border-[#D62B2B]"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, producesIngredientId: null }))}
              className="bg-[#161616] border border-[#2A2A2A] text-[#FFA726] text-[10px] font-body uppercase tracking-widest px-2.5 py-1 hover:border-[#FFA726]"
            >
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[#999] font-body text-[11px]">
            Not linked. Either complete a production batch (auto-creates the link),
            or pick an existing inventory ingredient manually below.
          </p>
          <button
            type="button"
            onClick={() => { setSearch(''); setPickerOpen(true); }}
            className="bg-[#161616] border border-[#2A2A2A] text-white text-[10px] font-body uppercase tracking-widest px-2.5 py-1 hover:border-[#D62B2B] shrink-0"
          >
            Link
          </button>
        </div>
      )}

      <p className="text-[#666] font-body text-[10px]">
        Once linked, every menu sale that consumes the linked Ingredient also decrements
        this pre-ready stock. <strong className="text-[#FFA726]">Be careful</strong>: if both
        counters already hold stock, linking will cause future sales to deduct twice the visible
        rate until reconciled. Take a one-time stock count after linking.
      </p>

      {pickerOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={() => setPickerOpen(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg text-white tracking-widest mb-3">PICK INVENTORY INGREDIENT</h3>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients…"
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] mb-3"
            />
            <div className="flex-1 overflow-auto space-y-1">
              {filtered.length === 0 ? (
                <p className="text-[#666] text-xs text-center py-6">No matches.</p>
              ) : filtered.map((ing) => (
                <button
                  key={ing.id}
                  onClick={() => { setForm((f) => ({ ...f, producesIngredientId: ing.id })); setPickerOpen(false); }}
                  className="w-full text-left px-3 py-2 bg-[#0D0D0D] hover:bg-[#1A1A1A] border border-transparent hover:border-[#D62B2B]"
                >
                  <p className="text-white text-sm font-body">{ing.name}</p>
                  <p className="text-[#666] text-[10px] uppercase tracking-widest">
                    stock {Number(ing.currentStock).toFixed(2)} {ing.unit} · cost {(Number(ing.costPerUnit) / 100).toFixed(2)} / {ing.unit}
                  </p>
                </button>
              ))}
            </div>
            <button
              onClick={() => setPickerOpen(false)}
              className="mt-3 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

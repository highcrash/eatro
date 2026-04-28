import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, Minus, Plus } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { useCartStore, type CartAddon } from '../store/cart.store';
import { apiUrl } from '../lib/api';
import { useSessionStore } from '../store/session.store';

interface BranchSettingsLite {
  qrAllowSelfRemoveIngredients?: boolean;
}

interface RecipeIngredient {
  id: string;
  ingredient: { id: string; name: string };
}

export default function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const branchId = useSessionStore((s) => s.branchId);
  const branchName = useSessionStore((s) => s.branchName);
  const { addItem, items: cart } = useCartStore();
  const [qty, setQty] = useState(1);
  const [picks, setPicks] = useState<Map<string, CartAddon>>(new Map());
  const [notes, setNotes] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  // Fetch the item directly by id. The list endpoint hides variant
  // children + addon items, so falling through `data.items.find()`
  // gave a perpetual black "Loading…" screen for any variant child
  // (or any item the cached list hadn't loaded yet). The single-item
  // endpoint always resolves it.
  const { data: itemFetched, isLoading: itemLoading, isError: itemError } = useQuery<MenuItem | null>({
    queryKey: ['qr-menu-item', branchId, itemId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/menu/${branchId || 'default'}/item/${itemId}`));
      if (!res.ok) return null;
      return (await res.json()) as MenuItem;
    },
    enabled: !!itemId && !!branchId,
  });

  // Still pull the menu list so the cart count + nav header behave
  // exactly like before (no breaking changes to the rest of this page).
  const { data } = useQuery<{ categories: unknown[]; items: MenuItem[] }>({
    queryKey: ['qr-menu', branchId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/menu/${branchId || 'default'}`));
      if (!res.ok) throw new Error('Menu fetch failed');
      return res.json();
    },
    enabled: !!branchId,
  });

  // Branch settings — drives whether the customer sees the structured
  // ingredient-removal checkboxes or only the free-text Special Note.
  const { data: settings } = useQuery<BranchSettingsLite>({
    queryKey: ['qr-public-settings', branchId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/branch/${branchId}/settings`));
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!branchId,
  });
  const allowSelfRemove = !!settings?.qrAllowSelfRemoveIngredients;

  // Single-item endpoint is authoritative. Fall back to the cached
  // list only if the dedicated fetch returned nothing AND the list
  // happens to have the row (rare race).
  const item = itemFetched ?? data?.items.find((m) => m.id === itemId);

  // Recipe lookup (only fetched when self-remove is on). Uses the same
  // public endpoint pattern; falls back gracefully when the endpoint
  // is missing or the menu item has no recipe.
  const { data: recipe } = useQuery<{ items: RecipeIngredient[] } | null>({
    queryKey: ['qr-public-recipe', itemId],
    queryFn: async () => {
      try {
        const res = await fetch(apiUrl(`/public/menu/recipe/${itemId}`));
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    },
    enabled: !!itemId && allowSelfRemove,
  });

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const groups = useMemo(
    () => (item?.addonGroups ?? []).filter((g) => g.options.length > 0),
    [item],
  );

  const picksByGroup = useMemo(() => {
    const m = new Map<string, CartAddon[]>();
    for (const p of picks.values()) {
      const arr = m.get(p.groupId) ?? [];
      arr.push(p);
      m.set(p.groupId, arr);
    }
    return m;
  }, [picks]);

  if (!item) {
    // Still fetching — show loader. If both fetches finished and
    // nothing came back (404 / deleted / wrong branch), surface a
    // clear message + a back button so the user isn't trapped on a
    // black "Loading…" screen forever.
    if (itemLoading) {
      return (
        <div className="flex items-center justify-center h-screen bg-[#0D0D0D] text-sm text-[#666] font-body">Loading…</div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0D0D0D] text-sm text-[#666] font-body gap-4 px-6 text-center">
        <p>{itemError ? 'Could not load this item.' : 'This item is no longer available.'}</p>
        <button onClick={() => void navigate('/menu')} className="bg-[#C8FF00] text-[#0D0D0D] px-5 py-2 font-medium">Back to menu</button>
      </div>
    );
  }

  const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const addonsTotal = [...picks.values()].reduce((s, p) => s + p.price, 0);
  const unitPrice = Number(item.price) + addonsTotal;
  const unmet = groups.filter((g) => (picksByGroup.get(g.id)?.length ?? 0) < g.minPicks);
  const canAdd = unmet.length === 0;

  const togglePick = (g: { id: string; name: string; maxPicks: number }, addon: { id: string; name: string; price: number }) => {
    const k = `${g.id}:${addon.id}`;
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(k)) { next.delete(k); return next; }
      const inGroup = [...next.values()].filter((p) => p.groupId === g.id);
      if (inGroup.length >= g.maxPicks) {
        // FIFO drop the oldest pick in this group.
        next.delete(`${g.id}:${inGroup[0].addonItemId}`);
      }
      next.set(k, { groupId: g.id, groupName: g.name, addonItemId: addon.id, addonName: addon.name, price: addon.price });
      return next;
    });
  };

  const toggleRemoved = (id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (!canAdd) return;
    // When self-remove is on, fold the removed-ingredient names into
    // the line's notes field — server still respects the
    // qrAllowSelfRemoveIngredients toggle, but kitchen sees a clear
    // "NO X / NO Y" string. (Using notes keeps the wire shape v1.)
    let combinedNotes = notes.trim();
    if (allowSelfRemove && removed.size > 0 && recipe) {
      const removedNames = recipe.items
        .filter((ri) => removed.has(ri.ingredient.id))
        .map((ri) => `NO ${ri.ingredient.name.toUpperCase()}`);
      const prefix = removedNames.join(' • ');
      combinedNotes = combinedNotes ? `${prefix} | ${combinedNotes}` : prefix;
    }
    addItem(item, {
      addons: picks.size > 0 ? [...picks.values()] : undefined,
      notes: combinedNotes || undefined,
      quantity: qty,
    });
    void navigate(-1);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D]/90 backdrop-blur px-5 py-3 flex items-center justify-between">
        <button onClick={() => void navigate(-1)} className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white">
          <ArrowLeft size={16} />
        </button>
        <span className="font-display text-xl text-white tracking-wider">{branchName || 'Your Restaurant'}</span>
        {cartCount > 0 ? (
          <button onClick={() => void navigate('/cart')} className="relative w-9 h-9 bg-[#C8FF00] flex items-center justify-center">
            <ShoppingCart size={14} className="text-[#0D0D0D]" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#0D0D0D] text-[#C8FF00] text-[9px] font-body font-medium flex items-center justify-center border border-[#C8FF00]">
              {cartCount}
            </span>
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>

      {/* Hero image */}
      <div className="aspect-square bg-[#111] overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">
            {item.type === 'BEVERAGE' ? '🥤' : '🍽️'}
          </div>
        )}
      </div>

      {/* Item details */}
      <div className="px-5 py-5">
        <h1 className="font-display text-3xl text-white tracking-wider">{item.name}</h1>

        {item.description && (
          <p className="text-sm text-[#888] font-body mt-2 leading-relaxed">{item.description}</p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-xs font-body text-[#C8FF00] bg-[#C8FF00]/10 px-3 py-1.5">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Price */}
        <div className="mt-6 border-t border-[#2A2A2A] pt-5">
          <p className="font-display text-2xl text-white tracking-wider">{formatCurrency(unitPrice)}</p>
          {addonsTotal > 0 && (
            <p className="text-[11px] text-[#888] font-body mt-1">Base {formatCurrency(item.price)} + addons {formatCurrency(addonsTotal)}</p>
          )}
        </div>

        {/* Addon groups */}
        {groups.length > 0 && (
          <div className="mt-6 space-y-4">
            {groups.map((g) => {
              const here = picksByGroup.get(g.id) ?? [];
              const need = g.minPicks > 0 && here.length < g.minPicks;
              return (
                <div key={g.id} className="border border-[#2A2A2A] bg-[#1A1A1A] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-body font-medium text-sm text-white">{g.name}</p>
                    <p className={`text-[10px] font-body uppercase tracking-widest ${need ? 'text-[#F03535]' : 'text-[#888]'}`}>
                      {g.minPicks === 0 ? `Optional · max ${g.maxPicks}` : g.minPicks === g.maxPicks ? `Pick ${g.minPicks}` : `Pick ${g.minPicks}-${g.maxPicks}`}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {g.options.map((opt) => {
                      const addon = opt.addon;
                      if (!addon) return null;
                      const checked = picks.has(`${g.id}:${addon.id}`);
                      const disabled = addon.isAvailable === false;
                      return (
                        <button
                          key={opt.id}
                          disabled={disabled}
                          onClick={() => togglePick(g, { id: addon.id, name: addon.name, price: Number(addon.price) })}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 border ${
                            checked ? 'bg-[#C8FF00]/10 border-[#C8FF00]' : 'bg-[#0D0D0D] border-[#2A2A2A] hover:border-[#888]'
                          } ${disabled ? 'opacity-50' : ''}`}
                        >
                          <span className="flex items-center gap-2 text-sm font-body text-white">
                            <input type="checkbox" checked={checked} readOnly className="accent-[#C8FF00]" />
                            {addon.name}
                          </span>
                          <span className="text-sm font-body font-medium text-white">{Number(addon.price) > 0 ? `+${formatCurrency(Number(addon.price))}` : 'Free'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Self-service ingredient removal — only when admin enabled it */}
        {allowSelfRemove && recipe && recipe.items.length > 0 && (
          <div className="mt-6 border border-[#2A2A2A] bg-[#1A1A1A] p-3">
            <p className="font-body font-medium text-sm text-white mb-1">Customise ingredients</p>
            <p className="text-[11px] text-[#888] font-body mb-2">Tick to remove from your dish.</p>
            <div className="space-y-1.5">
              {recipe.items.map((ri) => {
                const checked = removed.has(ri.ingredient.id);
                return (
                  <button
                    key={ri.id}
                    onClick={() => toggleRemoved(ri.ingredient.id)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 border ${
                      checked ? 'bg-[#F03535]/10 border-[#F03535]' : 'bg-[#0D0D0D] border-[#2A2A2A] hover:border-[#888]'
                    }`}
                  >
                    <input type="checkbox" checked={checked} readOnly className="accent-[#F03535]" />
                    <span className={`text-sm font-body ${checked ? 'text-[#F03535] font-medium line-through' : 'text-white'}`}>{ri.ingredient.name}</span>
                    {checked && <span className="ml-auto text-[10px] uppercase tracking-widest text-[#F03535] font-medium">No</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Special note — always available, regardless of toggle */}
        <div className="mt-6">
          <label className="block text-[11px] font-body text-[#888] uppercase tracking-widest mb-1">Special note (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={allowSelfRemove ? 'Anything else for the kitchen…' : 'e.g. no garlic, less spicy, allergic to peanuts'}
            rows={2}
            className="w-full bg-[#1A1A1A] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#C8FF00] placeholder:text-[#555] resize-none"
          />
          {!allowSelfRemove && (
            <p className="text-[10px] text-[#666] font-body mt-1">Cashier will read your note before sending to the kitchen.</p>
          )}
        </div>
      </div>

      {/* Spacer so the sticky bar doesn't cover the last block */}
      <div className="h-32" />

      {/* Bottom: Qty + Add to Cart */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-[#0D0D0D] border-t border-[#2A2A2A] px-5 py-4 flex items-center gap-4 z-20">
        {/* Qty selector */}
        <div className="flex items-center border border-[#2A2A2A] bg-[#1A1A1A]">
          <button
            onClick={() => setQty(Math.max(1, qty - 1))}
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-[#2A2A2A] transition-colors"
          >
            <Minus size={14} />
          </button>
          <span className="w-8 text-center font-body font-medium text-white text-sm">{qty}</span>
          <button
            onClick={() => setQty(qty + 1)}
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-[#2A2A2A] transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Add to cart button */}
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          title={canAdd ? '' : `Required: ${unmet.map((g) => g.name).join(', ')}`}
          className="flex-1 bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm flex items-center justify-between px-5 disabled:opacity-40"
        >
          <span>Add to Cart</span>
          <span className="font-display text-lg tracking-wide">{formatCurrency(unitPrice * qty)}</span>
        </button>
      </div>
    </div>
  );
}

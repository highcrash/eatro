import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MenuItem } from '@restora/types';

export interface CartAddon {
  groupId: string;
  groupName: string;
  addonItemId: string;
  addonName: string;
  /** Per-unit price in paisa, snapshotted at add-to-cart time. */
  price: number;
}

export interface CartEntry {
  /** Stable line key — matches when same item + same addon picks +
   *  same notes are added again (so quantity stacks instead of
   *  splitting into duplicate rows). Different addons / notes = new
   *  row, so stock deduction + KT print get the right details. */
  key: string;
  menuItem: MenuItem;
  quantity: number;
  addons?: CartAddon[];
  /** Free-text "Special note" — used for "no garlic" requests when
   *  admin has the QR self-service ingredient toggle OFF. Cashier
   *  reads it on order acceptance and applies the removal manually. */
  notes?: string;
}

/** Match (menuItemId, sortedAddonPicks, notes) so different selections
 *  / requests get their own cart row. */
export function cartLineKey(it: { menuItem: { id: string }; addons?: CartAddon[]; notes?: string }): string {
  const addons = [...(it.addons ?? [])]
    .map((a) => `${a.groupId}:${a.addonItemId}`)
    .sort()
    .join(',');
  return `${it.menuItem.id}::${addons}::${it.notes ?? ''}`;
}

interface CartStore {
  items: CartEntry[];
  /** Add 1 unit of an item with optional addons + notes. Stacks on
   *  any existing line with the same key. */
  addItem: (item: MenuItem, opts?: { addons?: CartAddon[]; notes?: string; quantity?: number }) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, qty: number) => void;
  setNotes: (key: string, notes: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item, opts) =>
        set((s) => {
          const addons = opts?.addons;
          const notes = opts?.notes;
          const quantity = opts?.quantity ?? 1;
          const key = cartLineKey({ menuItem: { id: item.id }, addons, notes });
          const existing = s.items.find((c) => c.key === key);
          if (existing) {
            return { items: s.items.map((c) => c.key === key ? { ...c, quantity: c.quantity + quantity } : c) };
          }
          return { items: [...s.items, { key, menuItem: item, quantity, addons, notes }] };
        }),
      removeItem: (key) =>
        set((s) => ({ items: s.items.filter((c) => c.key !== key) })),
      updateQuantity: (key, qty) =>
        set((s) => ({
          items: qty <= 0
            ? s.items.filter((c) => c.key !== key)
            : s.items.map((c) => c.key === key ? { ...c, quantity: qty } : c),
        })),
      setNotes: (key, notes) =>
        set((s) => {
          // Re-keying needed because the line key includes notes.
          const target = s.items.find((c) => c.key === key);
          if (!target) return s;
          const newKey = cartLineKey({ menuItem: { id: target.menuItem.id }, addons: target.addons, notes });
          // If another row already has this new key, merge into it.
          const colliding = s.items.find((c) => c.key === newKey && c.key !== key);
          if (colliding) {
            return {
              items: s.items
                .filter((c) => c.key !== key)
                .map((c) => c.key === newKey ? { ...c, quantity: c.quantity + target.quantity } : c),
            };
          }
          return { items: s.items.map((c) => c.key === key ? { ...c, key: newKey, notes } : c) };
        }),
      clearCart: () => set({ items: [] }),
    }),
    {
      name: 'restora-qr-cart-v2',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

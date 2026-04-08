import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MenuItem } from '@restora/types';

interface CartEntry {
  menuItem: MenuItem;
  quantity: number;
}

interface CartStore {
  items: CartEntry[];
  addItem: (item: MenuItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => {
          const existing = s.items.find((c) => c.menuItem.id === item.id);
          if (existing) return { items: s.items.map((c) => c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c) };
          return { items: [...s.items, { menuItem: item, quantity: 1 }] };
        }),
      removeItem: (id) =>
        set((s) => ({
          items: s.items.filter((c) => c.menuItem.id !== id),
        })),
      updateQuantity: (id, qty) =>
        set((s) => ({
          items: qty <= 0
            ? s.items.filter((c) => c.menuItem.id !== id)
            : s.items.map((c) => c.menuItem.id === id ? { ...c, quantity: qty } : c),
        })),
      clearCart: () => set({ items: [] }),
    }),
    {
      name: 'restora-qr-cart',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

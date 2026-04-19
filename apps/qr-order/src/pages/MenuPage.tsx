import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Search, ClipboardList } from 'lucide-react';

import type { MenuItem, MenuCategory } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { useCartStore } from '../store/cart.store';
import { apiUrl } from '../lib/api';
import { useSessionStore } from '../store/session.store';

function resolveImg(url: string | null) {
  if (!url) return '';
  return url;
}

export default function MenuPage() {
  const navigate = useNavigate();
  const branchId = useSessionStore((s) => s.branchId);
  const branchName = useSessionStore((s) => s.branchName);
  const tableNumber = useSessionStore((s) => s.tableNumber);
  const activeOrderId = useSessionStore((s) => s.activeOrderId);

  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ categories: MenuCategory[]; items: MenuItem[] }>({
    queryKey: ['qr-menu', branchId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/menu/${branchId}`));
      if (!res.ok) throw new Error('Failed to load menu');
      return res.json();
    },
    enabled: !!branchId,
  });

  const categories = data?.categories ?? [];
  const allItems = data?.items ?? [];

  const { items: cart, addItem } = useCartStore();
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  // Filter items
  let filtered = allItems.filter((m) => m.isAvailable);
  if (activeCat) filtered = filtered.filter((m) => m.categoryId === activeCat);
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((m) => m.name.toLowerCase().includes(q) || m.tags?.toLowerCase().includes(q));
  }

  // Group by category for display
  const grouped = categories
    .map((cat) => ({
      cat,
      items: filtered.filter((m) => m.categoryId === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  // If a category is actively selected, show all items flat
  const showFlat = !!activeCat || !!search.trim();

  // No session — user landed without scanning QR
  if (!branchId) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center px-5">
        <div className="w-16 h-16 bg-[#C8FF00] flex items-center justify-center mb-5">
          <span className="font-display text-[#0D0D0D] text-3xl">R</span>
        </div>
        <h1 className="font-display text-3xl text-white tracking-wider mb-2">SCAN QR CODE</h1>
        <p className="text-sm text-[#666] font-body text-center">
          Please scan the QR code on your table to start ordering.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D] px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-3xl text-white tracking-wider">{branchName || 'Your Restaurant'}</h1>
            {tableNumber && <p className="text-xs text-[#666] font-body">Table {tableNumber}</p>}
          </div>
          {cartCount > 0 && (
            <button
              onClick={() => void navigate('/cart')}
              className="relative w-11 h-11 bg-[#C8FF00] flex items-center justify-center"
            >
              <ShoppingCart size={18} className="text-[#0D0D0D]" />
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#0D0D0D] text-[#C8FF00] text-[10px] font-body font-medium flex items-center justify-center border border-[#C8FF00]">
                {cartCount}
              </span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for something tasty..."
            className="w-full bg-[#1A1A1A] border border-[#2A2A2A] pl-10 pr-4 py-3 text-sm text-white font-body placeholder:text-[#555] outline-none focus:border-[#C8FF00]/40"
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setActiveCat(null)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-body font-medium whitespace-nowrap transition-colors ${
              !activeCat ? 'bg-[#C8FF00] text-[#0D0D0D]' : 'bg-[#1A1A1A] text-[#999] border border-[#2A2A2A]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(activeCat === cat.id ? null : cat.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-body font-medium whitespace-nowrap transition-colors ${
                activeCat === cat.id ? 'bg-[#C8FF00] text-[#0D0D0D]' : 'bg-[#1A1A1A] text-[#999] border border-[#2A2A2A]'
              }`}
            >
              {cat.icon && <span className="text-sm">{cat.icon}</span>}
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-sm text-[#666] font-body">Loading…</div>
      ) : showFlat ? (
        <div className="px-5 pb-24">
          <div className="grid grid-cols-2 gap-3 mt-3">
            {filtered.map((item) => (
              <FoodCard key={item.id} item={item} onAdd={addItem} onTap={() => void navigate(`/item/${item.id}`)} />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-sm text-[#555] font-body py-12">No items found</p>
          )}
        </div>
      ) : (
        <div className="px-5 pb-24">
          {grouped.map(({ cat, items }) => (
            <div key={cat.id} className="mb-6">
              <div className="flex items-center justify-between mb-3 mt-2">
                <h2 className="font-display text-xl text-white tracking-wider">
                  {cat.icon && <span className="mr-1">{cat.icon}</span>}
                  {cat.name}
                </h2>
                <button onClick={() => setActiveCat(cat.id)} className="text-[10px] font-body text-[#C8FF00] tracking-widest uppercase">
                  View all →
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {items.slice(0, 4).map((item) => (
                  <FoodCard key={item.id} item={item} onAdd={addItem} onTap={() => void navigate(`/item/${item.id}`)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      {(cartCount > 0 || activeOrderId) && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-5 pb-5 z-20 space-y-2">
          {activeOrderId && cartCount === 0 && (
            <button
              onClick={() => void navigate(`/order/${activeOrderId}`)}
              className="w-full bg-[#1A1A1A] border border-[#C8FF00]/30 text-[#C8FF00] py-3.5 font-body font-medium text-sm flex items-center justify-center gap-2"
            >
              <ClipboardList size={16} />
              View Active Order
            </button>
          )}
          {cartCount > 0 && (
            <button
              onClick={() => void navigate('/cart')}
              className="w-full bg-[#C8FF00] text-[#0D0D0D] py-4 font-body font-medium text-sm flex items-center justify-center gap-2"
            >
              <ShoppingCart size={16} />
              {activeOrderId ? `Add ${cartCount} item${cartCount > 1 ? 's' : ''} to order` : `Check out ${cartCount} product${cartCount > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FoodCard({ item, onAdd, onTap }: { item: MenuItem; onAdd: (item: MenuItem) => void; onTap: () => void }) {
  const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  return (
    <div className="bg-[#1A1A1A] border border-[#2A2A2A] overflow-hidden" onClick={onTap}>
      {/* Image */}
      <div className="aspect-square bg-[#111] relative overflow-hidden">
        {item.imageUrl ? (
          <img src={resolveImg(item.imageUrl)} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">
            {item.type === 'BEVERAGE' ? '🥤' : '🍽️'}
          </div>
        )}
        {/* Quick add */}
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(item); }}
          className="absolute bottom-2 right-2 w-8 h-8 bg-[#C8FF00] text-[#0D0D0D] flex items-center justify-center text-xl font-light hover:bg-[#D4FF33] transition-colors"
        >
          +
        </button>
      </div>
      {/* Info */}
      <div className="p-3">
        <p className="font-body font-medium text-xs text-white leading-tight line-clamp-2">{item.name}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[9px] font-body text-[#C8FF00] bg-[#C8FF00]/10 px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        )}
        <p className="font-display text-base text-white tracking-wide mt-1.5">{formatCurrency(item.price)}</p>
      </div>
    </div>
  );
}

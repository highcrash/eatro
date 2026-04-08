import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, Minus, Plus } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { useCartStore } from '../store/cart.store';
import { apiUrl } from '../lib/api';
import { useSessionStore } from '../store/session.store';

export default function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const branchId = useSessionStore((s) => s.branchId);
  const branchName = useSessionStore((s) => s.branchName);
  const { addItem, items: cart } = useCartStore();
  const [qty, setQty] = useState(1);

  const { data } = useQuery<{ categories: unknown[]; items: MenuItem[] }>({
    queryKey: ['qr-menu', branchId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/public/menu/${branchId || 'default'}`));
      return res.json();
    },
  });

  const item = data?.items.find((m) => m.id === itemId);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  if (!item) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0D0D0D] text-sm text-[#666] font-body">Loading…</div>
    );
  }

  const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const handleAdd = () => {
    for (let i = 0; i < qty; i++) addItem(item);
    void navigate(-1);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D]/90 backdrop-blur px-5 py-3 flex items-center justify-between">
        <button onClick={() => void navigate(-1)} className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white">
          <ArrowLeft size={16} />
        </button>
        <span className="font-display text-xl text-white tracking-wider">{branchName || 'Restora'}</span>
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
          <p className="font-display text-2xl text-white tracking-wider">{formatCurrency(item.price)}</p>
        </div>
      </div>

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
          className="flex-1 bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm flex items-center justify-between px-5"
        >
          <span>Add to Cart</span>
          <span className="font-display text-lg tracking-wide">{formatCurrency(item.price * qty)}</span>
        </button>
      </div>
    </div>
  );
}

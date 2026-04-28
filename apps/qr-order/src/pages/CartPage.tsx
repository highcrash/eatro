import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, X, Loader2 } from 'lucide-react';

import { formatCurrency } from '@restora/utils';
import { useCartStore } from '../store/cart.store';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';
import { triggerGateRecheck } from '../App';

export default function CartPage() {
  const navigate = useNavigate();
  const tableId = useSessionStore((s) => s.tableId);
  const branchId = useSessionStore((s) => s.branchId);
  const activeOrderId = useSessionStore((s) => s.activeOrderId);
  const setActiveOrder = useSessionStore((s) => s.setActiveOrder);
  const [submitting, setSubmitting] = useState(false);

  const { items: rawItems, removeItem, updateQuantity, clearCart } = useCartStore();
  // sessionStorage can carry stale entries from older app versions
  // (e.g. one whose menuItem snapshot got malformed by a JSON shape
  // change). Skip those so a single bad row doesn't crash the page
  // on render — the symptom was a black/blank cart screen.
  const items = rawItems.filter((c) => c && c.menuItem && typeof c.menuItem.id === 'string');
  const subtotal = items.reduce((s, c) => {
    const addonsTotal = (c.addons ?? []).reduce((a, b) => a + b.price, 0);
    return s + (Number(c.menuItem.price) + addonsTotal) * c.quantity;
  }, 0);
  const isAddingToOrder = !!activeOrderId;

  /** Map a cart entry → API line shape. Sends addon picks (groupId +
   *  addonItemId pairs); the server snapshots names + prices itself.
   *  `notes` carries any "no garlic" requests when admin has the QR
   *  self-service toggle OFF — server will leave them as text and the
   *  cashier applies the structural removal at acceptance time. */
  const lineToDto = (c: typeof items[number]) => ({
    menuItemId: c.menuItem.id,
    quantity: c.quantity,
    notes: c.notes,
    addons: c.addons && c.addons.length > 0
      ? c.addons.map((a) => ({ groupId: a.groupId, addonItemId: a.addonItemId }))
      : undefined,
  });

  const handleOrder = async () => {
    setSubmitting(true);
    try {
      const url = activeOrderId
        ? apiUrl(`/orders/qr/${activeOrderId}/items`)
        : apiUrl('/orders/qr');
      const body = activeOrderId
        ? { items: items.map(lineToDto) }
        : {
            tableId: tableId ?? undefined,
            type: tableId ? 'DINE_IN' : 'TAKEAWAY',
            items: items.map(lineToDto),
          };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // 403 with the gate message means the server now sees us as off
        // the allowlist (admin changed it mid-session, or our IP rotated
        // onto a different carrier). Kick the app-level gate re-check
        // so the next render flips to the Wi-Fi page instead of an
        // abstract alert.
        if (res.status === 403) triggerGateRecheck();
        const err = await res.json().catch(() => ({ message: 'Order failed' }));
        throw new Error((err as { message?: string }).message || 'Order failed');
      }

      if (activeOrderId) {
        clearCart();
        void navigate(`/order/${activeOrderId}`);
      } else {
        const order = await res.json() as { id: string };
        setActiveOrder(order.id);
        clearCart();
        void navigate(`/order/${order.id}`);
      }
    } catch (e) {
      alert((e as Error).message || 'Failed to place order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white px-5 py-4 flex items-center justify-between border-b border-[#E8E6E3]">
        <div className="flex items-center gap-3">
          <button onClick={() => void navigate(-1)} className="w-9 h-9 flex items-center justify-center text-[#111] hover:bg-[#F2F1EE] transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h1 className="font-display text-2xl text-[#111] tracking-wider">Order</h1>
        </div>
        <button onClick={() => void navigate(-1)} className="w-9 h-9 flex items-center justify-center text-[#999] hover:text-[#111] transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Items */}
      <div className="flex-1 px-5 py-4">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-6xl mb-4">🛒</p>
            <p className="text-sm text-[#999] font-body">Your cart is empty</p>
            <button onClick={() => void navigate('/menu')} className="mt-4 text-sm font-body text-[#0D0D0D] underline">
              Browse menu
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((line) => {
              const { menuItem, quantity, addons, notes, key } = line;
              const addonsTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
              const unitPrice = Number(menuItem.price) + addonsTotal;
              return (
              <div key={key} className="flex gap-3 items-start py-3 border-b border-[#F2F1EE] last:border-0">
                {/* Image */}
                <div className="w-16 h-16 bg-[#F2F1EE] overflow-hidden flex-shrink-0">
                  {menuItem.imageUrl ? (
                    <img src={menuItem.imageUrl} alt={menuItem.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl opacity-30">🍽️</div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="font-body font-medium text-sm text-[#111] leading-tight">{menuItem.name}</p>
                  {addons && addons.length > 0 && (
                    <p className="text-[11px] text-[#D62B2B] font-body font-medium mt-0.5 leading-tight">
                      {addons.map((a) => `+ ${a.addonName}${a.price > 0 ? ` (${formatCurrency(a.price)})` : ''}`).join(' • ')}
                    </p>
                  )}
                  {notes && (
                    <p className="text-[11px] text-[#666] font-body italic mt-0.5 leading-tight">📝 {notes}</p>
                  )}
                  {menuItem.description && !notes && (
                    <p className="text-[11px] text-[#999] font-body mt-0.5 line-clamp-1">{menuItem.description}</p>
                  )}
                  {/* Qty controls */}
                  <div className="flex items-center gap-0 mt-2 border border-[#E8E6E3] w-fit">
                    <button
                      onClick={() => updateQuantity(key, quantity - 1)}
                      className="w-8 h-8 flex items-center justify-center text-[#111] hover:bg-[#F2F1EE] transition-colors"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-7 text-center font-body font-medium text-sm text-[#111]">{quantity}</span>
                    <button
                      onClick={() => updateQuantity(key, quantity + 1)}
                      className="w-8 h-8 flex items-center justify-center text-[#111] hover:bg-[#F2F1EE] transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                {/* Price + remove */}
                <div className="flex flex-col items-end gap-1">
                  <button onClick={() => removeItem(key)} className="text-[#CCC] hover:text-[#D62B2B] transition-colors p-0.5">
                    <X size={14} />
                  </button>
                  <p className="font-display text-lg text-[#111] tracking-wide mt-auto">{formatCurrency(unitPrice * quantity)}</p>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom summary */}
      {items.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-[#E8E6E3] px-5 py-4 space-y-3">
          <div className="flex justify-between text-sm font-body text-[#666]">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between font-body font-medium text-base text-[#111]">
            <span>Total</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <button
            onClick={() => void handleOrder()}
            disabled={submitting}
            className="w-full bg-[#0D0D0D] text-white py-4 font-body font-medium text-sm hover:bg-[#222] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Sending...' : isAddingToOrder ? 'Add to Order' : 'Place Order'}
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, ChefHat, Plus, ArrowLeft, XCircle, Trash2 } from 'lucide-react';

import { formatCurrency } from '@restora/utils';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  kitchenStatus: string;
  voidedAt: string | null;
}

interface QrOrder {
  id: string;
  orderNumber: string;
  status: string;
  tableNumber: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  items: OrderItem[];
}

const ORDER_STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'];
const STEP_ICON: Record<string, typeof Clock> = { PENDING: Clock, CONFIRMED: Clock, PREPARING: ChefHat, READY: CheckCircle, SERVED: CheckCircle };
const STEP_LABEL: Record<string, string> = { PENDING: 'Waiting for Acceptance', CONFIRMED: 'Order Confirmed', PREPARING: 'Being Prepared', READY: 'Ready for Pickup', SERVED: 'Served' };

const KITCHEN_STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_APPROVAL: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Awaiting Approval' },
  WAITING: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Waiting' },
  NEW: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Waiting' },
  COOKING: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Cooking' },
  PREPARING: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Cooking' },
  ACKNOWLEDGED: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Acknowledged' },
  READY: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'Ready' },
  DONE: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'Ready' },
  SERVED: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'Served' },
};

export default function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const setActiveOrder = useSessionStore((s) => s.setActiveOrder);

  // Persist this orderId as the active order
  useEffect(() => {
    if (orderId) setActiveOrder(orderId);
  }, [orderId, setActiveOrder]);

  const { data: order } = useQuery<QrOrder>({
    queryKey: ['order-status', orderId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/orders/qr/${orderId}/status`));
      return res.json() as Promise<QrOrder>;
    },
    refetchInterval: 3000,
  });

  // Clear active order when cancelled/voided
  useEffect(() => {
    if (order && (order.status === 'VOID' || order.status === 'CANCELLED')) {
      setActiveOrder(null);
    }
  }, [order?.status, setActiveOrder]);

  if (!order) return (
    <div className="flex items-center justify-center h-screen bg-[#0D0D0D] text-sm text-[#666] font-body">Loading…</div>
  );

  // Cancelled / Voided order screen
  if (order.status === 'VOID' || order.status === 'CANCELLED') {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center px-5">
        <div className="w-16 h-16 bg-[#D62B2B]/15 flex items-center justify-center mb-5">
          <XCircle size={32} className="text-[#D62B2B]" />
        </div>
        <h1 className="font-display text-3xl text-white tracking-wider mb-2">ORDER CANCELLED</h1>
        <p className="text-sm text-[#666] font-body text-center mb-1">{order.orderNumber}</p>
        <p className="text-xs text-[#555] font-body text-center mb-8">
          This order has been cancelled. Please place a new order if needed.
        </p>
        <button
          onClick={() => void navigate('/menu')}
          className="bg-[#C8FF00] text-[#0D0D0D] px-8 py-3.5 font-body font-medium text-sm"
        >
          Back to Menu
        </button>
      </div>
    );
  }

  const qc = useQueryClient();
  const branchId = useSessionStore((s) => s.branchId);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const currentStep = ORDER_STEPS.indexOf(order.status);
  const activeItems = order.items.filter((i) => !i.voidedAt);
  const isFinished = order.status === 'SERVED' || order.status === 'PAID';
  const canAddItems = order.status === 'PENDING' || order.status === 'CONFIRMED' || order.status === 'PREPARING';

  const handleRemoveItem = async (itemId: string) => {
    if (!confirm('Remove this item?')) return;
    setRemovingId(itemId);
    try {
      await fetch(apiUrl(`/orders/qr/${orderId}/items/${itemId}/cancel`), {
        method: 'POST',
        headers: { 'x-branch-id': branchId || '' },
      });
      void qc.invalidateQueries({ queryKey: ['order-status', orderId] });
    } catch {
      alert('Failed to remove item');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D] px-5 py-4 flex items-center justify-between">
        <button onClick={() => void navigate('/menu')} className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white">
          <ArrowLeft size={16} />
        </button>
        <div className="text-center">
          <h1 className="font-display text-xl text-white tracking-wider">ORDER STATUS</h1>
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">{order.orderNumber}</p>
        </div>
        <div className="w-9" />
      </div>

      {/* Order progress */}
      <div className="px-5 mb-5">
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-4">
          <div className="flex items-center gap-1">
            {ORDER_STEPS.map((step, i) => {
              const done = i <= currentStep;
              const active = i === currentStep;
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className={`w-8 h-8 flex items-center justify-center transition-colors ${
                    done ? 'bg-[#C8FF00]' : 'bg-[#2A2A2A]'
                  } ${active ? 'ring-2 ring-[#C8FF00]/40' : ''}`}>
                    {(() => { const Icon = STEP_ICON[step] || Clock; return <Icon size={14} className={done ? 'text-[#0D0D0D]' : 'text-[#555]'} />; })()}
                  </div>
                  <span className={`text-[8px] font-body text-center leading-tight ${
                    active ? 'text-[#C8FF00] font-medium' : done ? 'text-[#888]' : 'text-[#444]'
                  }`}>
                    {STEP_LABEL[step]?.split(' ')[0] || step}
                  </span>
                  {active && <span className="text-[8px] text-[#C8FF00] font-body animate-pulse">Now</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Items with kitchen status */}
      <div className="px-5 mb-5">
        <h2 className="font-display text-lg text-white tracking-wider mb-3">Your Items</h2>
        <div className="space-y-2">
          {activeItems.map((item) => {
            const ks = KITCHEN_STATUS_COLOR[item.kitchenStatus] || KITCHEN_STATUS_COLOR.WAITING;
            return (
              <div key={item.id} className="bg-[#1A1A1A] border border-[#2A2A2A] p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-body font-medium text-sm text-white leading-tight">{item.name}</p>
                  <p className="text-xs text-[#666] font-body mt-0.5">× {item.quantity}</p>
                </div>
                <span className={`text-[10px] font-body font-medium px-2.5 py-1 ${ks.bg} ${ks.text} tracking-widest uppercase whitespace-nowrap`}>
                  {ks.label}
                </span>
                <span className="font-display text-base text-white tracking-wide">{formatCurrency(item.totalPrice)}</span>
                {(order.status === 'PENDING' || item.kitchenStatus === 'PENDING_APPROVAL') && (
                  <button
                    onClick={() => void handleRemoveItem(item.id)}
                    disabled={removingId === item.id}
                    className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#D62B2B] transition-colors disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Voided items */}
      {order.items.filter((i) => i.voidedAt).length > 0 && (
        <div className="px-5 mb-5">
          <h2 className="font-display text-sm text-[#555] tracking-wider mb-2">Removed Items</h2>
          {order.items.filter((i) => i.voidedAt).map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-2 opacity-40">
              <p className="font-body text-xs text-[#666] line-through flex-1">{item.name} × {item.quantity}</p>
              <p className="font-body text-xs text-[#666] line-through">{formatCurrency(item.totalPrice)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Total */}
      <div className="px-5 mb-5">
        <div className="border-t border-[#2A2A2A] pt-4 space-y-2">
          <div className="flex justify-between text-sm font-body text-[#666]">
            <span>Subtotal</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          {order.taxAmount > 0 && (
            <div className="flex justify-between text-sm font-body text-[#666]">
              <span>Tax</span>
              <span>{formatCurrency(order.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-body font-medium text-white">
            <span>Total</span>
            <span className="font-display text-xl tracking-wide">{formatCurrency(order.totalAmount)}</span>
          </div>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-[#0D0D0D] border-t border-[#2A2A2A] px-5 py-4 z-20 space-y-2">
        {canAddItems && (
          <button
            onClick={() => void navigate('/menu')}
            className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3.5 font-body font-medium text-sm flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add More Items
          </button>
        )}
        {isFinished && (
          <p className="text-center text-xs text-[#C8FF00] font-body font-medium py-2">
            Thank you for dining with us!
          </p>
        )}
        {!canAddItems && !isFinished && (
          <p className="text-center text-xs text-[#666] font-body py-2">
            Your order is almost ready...
          </p>
        )}
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { formatCurrency } from '@restora/utils';
import type { MenuItem, MenuCategory } from '@restora/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublicTableInfo {
  id: string;
  tableNumber: string;
  branchId: string;
  branchName: string;
  status: string;
  activeOrderId: string | null;
}

interface PublicMenu {
  categories: MenuCategory[];
  items: MenuItem[];
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  notes?: string;
}

interface OrderStatusItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
  kitchenStatus: string;
  voidedAt: string | null;
}

interface OrderStatus {
  id: string;
  orderNumber: string;
  status: string;
  tableNumber: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  discountName: string | null;
  couponCode: string | null;
  couponId: string | null;
  discountId: string | null;
  totalAmount: number;
  items: OrderStatusItem[];
}

// ─── Kitchen Status Badge ────────────────────────────────────────────────────

function KitchenStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    PENDING_APPROVAL: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'AWAITING APPROVAL' },
    NEW: { bg: 'bg-[#2A2A2A]', text: 'text-[#999]', label: 'QUEUED' },
    ACKNOWLEDGED: { bg: 'bg-[#2A2A2A]', text: 'text-[#999]', label: 'QUEUED' },
    PREPARING: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'COOKING' },
    DONE: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'READY' },
  };
  const c = config[status] ?? config.NEW;
  return (
    <span className={`${c.bg} ${c.text} font-body text-[10px] tracking-widest uppercase px-2 py-0.5`}>
      {c.label}
    </span>
  );
}

// ─── Order Status Badge ──────────────────────────────────────────────────────

function OrderStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'AWAITING STAFF' },
    CONFIRMED: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'CONFIRMED' },
    PREPARING: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'PREPARING' },
    READY: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'READY' },
    SERVED: { bg: 'bg-[#C8FF00]/15', text: 'text-[#C8FF00]', label: 'SERVED' },
    PAID: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'PAID' },
    VOID: { bg: 'bg-red-500/20', text: 'text-[#D62B2B]', label: 'CANCELLED' },
  };
  const c = config[status] ?? { bg: 'bg-[#2A2A2A]', text: 'text-[#999]', label: status };
  return (
    <span className={`${c.bg} ${c.text} font-body text-xs tracking-widest uppercase px-3 py-1`}>
      {c.label}
    </span>
  );
}

// ─── Food Card ───────────────────────────────────────────────────────────────

function FoodCard({ item, cartQty, onAdd }: { item: MenuItem; cartQty: number; onAdd: () => void }) {
  const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  return (
    <div className="bg-[#161616] border border-[#2A2A2A] overflow-hidden">
      <div className="aspect-square bg-[#111] relative overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-20">
            {item.type === 'BEVERAGE' ? '🥤' : '🍽️'}
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="absolute bottom-2 right-2 w-8 h-8 bg-[#C8FF00] text-[#0D0D0D] flex items-center justify-center text-xl font-light hover:bg-[#D4FF33] transition-colors"
        >
          +
        </button>
        {cartQty > 0 && (
          <span className="absolute top-2 right-2 w-5 h-5 bg-[#C8FF00] text-[#0D0D0D] text-[10px] font-body font-bold flex items-center justify-center">
            {cartQty}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="font-body font-medium text-xs text-white leading-tight line-clamp-2">{item.name}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[9px] font-body text-[#C8FF00] bg-[#C8FF00]/10 px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        )}
        {(item as any).discountedPrice != null ? (
          <div className="mt-1.5 flex items-center gap-2">
            <p className="font-display text-base text-[#C8FF00] tracking-wide">{formatCurrency((item as any).discountedPrice)}</p>
            <p className="font-body text-[10px] text-[#666] line-through">{formatCurrency(Number(item.price))}</p>
          </div>
        ) : (
          <p className="font-display text-base text-white tracking-wide mt-1.5">{formatCurrency(Number(item.price))}</p>
        )}
      </div>
    </div>
  );
}

// ─── Order Status Page ───────────────────────────────────────────────────────

function OrderStatusPage({
  orderId,
  branchId,
  branchName,
  tableNumber,
  customerId,
  onAddMore,
}: {
  orderId: string;
  branchId: string;
  branchName: string;
  customerId?: string | null;
  tableNumber: string;
  onAddMore: () => void;
}) {
  const queryClient = useQueryClient();
  const [billRequested, setBillRequested] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewScores, setReviewScores] = useState({ food: 0, service: 0, atmosphere: 0, price: 0 });
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');

  const { data: order, isLoading } = useQuery<OrderStatus>({
    queryKey: ['order-status', orderId],
    queryFn: () => api.getOrderStatus(orderId),
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: (itemId: string) => api.cancelItem(orderId, itemId, branchId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order-status', orderId] }),
  });

  const billMutation = useMutation({
    mutationFn: () => api.requestBill(orderId, branchId),
    onSuccess: () => { setBillRequested(true); setShowReview(true); },
  });

  const reviewMutation = useMutation({
    mutationFn: () => api.submitReview(branchId, {
      orderId,
      customerId: customerId || undefined,
      foodScore: reviewScores.food,
      serviceScore: reviewScores.service,
      atmosphereScore: reviewScores.atmosphere,
      priceScore: reviewScores.price,
      notes: reviewNote || undefined,
    }),
    onSuccess: () => { setReviewSubmitted(true); setShowReview(false); },
  });

  const couponMutation = useMutation({
    mutationFn: (code: string) => api.applyCoupon(orderId, branchId, code),
    onSuccess: () => {
      setCouponError('');
      setCouponCode('');
      queryClient.invalidateQueries({ queryKey: ['order-status', orderId] });
    },
    onError: (err: Error) => setCouponError(err.message),
  });

  const removeCouponMutation = useMutation({
    mutationFn: () => api.removeCoupon(orderId, branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-status', orderId] });
    },
  });

  if (isLoading || !order) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center">
        <div className="w-12 h-12 bg-[#C8FF00] flex items-center justify-center animate-pulse">
          <span className="font-display text-[#0D0D0D] text-xl">R</span>
        </div>
      </div>
    );
  }

  // Cancelled order screen
  if (order.status === 'VOID') {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-[#D62B2B]/15 flex items-center justify-center mb-5">
          <span className="text-3xl">✕</span>
        </div>
        <p className="font-display text-white text-3xl tracking-widest mb-2">ORDER CANCELLED</p>
        <p className="text-[#666] font-body text-sm mb-1">{order.orderNumber}</p>
        <p className="text-[#555] font-body text-xs mb-8">This order has been cancelled.</p>
        <button onClick={onAddMore} className="bg-[#C8FF00] text-[#0D0D0D] px-8 py-3.5 font-body font-medium text-sm">
          Back to Menu
        </button>
      </div>
    );
  }

  const activeItems = order.items.filter((i) => !i.voidedAt);
  const cancelledItems = order.items.filter((i) => i.voidedAt);
  const canAddMore = ['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status);

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col max-w-lg mx-auto pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0D0D0D] border-b border-[#2A2A2A] px-5 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-[#C8FF00] flex items-center justify-center flex-shrink-0">
            <span className="font-display text-[#0D0D0D] text-sm">R</span>
          </div>
          <div className="flex-1">
            <p className="font-display text-white text-xl tracking-widest leading-none">{branchName}</p>
            <p className="text-[#666] font-body text-xs">Table {tableNumber}</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[#555] font-body text-[10px] tracking-widest uppercase">Order</p>
            <p className="font-display text-white text-2xl tracking-widest">{order.orderNumber}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      {/* Items */}
      <div className="px-5 py-4 space-y-2">
        <p className="text-[#555] font-body text-[10px] tracking-widest uppercase mb-3">Your Items</p>

        {activeItems.map((item) => (
          <div key={item.id} className={`bg-[#161616] border p-4 ${item.kitchenStatus === 'PENDING_APPROVAL' ? 'border-blue-500/30 bg-blue-500/5' : 'border-[#2A2A2A]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-white font-body text-sm font-medium">{item.name}</p>
                <p className="text-[#666] font-body text-xs mt-0.5">
                  {formatCurrency(Number(item.unitPrice))} × {item.quantity}
                </p>
                {item.notes && <p className="text-[#C8FF00]/70 font-body text-[10px] mt-0.5 italic">📝 {item.notes}</p>}
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <KitchenStatusBadge status={item.kitchenStatus} />
                <p className="text-white font-body text-sm font-medium">
                  {formatCurrency(Number(item.totalPrice))}
                </p>
              </div>
            </div>
            {((order.status === 'PENDING' && item.kitchenStatus === 'NEW') || item.kitchenStatus === 'PENDING_APPROVAL') && (
              <button
                onClick={() => cancelMutation.mutate(item.id)}
                disabled={cancelMutation.isPending}
                className="mt-2 text-[#D62B2B] font-body text-xs tracking-widest uppercase hover:text-[#F03535] transition-colors disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Removing...' : 'Remove Item'}
              </button>
            )}
          </div>
        ))}

        {cancelledItems.length > 0 && (
          <>
            <p className="text-[#555] font-body text-[10px] tracking-widest uppercase mt-4 mb-2">Cancelled</p>
            {cancelledItems.map((item) => (
              <div key={item.id} className="bg-[#161616] border border-[#1A1A1A] p-4 opacity-40">
                <div className="flex items-center justify-between">
                  <p className="text-white font-body text-sm line-through">{item.name} × {item.quantity}</p>
                  <span className="text-[#D62B2B] font-body text-[10px] tracking-widest uppercase">CANCELLED</span>
                </div>
              </div>
            ))}
          </>
        )}

        {cancelMutation.error && (
          <p className="text-[#F03535] text-xs font-body">{(cancelMutation.error as Error).message}</p>
        )}
      </div>

      {/* Coupon Input — show when no POS discount applied */}
      {order.status !== 'PAID' && order.status !== 'VOID' && !order.discountId && (
        <div className="px-5 pt-4">
          <p className="text-[#555] font-body text-[10px] tracking-widest uppercase mb-2">
            {order.couponId ? 'Change coupon' : 'Have a coupon?'}
          </p>
          <div className="flex gap-2">
            <input value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(''); }}
              placeholder={order.couponCode || 'ENTER CODE'}
              className="flex-1 bg-[#161616] border border-[#2A2A2A] px-3 py-2.5 text-sm font-mono tracking-widest text-white outline-none focus:border-[#C8FF00]/40 uppercase placeholder:text-[#555]" />
            <button onClick={() => couponMutation.mutate(couponCode)} disabled={!couponCode.trim() || couponMutation.isPending}
              className="bg-[#C8FF00] text-[#0D0D0D] px-4 py-2.5 font-body font-medium text-sm disabled:opacity-40">
              {couponMutation.isPending ? '...' : order.couponId ? 'Change' : 'Apply'}
            </button>
            {order.couponId && (
              <button onClick={() => { removeCouponMutation.mutate(); setCouponCode(''); }}
                disabled={removeCouponMutation.isPending}
                className="bg-[#2A2A2A] text-[#999] px-3 py-2.5 font-body text-sm disabled:opacity-40 hover:text-white">
                ✕
              </button>
            )}
          </div>
          {couponError && <p className="text-[#F03535] text-xs font-body mt-1">{couponError}</p>}
        </div>
      )}

      {/* Bill Summary */}
      <div className="px-5 border-t border-[#2A2A2A] pt-4 mt-4 space-y-1">
        <div className="flex justify-between">
          <span className="text-[#666] font-body text-sm">Subtotal</span>
          <span className="text-[#999] font-body text-sm">{formatCurrency(Number(order.subtotal))}</span>
        </div>
        {Number(order.discountAmount) > 0 && (
          <div className="flex justify-between">
            <span className="text-[#C8FF00] font-body text-sm flex items-center gap-1">
              {order.discountName || 'Discount'}
              {order.couponCode && <span className="text-[9px] bg-[#C8FF00]/10 px-1.5 py-0.5 tracking-widest uppercase">{order.couponCode}</span>}
            </span>
            <span className="text-[#C8FF00] font-body text-sm">-{formatCurrency(Number(order.discountAmount))}</span>
          </div>
        )}
        {Number(order.taxAmount) > 0 && (
          <div className="flex justify-between">
            <span className="text-[#666] font-body text-sm">Tax</span>
            <span className="text-[#999] font-body text-sm">{formatCurrency(Number(order.taxAmount))}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-[#2A2A2A] pt-2 mt-2">
          <span className="text-white font-body font-medium">Total</span>
          <span className="text-white font-display text-xl tracking-wide">{formatCurrency(Number(order.totalAmount))}</span>
        </div>
      </div>

      {/* Bottom actions */}
      {order.status !== 'PAID' && order.status !== 'VOID' && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-[#0D0D0D] border-t border-[#2A2A2A] px-5 py-4 z-20">
          <div className="flex gap-3">
            {canAddMore && (
              <button
                onClick={onAddMore}
                className="flex-1 bg-[#C8FF00] text-[#0D0D0D] font-body font-medium py-3.5 transition-colors text-sm"
              >
                + Add More Items
              </button>
            )}
            <button
              onClick={() => billMutation.mutate()}
              disabled={billMutation.isPending || billRequested}
              className="flex-1 bg-[#2A2A2A] hover:bg-[#333] text-white font-body font-medium py-3.5 transition-colors text-sm disabled:opacity-50"
            >
              {billRequested ? '✓ Bill Requested' : billMutation.isPending ? 'Requesting...' : 'Request Bill'}
            </button>
          </div>
          {billRequested && !showReview && (
            <p className="text-[#C8FF00] font-body text-xs text-center mt-2 tracking-widest uppercase">
              Staff has been notified
              {!reviewSubmitted && <button onClick={() => setShowReview(true)} className="block mx-auto mt-1 text-[#999] underline">Rate your experience</button>}
              {reviewSubmitted && <span className="block text-[#666] mt-1">Thanks for your review!</span>}
            </p>
          )}
          {billMutation.error && (
            <p className="text-[#F03535] text-xs font-body text-center mt-2">{(billMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* Review Overlay */}
      {showReview && !reviewSubmitted && (
        <div className="fixed inset-0 bg-[#0D0D0D]/95 z-50 flex flex-col items-center justify-center px-6 max-w-lg mx-auto">
          <div className="w-full max-w-sm space-y-5">
            <div className="text-center">
              <h2 className="font-display text-2xl text-white tracking-wider">RATE YOUR EXPERIENCE</h2>
              <p className="text-xs font-body text-[#666] mt-1">How was everything today?</p>
            </div>
            {([
              { key: 'food', label: 'Food Quality' },
              { key: 'service', label: 'Service' },
              { key: 'atmosphere', label: 'Atmosphere' },
              { key: 'price', label: 'Value for Money' },
            ] as { key: keyof typeof reviewScores; label: string }[]).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm font-body text-[#999]">{label}</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} onClick={() => setReviewScores((p) => ({ ...p, [key]: s }))} className="p-1">
                      <span className={`text-lg ${s <= reviewScores[key] ? 'text-[#C8FF00]' : 'text-[#2A2A2A]'}`}>★</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Any comments? (optional)" rows={3}
              className="w-full bg-[#161616] border border-[#2A2A2A] px-3 py-2 text-sm font-body text-white outline-none focus:border-[#C8FF00]/40 placeholder:text-[#555] resize-none" />
            <div className="flex gap-3">
              <button onClick={() => setShowReview(false)} className="flex-1 bg-[#2A2A2A] text-[#999] py-3 font-body text-sm">Skip</button>
              <button onClick={() => reviewMutation.mutate()}
                disabled={Object.values(reviewScores).some((s) => s === 0) || reviewMutation.isPending}
                className="flex-1 bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm disabled:opacity-40"
              >{reviewMutation.isPending ? 'Submitting...' : 'Submit Review'}</button>
            </div>
            {reviewMutation.error && <p className="text-[#F03535] text-xs font-body text-center">{(reviewMutation.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Order Page ────────────────────────────────────────────────────────

function TableOrderPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCart, setShowCart] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(() => {
    if (tableId) return sessionStorage.getItem(`qr-order-${tableId}`);
    return null;
  });
  const [showMenu, setShowMenu] = useState(false);

  // Customer auth state
  const [customerId, setCustomerId] = useState<string | null>(() => sessionStorage.getItem('qr-customer-id'));
  const [customerName, setCustomerName] = useState(() => sessionStorage.getItem('qr-customer-name') || '');
  const [showLogin, setShowLogin] = useState(false);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [devOtp, setDevOtp] = useState('');

  const { data: tableInfo, isLoading: tableLoading, isError: tableError } = useQuery<PublicTableInfo>({
    queryKey: ['public-table', tableId],
    queryFn: () => api.get(`/table/${tableId}`),
    enabled: !!tableId,
  });

  // Sync orderId from server — handles second device scanning same table
  useEffect(() => {
    if (!tableInfo) return;
    if (!orderId && tableInfo.activeOrderId) {
      setOrderId(tableInfo.activeOrderId);
      if (tableId) sessionStorage.setItem(`qr-order-${tableId}`, tableInfo.activeOrderId);
    }
  }, [tableInfo, orderId, tableId]);

  const { data: menu, isLoading: menuLoading } = useQuery<PublicMenu>({
    queryKey: ['public-menu', tableInfo?.branchId],
    queryFn: () => api.get(`/menu/${tableInfo!.branchId}`),
    enabled: !!tableInfo?.branchId,
  });

  // Place new order
  const orderMutation = useMutation({
    mutationFn: () =>
      api.postOrder<{ id: string; orderNumber: string }>(tableInfo!.branchId, {
        tableId: tableId!,
        type: 'DINE_IN',
        customerId: customerId || undefined,
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, notes: c.notes })),
      }),
    onSuccess: (order) => {
      setOrderId(order.id);
      if (tableId) sessionStorage.setItem(`qr-order-${tableId}`, order.id);
      setCart([]);
      setShowCart(false);
      setShowMenu(false);
    },
  });

  // Add items to existing order
  const addItemsMutation = useMutation({
    mutationFn: () =>
      api.addItems(orderId!, tableInfo!.branchId, {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, notes: c.notes })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-status', orderId] });
      setCart([]);
      setShowCart(false);
      setShowMenu(false);
    },
  });

  const addToCart = useCallback((item: MenuItem) => {
    const effectivePrice = (item as any).discountedPrice ?? Number(item.price);
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) return prev.map((c) => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.name, price: effectivePrice, quantity: 1, imageUrl: item.imageUrl }];
    });
  }, []);

  const removeFromCart = useCallback((menuItemId: string) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === menuItemId);
      if (!existing) return prev;
      if (existing.quantity === 1) return prev.filter((c) => c.menuItemId !== menuItemId);
      return prev.map((c) => c.menuItemId === menuItemId ? { ...c, quantity: c.quantity - 1 } : c);
    });
  }, []);

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const categories = menu?.categories.filter((c) => !c.parentId) ?? [];
  const allCategories = menu?.categories ?? [];

  // Filter items
  let visibleItems = menu?.items.filter((i) => i.isAvailable) ?? [];
  if (selectedCategory) {
    const childIds = allCategories.filter((c) => c.parentId === selectedCategory).map((c) => c.id);
    visibleItems = visibleItems.filter((i) => i.categoryId === selectedCategory || childIds.includes(i.categoryId));
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    visibleItems = visibleItems.filter((i) => i.name.toLowerCase().includes(q) || i.tags?.toLowerCase().includes(q));
  }

  // Group by category for "All" view
  const grouped = allCategories
    .map((cat) => ({ cat, items: visibleItems.filter((i) => i.categoryId === cat.id) }))
    .filter((g) => g.items.length > 0);

  const showFlat = !!selectedCategory || !!search.trim();

  if (tableLoading || menuLoading) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center">
        <div className="w-12 h-12 bg-[#C8FF00] flex items-center justify-center animate-pulse">
          <span className="font-display text-[#0D0D0D] text-xl">R</span>
        </div>
      </div>
    );
  }

  if (tableError || !tableInfo) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-14 h-14 bg-[#C8FF00] flex items-center justify-center mb-4">
          <span className="font-display text-[#0D0D0D] text-2xl">R</span>
        </div>
        <p className="font-display text-white text-2xl tracking-widest mb-2">TABLE NOT FOUND</p>
        <p className="text-[#666] font-body text-sm">Please scan the QR code on your table again.</p>
      </div>
    );
  }

  // Show order status if order exists and not in "add more" mode
  if (orderId && !showMenu) {
    return (
      <OrderStatusPage
        orderId={orderId}
        branchId={tableInfo.branchId}
        branchName={tableInfo.branchName}
        tableNumber={tableInfo.tableNumber}
        customerId={customerId}
        onAddMore={() => setShowMenu(true)}
      />
    );
  }

  const isAddingToExisting = !!orderId;
  const submitMutation = isAddingToExisting ? addItemsMutation : orderMutation;

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D] px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isAddingToExisting && (
              <button
                onClick={() => { setShowMenu(false); setCart([]); }}
                className="text-[#666] hover:text-white font-body text-lg transition-colors"
              >
                ←
              </button>
            )}
            <div>
              <h1 className="font-display text-3xl text-white tracking-wider">{tableInfo.branchName}</h1>
              <p className="text-xs text-[#666] font-body">
                Table {tableInfo.tableNumber}
                {isAddingToExisting && ' — Adding Items'}
              </p>
            </div>
          </div>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="relative w-11 h-11 bg-[#C8FF00] flex items-center justify-center"
            >
              <span className="font-body text-[#0D0D0D] text-sm font-bold">🛒</span>
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#0D0D0D] text-[#C8FF00] text-[10px] font-body font-medium flex items-center justify-center border border-[#C8FF00]">
                {cartCount}
              </span>
            </button>
          )}
        </div>

        {/* Customer bar */}
        <div className="flex items-center justify-between mb-3 bg-[#161616] border border-[#2A2A2A] px-3 py-2">
          {customerId ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#C8FF00]">👤</span>
              <span className="text-xs font-body text-white">{customerName}</span>
              <button onClick={() => { setCustomerId(null); setCustomerName(''); sessionStorage.removeItem('qr-customer-id'); sessionStorage.removeItem('qr-customer-name'); }}
                className="text-[#666] text-[10px] hover:text-white ml-1">Logout</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#666]">👤 Guest</span>
              <button onClick={() => setShowLogin(true)} className="text-xs font-body text-[#C8FF00] hover:underline">Login / Register</button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for something tasty..."
            className="w-full bg-[#161616] border border-[#2A2A2A] pl-10 pr-4 py-3 text-sm text-white font-body placeholder:text-[#555] outline-none focus:border-[#C8FF00]/40"
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-body font-medium whitespace-nowrap transition-colors ${
              !selectedCategory ? 'bg-[#C8FF00] text-[#0D0D0D]' : 'bg-[#161616] text-[#999] border border-[#2A2A2A]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-body font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.id ? 'bg-[#C8FF00] text-[#0D0D0D]' : 'bg-[#161616] text-[#999] border border-[#2A2A2A]'
              }`}
            >
              {cat.icon && <span className="text-sm">{cat.icon}</span>}
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu items */}
      {showFlat ? (
        <div className="px-5 pb-24">
          <div className="grid grid-cols-2 gap-3 mt-3">
            {visibleItems.map((item) => (
              <FoodCard key={item.id} item={item} cartQty={cart.find((c) => c.menuItemId === item.id)?.quantity ?? 0} onAdd={() => addToCart(item)} />
            ))}
          </div>
          {visibleItems.length === 0 && (
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
                <button onClick={() => setSelectedCategory(cat.id)} className="text-[10px] font-body text-[#C8FF00] tracking-widest uppercase">
                  View all →
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {items.slice(0, 4).map((item) => (
                  <FoodCard key={item.id} item={item} cartQty={cart.find((c) => c.menuItemId === item.id)?.quantity ?? 0} onAdd={() => addToCart(item)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sticky cart bar */}
      {cartCount > 0 && !showCart && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-5 z-20">
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-[#C8FF00] text-[#0D0D0D] py-4 font-body font-medium text-sm flex items-center justify-center gap-2"
          >
            🛒 {isAddingToExisting ? `Add ${cartCount} item${cartCount !== 1 ? 's' : ''} to order` : `View Cart — ${cartCount} item${cartCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Cart Overlay */}
      {showCart && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col max-w-lg mx-auto">
          <div className="sticky top-0 bg-white border-b border-[#E8E6E2] px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setShowCart(false)} className="text-[#111] hover:text-[#D62B2B] text-lg">←</button>
              <p className="font-display text-[#111] text-2xl tracking-widest">
                {isAddingToExisting ? 'ADD ITEMS' : 'YOUR ORDER'}
              </p>
            </div>
            <button onClick={() => setShowCart(false)} className="text-[#999] hover:text-[#111] text-lg">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {cart.map((item) => (
              <div key={item.menuItemId} className="flex gap-3 items-start py-3 border-b border-[#F2F1EE] last:border-0">
                {/* Thumbnail */}
                <div className="w-16 h-16 bg-[#F2F1EE] overflow-hidden flex-shrink-0">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl opacity-30">🍽️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body font-medium text-sm text-[#111] leading-tight">{item.name}</p>
                  <p className="text-[11px] text-[#999] font-body mt-0.5">{formatCurrency(item.price)} each</p>
                  {/* Qty controls */}
                  <div className="flex items-center gap-0 mt-2 border border-[#E8E6E2] w-fit">
                    <button onClick={() => removeFromCart(item.menuItemId)} className="w-8 h-8 flex items-center justify-center text-[#111] hover:bg-[#F2F1EE] text-lg">−</button>
                    <span className="w-7 text-center font-body font-medium text-sm text-[#111]">{item.quantity}</span>
                    <button
                      onClick={() => { const mi = menu?.items.find((i) => i.id === item.menuItemId); if (mi) addToCart(mi); }}
                      className="w-8 h-8 flex items-center justify-center text-[#111] hover:bg-[#F2F1EE] text-lg"
                    >+</button>
                  </div>
                  {/* Item note */}
                  <input
                    value={item.notes || ''}
                    onChange={(e) => setCart((prev) => prev.map((c) => c.menuItemId === item.menuItemId ? { ...c, notes: e.target.value } : c))}
                    placeholder="Add note (e.g. no onion, extra spicy)..."
                    className="mt-2 w-full border border-[#E8E6E2] px-2 py-1.5 text-[11px] font-body text-[#666] outline-none focus:border-[#D62B2B] placeholder:text-[#CCC]"
                  />
                </div>
                <p className="font-display text-lg text-[#111] tracking-wide">{formatCurrency(item.price * item.quantity)}</p>
              </div>
            ))}
          </div>

          {/* Summary + submit */}
          <div className="sticky bottom-0 bg-white border-t border-[#E8E6E2] px-5 py-4 space-y-3">
            <div className="flex justify-between text-sm font-body text-[#666]">
              <span>Subtotal</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
            <div className="flex justify-between font-body font-medium text-base text-[#111]">
              <span>Total</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
            {submitMutation.error && (
              <p className="text-[#D62B2B] text-xs font-body">{(submitMutation.error as Error).message}</p>
            )}
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || cart.length === 0}
              className="w-full bg-[#0D0D0D] text-white py-4 font-body font-medium text-sm hover:bg-[#222] transition-colors disabled:opacity-50"
            >
              {submitMutation.isPending
                ? 'Sending...'
                : isAddingToExisting
                  ? `Add ${cartCount} Item${cartCount !== 1 ? 's' : ''} to Order`
                  : 'Place Order'
              }
            </button>
          </div>
        </div>
      )}

      {/* Login / Register Overlay */}
      {showLogin && tableInfo && (
        <div className="fixed inset-0 bg-[#0D0D0D] z-50 flex flex-col max-w-lg mx-auto">
          <div className="px-5 py-4 flex items-center justify-between border-b border-[#2A2A2A]">
            <h2 className="font-display text-xl text-white tracking-wider">LOGIN / REGISTER</h2>
            <button onClick={() => { setShowLogin(false); setOtpSent(false); setLoginOtp(''); setLoginError(''); setDevOtp(''); }}
              className="text-[#666] hover:text-white text-lg">✕</button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            {!otpSent ? (
              <div className="w-full max-w-xs space-y-4">
                <p className="text-sm font-body text-[#999] text-center">Enter your phone number to login or create an account.</p>
                <input value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)}
                  placeholder="+8801XXXXXXXXX" type="tel"
                  className="w-full bg-[#161616] border border-[#2A2A2A] px-4 py-3 text-white font-body text-sm outline-none focus:border-[#C8FF00]/40 text-center" />
                <button
                  onClick={async () => {
                    setLoginError(''); setLoginLoading(true);
                    try {
                      const res = await api.requestCustomerOtp<{ sent: boolean; otp?: string }>(tableInfo.branchId, loginPhone);
                      setOtpSent(true);
                      if (res.otp) setDevOtp(res.otp);
                    } catch (e) { setLoginError((e as Error).message); }
                    finally { setLoginLoading(false); }
                  }}
                  disabled={!loginPhone || loginPhone.length < 8 || loginLoading}
                  className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm disabled:opacity-40"
                >{loginLoading ? 'Sending...' : 'Send OTP'}</button>
              </div>
            ) : !customerId ? (
              <div className="w-full max-w-xs space-y-4">
                <p className="text-sm font-body text-[#999] text-center">
                  OTP sent to {loginPhone}
                  {devOtp && <span className="text-[#D62B2B] block text-xs mt-1">(Dev: {devOtp})</span>}
                </p>
                <input value={loginOtp} onChange={(e) => setLoginOtp(e.target.value.replace(/\D/g, ''))}
                  maxLength={6} placeholder="000000"
                  className="w-full bg-[#161616] border border-[#2A2A2A] px-4 py-3 text-white font-mono text-xl tracking-[0.5em] text-center outline-none focus:border-[#C8FF00]/40" />
                <button
                  onClick={async () => {
                    setLoginError(''); setLoginLoading(true);
                    try {
                      const res = await api.verifyCustomerOtp<{ customer: { id: string; name: string; phone: string } }>(tableInfo.branchId, loginPhone, loginOtp);
                      setCustomerId(res.customer.id);
                      setCustomerName(res.customer.name);
                      setLoginName(res.customer.name === 'Customer' ? '' : res.customer.name);
                      sessionStorage.setItem('qr-customer-id', res.customer.id);
                      sessionStorage.setItem('qr-customer-name', res.customer.name);
                      if (res.customer.name !== 'Customer') { setShowLogin(false); } // Already has a name
                    } catch (e) { setLoginError((e as Error).message); }
                    finally { setLoginLoading(false); }
                  }}
                  disabled={loginOtp.length !== 6 || loginLoading}
                  className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm disabled:opacity-40"
                >{loginLoading ? 'Verifying...' : 'Verify'}</button>
                <button onClick={() => { setOtpSent(false); setLoginOtp(''); setDevOtp(''); }}
                  className="text-xs font-body text-[#666] hover:text-white w-full text-center">Resend OTP</button>
              </div>
            ) : (
              <div className="w-full max-w-xs space-y-4">
                <p className="text-sm font-body text-[#C8FF00] text-center">✓ Logged in!</p>
                <p className="text-xs font-body text-[#666] text-center">Set your name (optional)</p>
                <input value={loginName} onChange={(e) => setLoginName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-[#161616] border border-[#2A2A2A] px-4 py-3 text-white font-body text-sm outline-none focus:border-[#C8FF00]/40 text-center" />
                <button
                  onClick={async () => {
                    if (loginName.trim()) {
                      await api.updateCustomerProfile(customerId!, loginName.trim());
                      setCustomerName(loginName.trim());
                      sessionStorage.setItem('qr-customer-name', loginName.trim());
                    }
                    setShowLogin(false);
                  }}
                  className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm"
                >{loginName.trim() ? 'Save & Continue' : 'Skip'}</button>
              </div>
            )}
            {loginError && <p className="text-[#F03535] text-xs font-body mt-3">{loginError}</p>}
            <p className="text-[10px] font-body text-[#555] text-center mt-6 max-w-xs">
              By logging in / registering, you agree to our terms and conditions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

// ─── Direct Login Page (no table scan) ───────────────────────────────────────

function DirectLoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);

  // Fetch branches to get branchId
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['public-branches'],
    queryFn: () => api.get('/branches'),
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  // Check if already logged in with active order
  useEffect(() => {
    const custId = sessionStorage.getItem('qr-customer-id');
    const bid = branchId;
    if (custId && bid) {
      api.getActiveOrder<{ order: { id: string; tableId: string } | null }>(bid, custId)
        .then((res) => {
          if (res.order?.tableId) {
            sessionStorage.setItem(`qr-order-${res.order.tableId}`, res.order.id);
            void navigate(`/table/${res.order.tableId}`, { replace: true });
          }
        })
        .catch(() => {});
    }
  }, [branchId, navigate]);

  const handleRequestOtp = async () => {
    if (!branchId) return;
    setError(''); setLoading(true);
    try {
      const res = await api.requestCustomerOtp<{ sent: boolean; otp?: string }>(branchId, phone);
      setOtpSent(true);
      if (res.otp) setDevOtp(res.otp);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (!branchId) return;
    setError(''); setLoading(true);
    try {
      const res = await api.verifyCustomerOtp<{ customer: { id: string; name: string } }>(branchId, phone, otp);
      sessionStorage.setItem('qr-customer-id', res.customer.id);
      sessionStorage.setItem('qr-customer-name', res.customer.name);

      // Check for active order
      const orderRes = await api.getActiveOrder<{ order: { id: string; tableId: string } | null }>(branchId, res.customer.id);
      if (orderRes.order?.tableId) {
        sessionStorage.setItem(`qr-order-${orderRes.order.tableId}`, orderRes.order.id);
        void navigate(`/table/${orderRes.order.tableId}`, { replace: true });
      } else {
        setError('No active order found. Please scan the QR code on your table.');
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 bg-[#C8FF00] flex items-center justify-center mb-6">
        <span className="font-display text-[#0D0D0D] text-2xl">R</span>
      </div>

      {!otpSent ? (
        <div className="w-full max-w-xs space-y-4">
          <p className="font-display text-white text-2xl tracking-widest">WELCOME</p>
          <p className="text-[#666] font-body text-sm">Login with your phone to view your active order, or scan the QR code on your table.</p>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+8801XXXXXXXXX"
            className="w-full bg-[#161616] border border-[#2A2A2A] px-4 py-3 text-white font-body text-sm outline-none focus:border-[#C8FF00]/40 text-center" />
          <button onClick={() => void handleRequestOtp()} disabled={!phone || phone.length < 8 || loading || !branchId}
            className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm disabled:opacity-40">
            {loading ? 'Sending...' : 'Login with OTP'}
          </button>
        </div>
      ) : (
        <div className="w-full max-w-xs space-y-4">
          <p className="font-display text-white text-2xl tracking-widest">ENTER OTP</p>
          <p className="text-[#666] font-body text-sm">OTP sent to {phone}</p>
          {devOtp && <p className="text-[#D62B2B] text-xs font-body">(Dev: {devOtp})</p>}
          <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="000000"
            className="w-full bg-[#161616] border border-[#2A2A2A] px-4 py-3 text-white font-mono text-xl tracking-[0.5em] text-center outline-none focus:border-[#C8FF00]/40" />
          <button onClick={() => void handleVerifyOtp()} disabled={otp.length !== 6 || loading}
            className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3 font-body font-medium text-sm disabled:opacity-40">
            {loading ? 'Verifying...' : 'Verify & View Order'}
          </button>
          <button onClick={() => { setOtpSent(false); setOtp(''); setDevOtp(''); }}
            className="text-xs font-body text-[#666] hover:text-white">Resend OTP</button>
        </div>
      )}

      {error && <p className="text-[#F03535] text-xs font-body mt-3">{error}</p>}

      <p className="text-[#555] font-body text-[10px] mt-8">
        Or scan the QR code on your table to start ordering.
      </p>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function QrApp() {
  return (
    <Routes>
      <Route path="/table/:tableId" element={<TableOrderPage />} />
      <Route path="*" element={<DirectLoginPage />} />
    </Routes>
  );
}

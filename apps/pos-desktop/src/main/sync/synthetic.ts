import { randomBytes } from 'crypto';
import { getCached, updateCachedBody, findCachedByPrefix } from './cache-store';
import { recordSynthetic } from './id-remap';
import { getSessionUser } from '../session/session';
import { upsertShadowOrder, getShadowOrder } from './shadow-orders';

/**
 * Build plausible server responses for mutation endpoints when offline, so
 * the renderer's React Query flow continues as if the network succeeded.
 *
 * Shapes match the NestJS Order controller (see apps/api/src/order/*). When
 * the real response comes back during drain it will arrive via a normal GET
 * refetch, so the synthetic payload only needs to look right to the POS
 * until then.
 */

export interface MenuItemLite {
  id: string;
  name: string;
  price: number;
}

interface Order {
  id: string;
  orderNumber: string;
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  type: string;
  status: string;
  items: OrderItem[];
  payments: OrderPayment[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  discountId?: string | null;
  discountName?: string | null;
  totalAmount: number;
  notes: string | null;
  cashierId: string;
  cashierName: string;
  waiterId: string | null;
  billRequested: boolean;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
  kitchenStatus: string;
  voidedAt: null;
  voidReason: null;
  voidedById: null;
  createdAt: string;
  updatedAt: string;
}

interface OrderPayment {
  id: string;
  orderId: string;
  method: string;
  amount: number;
  reference: string | null;
  createdAt: string;
}

function syntheticId(kind: 'order' | 'item' | 'pay'): string {
  return `off_${kind}_${randomBytes(10).toString('hex')}`;
}

function now(): string { return new Date().toISOString(); }

/**
 * Look up a menu item's cached name + price. Returns null if the menu was
 * never cached — caller should fall back to whatever the POS sent in the
 * request body, which typically includes the price already.
 */
function findMenuItem(menuItemId: string): MenuItemLite | null {
  const cached = getCached('GET', '/menu');
  const items = Array.isArray(cached?.body) ? (cached!.body as Array<{ id: string; name: string; price: number }>) : [];
  const hit = items.find((i) => i?.id === menuItemId);
  return hit ? { id: hit.id, name: hit.name, price: hit.price } : null;
}

function findTableNumber(tableId: string | null | undefined): string | null {
  if (!tableId) return null;
  const cached = getCached('GET', '/tables');
  const tables = Array.isArray(cached?.body) ? (cached!.body as Array<{ id: string; tableNumber?: string; number?: string }>) : [];
  const hit = tables.find((t) => t?.id === tableId);
  return hit?.tableNumber ?? hit?.number ?? null;
}

/**
 * Best-effort tax rate derived from the most recent cached real order. The
 * branch's tax rate isn't exposed on any endpoint the POS currently fetches
 * on login, so we infer it from `taxAmount / subtotal` on whatever real
 * order is sitting in cache. Falls back to 0 when nothing is cached.
 *
 * This is a hack, but it means the cashier's bill total matches what the
 * server will compute on drain for the common case (same branch, same tax
 * rate). When the cache is empty we show tax=0 and the server's idempotent
 * replay fixes it on reconnect.
 */
function inferTaxRate(): number {
  const lists = findCachedByPrefix('/orders');
  for (const { entry } of lists) {
    const list = Array.isArray(entry.body) ? (entry.body as Array<{ subtotal?: number; taxAmount?: number; discountAmount?: number }>) : [];
    for (const o of list) {
      const sub = Number(o?.subtotal ?? 0);
      const disc = Number(o?.discountAmount ?? 0);
      const base = sub - disc;
      const tax = Number(o?.taxAmount ?? 0);
      if (base > 0 && tax >= 0) return tax / base;
    }
  }
  return 0;
}

function computeTotals(items: OrderItem[], discountAmount = 0): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((s, it) => s + it.totalPrice, 0);
  const rate = inferTaxRate();
  const taxable = Math.max(0, subtotal - discountAmount);
  const taxAmount = Math.round(taxable * rate);
  return { subtotal, taxAmount, totalAmount: Math.max(0, subtotal - discountAmount + taxAmount) };
}

/**
 * Build a synthetic Order from a POST /orders request body. `body.items`
 * matches CreateOrderItemDto.
 */
export function buildCreateOrderResponse(
  body: { tableId?: string; waiterId?: string; customerId?: string; type: string; items: Array<{ menuItemId: string; quantity: number; notes?: string }>; notes?: string },
  branchId: string,
): Order {
  const user = getSessionUser();
  const orderId = syntheticId('order');
  recordSynthetic(orderId, 'order');
  const items: OrderItem[] = (body.items ?? []).map((src) => {
    const menu = findMenuItem(src.menuItemId);
    const unitPrice = menu?.price ?? 0;
    const itemId = syntheticId('item');
    recordSynthetic(itemId, 'item');
    return {
      id: itemId,
      menuItemId: src.menuItemId,
      menuItemName: menu?.name ?? 'Item',
      quantity: src.quantity,
      unitPrice,
      totalPrice: unitPrice * src.quantity,
      notes: src.notes ?? null,
      kitchenStatus: 'NEW',
      voidedAt: null,
      voidReason: null,
      voidedById: null,
      createdAt: now(),
      updatedAt: now(),
    };
  });
  const totals = computeTotals(items);
  const order: Order = {
    id: orderId,
    orderNumber: `OFFLINE-${Date.now().toString().slice(-6)}`,
    branchId,
    tableId: body.tableId ?? null,
    tableNumber: findTableNumber(body.tableId),
    type: body.type,
    status: 'CONFIRMED',
    items,
    payments: [],
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    discountAmount: 0,
    totalAmount: totals.totalAmount,
    notes: body.notes ?? null,
    cashierId: user?.id ?? '',
    cashierName: user?.name ?? '',
    waiterId: body.waiterId ?? null,
    billRequested: false,
    paymentMethod: null,
    paidAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  indexOrder(order);
  return order;
}

/**
 * Recreate the current Order state — prefer the shadow store (authoritative
 * while the outbox hasn't drained), fall back to cache if the order isn't
 * in the shadow (e.g. it was created online but is being modified offline).
 */
function loadOrder(orderId: string): Order | null {
  const shadow = getShadowOrder(orderId);
  if (shadow?.body) return shadow.body as Order;
  // Singular detail endpoint (rare — POS usually lists by table).
  const detail = getCached('GET', `/orders/${orderId}`);
  if (detail && detail.body && typeof detail.body === 'object' && !Array.isArray(detail.body)) {
    return detail.body as Order;
  }
  // Fall back to scanning list caches for an existing online order.
  const hits = findCachedByPrefix('/orders');
  for (const { entry } of hits) {
    const list = Array.isArray(entry.body) ? (entry.body as Order[]) : [];
    const found = list.find((o) => o?.id === orderId);
    if (found) return found;
  }
  return null;
}

/**
 * Persist the synthetic order to the shadow store (so offline GETs can find
 * it even if no cache existed for the active filter) AND patch any existing
 * list caches so React Query's immediate refetch sees it too.
 */
function indexOrder(order: Order): void {
  upsertShadowOrder({
    id: order.id,
    tableId: order.tableId,
    branchId: order.branchId,
    status: order.status,
    body: order,
  });
  // Patch singular detail cache so an eventual /orders/<id> GET finds it.
  updateCachedBody('GET', `/orders/${order.id}`, () => order);
  // Patch every existing list cache (/orders?tableId=...).
  const lists = findCachedByPrefix('/orders');
  for (const { path } of lists) {
    if (/^\/orders\/[^/?]+(?:[/?].*)?$/.test(path) && !path.startsWith('/orders?')) continue;
    updateCachedBody('GET', path, (body) => {
      const list = Array.isArray(body) ? (body as Order[]) : [];
      const idx = list.findIndex((o) => o?.id === order.id);
      if (idx >= 0) {
        const next = list.slice();
        next[idx] = order;
        return next;
      }
      const tableMatch = /tableId=([^&]+)/.exec(path);
      if (tableMatch && tableMatch[1] !== order.tableId) return list;
      const statusMatch = /status=([^&]+)/.exec(path);
      if (statusMatch) {
        const allowed = statusMatch[1].split(',').map(decodeURIComponent);
        if (!allowed.includes(order.status)) return list;
      }
      return [...list, order];
    });
  }
}

export function buildAddItemsResponse(
  orderId: string,
  body: Array<{ menuItemId: string; quantity: number; notes?: string }>,
): Order | null {
  const base = loadOrder(orderId);
  if (!base) return null;
  const newItems: OrderItem[] = body.map((src) => {
    const menu = findMenuItem(src.menuItemId);
    const unitPrice = menu?.price ?? 0;
    const itemId = syntheticId('item');
    recordSynthetic(itemId, 'item');
    return {
      id: itemId,
      menuItemId: src.menuItemId,
      menuItemName: menu?.name ?? 'Item',
      quantity: src.quantity,
      unitPrice,
      totalPrice: unitPrice * src.quantity,
      notes: src.notes ?? null,
      kitchenStatus: 'NEW',
      voidedAt: null,
      voidReason: null,
      voidedById: null,
      createdAt: now(),
      updatedAt: now(),
    };
  });
  const items = [...(base.items ?? []), ...newItems];
  const totals = computeTotals(items, base.discountAmount ?? 0);
  const updated: Order = {
    ...base,
    items,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    updatedAt: now(),
  };
  indexOrder(updated);
  return updated;
}

export function buildPaymentResponse(
  orderId: string,
  body: { method: string; amount: number; reference?: string; splits?: Array<{ method: string; amount: number; reference?: string }> },
): Order | null {
  const base = loadOrder(orderId);
  if (!base) return null;
  const splits = body.splits?.length
    ? body.splits
    : [{ method: body.method, amount: body.amount, reference: body.reference }];
  const payments: OrderPayment[] = splits.map((s) => {
    const id = syntheticId('pay');
    recordSynthetic(id, 'payment');
    return {
      id,
      orderId,
      method: s.method,
      amount: s.amount,
      reference: s.reference ?? null,
      createdAt: now(),
    };
  });
  const updated: Order = {
    ...base,
    status: 'PAID',
    payments: [...(base.payments ?? []), ...payments],
    paymentMethod: body.method,
    paidAt: now(),
    updatedAt: now(),
  };
  indexOrder(updated);
  return updated;
}

export function buildApplyDiscountResponse(
  orderId: string,
  body: { discountId: string; discountName?: string; discountAmount?: number },
): Order | null {
  const base = loadOrder(orderId);
  if (!base) return null;
  // We don't know the discount rules offline — best-effort: if the POS supplied
  // an amount, honor it. Otherwise zero it out and let the server recompute
  // on drain.
  const amount = Math.max(0, body.discountAmount ?? 0);
  const totals = computeTotals(base.items ?? [], amount);
  const updated: Order = {
    ...base,
    discountId: body.discountId,
    discountName: body.discountName ?? base.discountName ?? null,
    discountAmount: amount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    updatedAt: now(),
  };
  indexOrder(updated);
  return updated;
}

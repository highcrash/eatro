import { randomBytes } from 'crypto';
import { getCached, updateCachedBody, findCachedByPrefix } from './cache-store';
import { recordSynthetic } from './id-remap';
import { getSessionUser } from '../session/session';

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
  const tables = Array.isArray(cached?.body) ? (cached!.body as Array<{ id: string; number: string }>) : [];
  return tables.find((t) => t?.id === tableId)?.number ?? null;
}

function computeTotals(items: OrderItem[]): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((s, it) => s + it.totalPrice, 0);
  // Tax rate unknown offline — the server will recompute on replay, so we
  // leave it at zero rather than guessing wrong and surprising the cashier.
  return { subtotal, taxAmount: 0, totalAmount: subtotal };
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
  indexOrderInCache(order);
  return order;
}

/** Recreate the current Order by starting from whatever's in cache. */
function loadOrderFromCache(orderId: string): Order | null {
  // Orders list is cached as an array under /orders?tableId=X style keys.
  // Scan every /orders* entry.
  const hits = findCachedByPrefix('/orders');
  for (const { entry } of hits) {
    const list = Array.isArray(entry.body) ? (entry.body as Order[]) : [];
    const found = list.find((o) => o?.id === orderId);
    if (found) return found;
  }
  // Also check the singular detail endpoint.
  const detail = getCached('GET', `/orders/${orderId}`);
  if (detail && detail.body && typeof detail.body === 'object') return detail.body as Order;
  return null;
}

/**
 * Persist a synthetic or updated order back into every list cache so future
 * GETs (including the one React Query fires right after the mutation) show
 * it. Upserts by id.
 */
function indexOrderInCache(order: Order): void {
  // Update singular detail cache.
  {
    const entry = getCached('GET', `/orders/${order.id}`);
    if (entry) {
      updateCachedBody('GET', `/orders/${order.id}`, () => order);
    } else {
      // No prior detail — create one so the POS can fetch it offline.
      // We use a permissive status 200 placeholder.
      updateCachedBody('GET', `/orders/${order.id}`, () => order);
    }
  }
  // Upsert into every list cache (/orders, /orders?tableId=..., etc.)
  const lists = findCachedByPrefix('/orders');
  for (const { path } of lists) {
    // Skip detail entries like /orders/<id>.
    if (/^\/orders\/[^/?]+(?:[/?].*)?$/.test(path) && !path.startsWith('/orders?')) continue;
    updateCachedBody('GET', path, (body) => {
      const list = Array.isArray(body) ? (body as Order[]) : [];
      const idx = list.findIndex((o) => o?.id === order.id);
      if (idx >= 0) {
        const next = list.slice();
        next[idx] = order;
        return next;
      }
      // Only include on table-scoped lists if the order's table matches.
      const m = /tableId=([^&]+)/.exec(path);
      if (m && m[1] !== order.tableId) return list;
      return [...list, order];
    });
  }
}

export function buildAddItemsResponse(
  orderId: string,
  body: Array<{ menuItemId: string; quantity: number; notes?: string }>,
): Order | null {
  const base = loadOrderFromCache(orderId);
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
  const totals = computeTotals(items);
  const updated: Order = {
    ...base,
    items,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount - (base.discountAmount ?? 0),
    updatedAt: now(),
  };
  indexOrderInCache(updated);
  return updated;
}

export function buildPaymentResponse(
  orderId: string,
  body: { method: string; amount: number; reference?: string; splits?: Array<{ method: string; amount: number; reference?: string }> },
): Order | null {
  const base = loadOrderFromCache(orderId);
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
  indexOrderInCache(updated);
  return updated;
}

export function buildApplyDiscountResponse(
  orderId: string,
  body: { discountId: string; discountName?: string; discountAmount?: number },
): Order | null {
  const base = loadOrderFromCache(orderId);
  if (!base) return null;
  // We don't know the discount rules offline — best-effort: if the POS supplied
  // an amount, honor it. Otherwise zero it out and let the server recompute
  // on drain.
  const amount = Math.max(0, body.discountAmount ?? 0);
  const updated: Order = {
    ...base,
    discountId: body.discountId,
    discountName: body.discountName ?? base.discountName ?? null,
    discountAmount: amount,
    totalAmount: Math.max(0, (base.subtotal ?? 0) - amount),
    updatedAt: now(),
  };
  indexOrderInCache(updated);
  return updated;
}

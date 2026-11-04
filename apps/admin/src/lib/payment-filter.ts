import { useQuery } from '@tanstack/react-query';

import type { Order } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from './api';

/**
 * Orders store payment-option codes (e.g. BKASH_0040, or SPLIT with one
 * payment row per code). These helpers turn them into the account names
 * admin set up ("Mobile Banking → bKash 0040") for the payment filter
 * and the Payment column on the Orders and Sales Report pages.
 */

export interface PaymentOptionRow {
  code: string;
  name: string;
  isActive: boolean;
  category?: { id: string; code: string; name: string };
}

/** Every payment option, inactive ones too, so old orders still get names. */
export function usePaymentOptions() {
  return useQuery<PaymentOptionRow[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
  }).data ?? [];
}

/** The codes an order was paid with: its payment rows, else its method. */
function codesOf(order: Order): string[] {
  const rows = order.payments ?? [];
  if (rows.length > 0) return [...new Set(rows.map((p) => p.method))];
  return order.paymentMethod ? [order.paymentMethod] : [];
}

/** "bKash 0040", or "Cash ৳500 + bKash 0040 ৳300" for a split payment. */
export function paymentLabel(order: Order, options: Pick<PaymentOptionRow, 'code' | 'name'>[]): string {
  const name = (code: string) => options.find((o) => o.code === code)?.name ?? code;
  const rows = order.payments ?? [];
  if (rows.length > 1) return rows.map((p) => `${name(p.method)} ${formatCurrency(Number(p.amount))}`).join(' + ');
  const codes = codesOf(order);
  return codes.length > 0 ? codes.map(name).join(' + ') : '—';
}

export interface PaymentFilterGroup {
  label: string;
  /** Filter value for "every account in this group", if it has more than one. */
  all?: { value: string; label: string };
  options: { value: string; label: string }[];
}

/**
 * Dropdown groups for the accounts these orders were actually paid with,
 * grouped by category in admin's order. Values: `opt:<code>`,
 * `cat:<categoryId>`, or `SPLIT`.
 */
export function paymentFilterGroups(orders: Order[], options: PaymentOptionRow[]): PaymentFilterGroup[] {
  const used = new Set(orders.flatMap(codesOf));
  const groups = new Map<string, PaymentFilterGroup>();
  for (const o of options) {
    if (!used.has(o.code)) continue;
    const key = o.category?.id ?? '';
    const g = groups.get(key) ?? {
      label: o.category?.name ?? 'Other',
      all: o.category ? { value: `cat:${o.category.id}`, label: `All ${o.category.name}` } : undefined,
      options: [],
    };
    g.options.push({ value: `opt:${o.code}`, label: `${o.name}${o.isActive ? '' : ' (inactive)'}` });
    groups.set(key, g);
    used.delete(o.code);
  }
  // Codes with no payment option (older orders) still get a filter entry.
  const unknown = [...used].filter((c) => c !== 'SPLIT').sort();
  if (unknown.length > 0) {
    const g = groups.get('') ?? { label: 'Other', options: [] };
    g.options.push(...unknown.map((c) => ({ value: `opt:${c}`, label: c })));
    groups.set('', g);
  }
  return [...groups.values()].map((g) => (g.all && g.options.length < 2 ? { ...g, all: undefined } : g));
}

/** Codes a filter value covers (a category covers each of its accounts). */
function codesFor(filter: string, options: PaymentOptionRow[]): Set<string> {
  if (filter.startsWith('opt:')) return new Set([filter.slice(4)]);
  if (filter.startsWith('cat:')) {
    const id = filter.slice(4);
    return new Set(options.filter((o) => o.category?.id === id).map((o) => o.code));
  }
  return new Set();
}

/** Whether the order was paid (fully or in part) through the filter. */
export function matchesPayment(order: Order, filter: string, options: PaymentOptionRow[]): boolean {
  if (filter === 'SPLIT') return (order.payments?.length ?? 0) > 1 || order.paymentMethod === 'SPLIT';
  const codes = codesFor(filter, options);
  return codesOf(order).some((c) => codes.has(c));
}

/**
 * Money that actually went through the filter on these orders — for a
 * split order only its matching part counts.
 */
export function amountPaidVia(orders: Order[], filter: string, options: PaymentOptionRow[]): number {
  const codes = codesFor(filter, options);
  return orders.reduce((sum, o) => {
    const rows = o.payments ?? [];
    if (rows.length === 0) return sum + (o.paymentMethod && codes.has(o.paymentMethod) ? Number(o.totalAmount) : 0);
    return sum + rows.filter((p) => codes.has(p.method)).reduce((s, p) => s + Number(p.amount), 0);
  }, 0);
}

/** Readable name of a filter value, for print headers. */
export function paymentFilterLabel(filter: string, groups: PaymentFilterGroup[]): string {
  if (filter === 'SPLIT') return 'Split payments';
  for (const g of groups) {
    if (g.all?.value === filter) return g.all.label;
    const o = g.options.find((x) => x.value === filter);
    if (o) return g.label === 'Other' ? o.label : `${g.label} → ${o.label}`;
  }
  return filter;
}

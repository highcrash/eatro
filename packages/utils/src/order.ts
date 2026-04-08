import type { OrderItem } from '@restora/types';

/** Calculate order subtotal from items */
export function calculateSubtotal(items: Pick<OrderItem, 'unitPrice' | 'quantity'>[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

/** Calculate total with tax and discount applied */
export function calculateTotal(
  subtotal: number,
  taxAmount: number,
  discountAmount: number,
): number {
  return subtotal + taxAmount - discountAmount;
}

/** Group order items by category for kitchen tickets */
export function groupByKitchenStation<T extends { menuItemId: string }>(
  items: T[],
  stationMap: Record<string, string>,
): Record<string, T[]> {
  return items.reduce(
    (groups, item) => {
      const station = stationMap[item.menuItemId] ?? 'MAIN';
      if (!groups[station]) groups[station] = [];
      groups[station].push(item);
      return groups;
    },
    {} as Record<string, T[]>,
  );
}

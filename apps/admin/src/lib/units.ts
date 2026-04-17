import { useQuery } from '@tanstack/react-query';
import type { CustomUnit, StockUnit } from '@restora/types';
import { api } from './api';

// Built-in units hard-coded in the StockUnit Prisma enum. Shown first in
// dropdowns; stays stable across branches.
export const BUILTIN_UNITS: StockUnit[] = [
  'KG', 'G', 'L', 'ML', 'PCS', 'DOZEN', 'BOX',
  'PACKET', 'PACK', 'BOTTLE', 'BAG', 'BUNDLE', 'CAN', 'JAR', 'TIN', 'CARTON',
];

/**
 * Returns all unit codes the current branch can use — built-in plus any
 * custom units the admin has registered in Settings → Units. Custom
 * units live behind `ALTER TYPE "StockUnit" ADD VALUE`, so Postgres
 * accepts them as StockUnit enum values at write time.
 *
 * Safe to use even before the query resolves: falls back to the
 * built-in list until /custom-units responds.
 */
export function useStockUnits(): { units: StockUnit[]; customUnits: CustomUnit[] } {
  const { data: customUnits = [] } = useQuery<CustomUnit[]>({
    queryKey: ['custom-units'],
    queryFn: () => api.get<CustomUnit[]>('/custom-units'),
    // Unit metadata rarely changes after branch setup; 5 min is plenty.
    staleTime: 5 * 60 * 1000,
  });
  const units: StockUnit[] = [
    ...BUILTIN_UNITS,
    ...customUnits.map((c) => c.code as StockUnit),
  ];
  return { units, customUnits };
}

/** Lookup friendly label for a unit code (custom first, else the code itself). */
export function unitLabel(code: string, customUnits: CustomUnit[]): string {
  const custom = customUnits.find((c) => c.code === code);
  return custom?.label ?? code;
}

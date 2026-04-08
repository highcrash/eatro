import { useQuery } from '@tanstack/react-query';
import type { CashierPermissions } from '@restora/types';
import { DEFAULT_CASHIER_PERMISSIONS } from '@restora/types';
import { api } from './api';

/**
 * Live cashier permissions for the active branch.
 * POS pages call this to know which buttons to render and which approval mode
 * each action requires.
 */
export function useCashierPermissions() {
  return useQuery<CashierPermissions>({
    queryKey: ['cashier-permissions'],
    queryFn: () => api.get('/cashier-permissions'),
    staleTime: 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    placeholderData: DEFAULT_CASHIER_PERMISSIONS,
  });
}

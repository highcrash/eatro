import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface BranchSettings {
  id: string;
  branchId: string;
  useKds: boolean;
  smsEnabled: boolean;
  notifyVoidOtp: boolean;
  /** Master toggle: print the recipe block under each item on Kitchen
   *  Tickets. Off → no recipe rows on any KT regardless of per-item
   *  flags. */
  kotShowRecipe?: boolean;
  // Other fields exist on the DB model but the POS only needs these today.
  [key: string]: unknown;
}

export function useBranchSettings() {
  return useQuery<BranchSettings>({
    queryKey: ['branch-settings'],
    queryFn: () => api.get<BranchSettings>('/branch-settings'),
    staleTime: 60_000,
  });
}

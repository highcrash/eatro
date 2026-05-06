import { useQuery } from '@tanstack/react-query';
import type { Order } from '@restora/types';
import type { KitchenTicketInput } from '@restora/utils';
import { api } from './api';

export interface KtRecipeRow {
  menuItemId: string;
  kotHideRecipe: boolean;
  recipe: Array<{ ingredientName: string; quantity: number; unit: string }>;
}

/**
 * Fetch every menu item's recipe bundle for the branch. Used by the
 * POS at print time to attach the recipe block under each line on the
 * kitchen ticket. One round-trip per session — caches indefinitely
 * because the data only changes when admin edits the recipe page.
 */
export function useKtRecipes() {
  return useQuery<KtRecipeRow[]>({
    queryKey: ['menu-kt-recipes'],
    queryFn: () => api.get<KtRecipeRow[]>('/menu/kt-recipes'),
    // Recipes change rarely. Don't refetch on every window-focus.
    staleTime: 5 * 60_000,
  });
}

/**
 * Decorate the order with recipe data + the branch's master toggle so
 * the kitchen-ticket renderer (HTML + ESC/POS) can draw the small
 * recipe block under each item line. Pass-through when the branch
 * toggle is off — the renderer's `hideRecipe` flag short-circuits all
 * per-item logic.
 */
export function attachRecipesToTicket(
  order: Order,
  recipes: KtRecipeRow[] | undefined,
  branchSettings: { kotShowRecipe?: boolean } | undefined,
): KitchenTicketInput {
  const branchHideRecipe = branchSettings?.kotShowRecipe === false;
  const byId = new Map<string, KtRecipeRow>();
  for (const r of recipes ?? []) byId.set(r.menuItemId, r);
  const items = (order.items ?? []).map((it) => {
    const row = byId.get(it.menuItemId);
    return {
      ...(it as unknown as KitchenTicketInput['items'][number]),
      recipe: row?.recipe ?? null,
      hideRecipe: row?.kotHideRecipe ?? false,
    };
  });
  return {
    ...(order as unknown as KitchenTicketInput),
    items,
    hideRecipe: branchHideRecipe,
  };
}

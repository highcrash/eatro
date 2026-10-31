import { useQuery } from '@tanstack/react-query';
import type { Order, OrderItemComboPart } from '@restora/types';
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

type TicketItem = KitchenTicketInput['items'][number];

/**
 * Split each combo line into one ticket line per part, so every dish
 * prints at its own station (desktop groups by menuItemId) with its own
 * recipe — "2-: Eatro Special Pizza 12 Inch — Buddy Combo". The line's
 * note carries over to every part; per-line removals/addons don't apply
 * to combo parts. Non-combo lines pass through unchanged.
 */
export function expandComboLines(
  items: Array<TicketItem & { id?: string; comboItems?: OrderItemComboPart[] | null }>,
  recipesById: Map<string, KtRecipeRow>,
): TicketItem[] {
  return items.flatMap((it) => {
    const parts = it.comboItems ?? [];
    if (parts.length === 0) return [it];
    return parts.map((p) => {
      const row = recipesById.get(p.menuItemId);
      return {
        ...it,
        id: it.id ? `${it.id}:${p.menuItemId}` : undefined,
        menuItemId: p.menuItemId,
        menuItemName: `${p.name} — ${it.menuItemName}`,
        quantity: it.quantity * p.quantity,
        removedIngredients: null,
        modifications: null,
        selectedAddons: null,
        addons: null,
        addedIngredients: null,
        comboItems: null,
        recipe: row?.recipe ?? null,
        hideRecipe: row?.kotHideRecipe ?? false,
      };
    });
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
  const items = expandComboLines(
    (order.items ?? []).map((it) => {
      const row = byId.get(it.menuItemId);
      return {
        ...(it as unknown as TicketItem),
        id: it.id,
        comboItems: it.comboItems ?? null,
        recipe: row?.recipe ?? null,
        hideRecipe: row?.kotHideRecipe ?? false,
      };
    }),
    byId,
  );
  return {
    ...(order as unknown as KitchenTicketInput),
    items,
    hideRecipe: branchHideRecipe,
  };
}

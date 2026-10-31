import type { ComboChoiceInput, MenuItem, OrderItemComboPart } from '@restora/types';

/** A combo's "guest picks" slot, e.g. Fizz ×4 across Coke / Sprite / Fanta. */
export interface ComboChoiceGroup {
  name: string;
  /** How many the guest picks in total. */
  size: number;
  options: { id: string; name: string }[];
}

/** One cart-side pick: how many of an option, per one combo. */
export interface ComboPick extends ComboChoiceInput {
  name: string;
}

const sortedRows = (menuItem: MenuItem) => [...(menuItem.comboItems ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

/** The choice slots of a combo (empty for non-combos and fixed-only combos). */
export function comboChoiceGroups(menuItem: MenuItem): ComboChoiceGroup[] {
  if (!menuItem.isCombo) return [];
  const groups = new Map<string, ComboChoiceGroup>();
  for (const row of sortedRows(menuItem)) {
    if (!row.choiceGroup) continue;
    const g = groups.get(row.choiceGroup) ?? { name: row.choiceGroup, size: row.quantity, options: [] };
    g.options.push({ id: row.includedItemId, name: row.includedItem?.name ?? 'Item' });
    groups.set(row.choiceGroup, g);
  }
  return [...groups.values()];
}

/**
 * What one unit of a combo contains given the cashier's picks — mirrors
 * the server's resolveComboForLine so the +ADD kitchen ticket matches
 * what gets stored. A slot without picks gets its first option.
 */
export function comboPartsFor(menuItem: MenuItem, picks?: ComboChoiceInput[]): OrderItemComboPart[] | null {
  if (!menuItem.isCombo) return null;
  const rows = sortedRows(menuItem);
  if (rows.length === 0) return null;
  const parts: OrderItemComboPart[] = [];
  for (const row of rows.filter((r) => !r.choiceGroup)) {
    parts.push({ menuItemId: row.includedItemId, name: row.includedItem?.name ?? 'Item', quantity: row.quantity, choiceGroup: null });
  }
  for (const g of comboChoiceGroups(menuItem)) {
    const chosen = g.options
      .map((o) => ({ ...o, quantity: picks?.find((p) => p.includedItemId === o.id)?.quantity ?? 0 }))
      .filter((o) => o.quantity > 0);
    const filled = chosen.length ? chosen : [{ ...g.options[0], quantity: g.size }];
    for (const o of filled) parts.push({ menuItemId: o.id, name: o.name, quantity: o.quantity, choiceGroup: g.name });
  }
  return parts;
}

/** "2× Fizz · 1× Fizz White" for the cart line. */
export function describePicks(picks?: ComboPick[]): string | null {
  const shown = (picks ?? []).filter((p) => p.quantity > 0);
  return shown.length ? shown.map((p) => `${p.quantity}× ${p.name}`).join(' · ') : null;
}

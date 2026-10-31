/**
 * Combo contents helpers shared by ordering, stock deduction and reports.
 *
 * A combo's ComboItem rows are either fixed parts (choiceGroup null) or
 * options of a choice slot: rows sharing a choiceGroup label are
 * alternatives, and their `quantity` is the slot size (e.g. "Fizz" ×4
 * across Coke / Sprite / Fanta). The first option by sortOrder is the
 * default when an order doesn't say what the guest picked.
 */

/** One part of one ordered combo unit — what OrderItem.comboItems stores. */
export interface ComboPart {
  menuItemId: string;
  name: string;
  quantity: number;
  choiceGroup?: string | null;
}

export interface ComboRow {
  includedItemId: string;
  quantity: number;
  choiceGroup: string | null;
  sortOrder: number;
  includedItem?: { name?: string; [key: string]: unknown } | null;
}

/** Parts of one combo unit with every choice slot filled by its first option. */
export function defaultComboParts(rows: ComboRow[]): ComboPart[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const parts: ComboPart[] = [];
  const seenGroups = new Set<string>();
  for (const r of sorted) {
    if (r.choiceGroup) {
      if (seenGroups.has(r.choiceGroup)) continue;
      seenGroups.add(r.choiceGroup);
    }
    parts.push({ menuItemId: r.includedItemId, name: r.includedItem?.name ?? '', quantity: r.quantity, choiceGroup: r.choiceGroup });
  }
  return parts;
}

/** Narrow an OrderItem.comboItems JSON value to parts, or null when absent/invalid. */
export function readComboParts(value: unknown): ComboPart[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter(
    (p): p is ComboPart => !!p && typeof p === 'object' && typeof (p as ComboPart).menuItemId === 'string' && Number((p as ComboPart).quantity) > 0,
  );
  return parts.length ? parts.map((p) => ({ ...p, quantity: Number(p.quantity) })) : null;
}

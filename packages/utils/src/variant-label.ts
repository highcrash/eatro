/**
 * Single canonical formatter for ingredient-variant display labels.
 *
 * Format:   "Parent Name — Brand Name (Pack Size)"
 * Example:  "ABC Sauce — ABC (1 L Bottle)"
 *
 * Graceful degradation when fields are missing:
 *   brand + pack          → "Parent — Brand (Pack)"
 *   brand only            → "Parent — Brand"
 *   pack only             → "Parent — (Pack)"   (rare — shouldn't happen in practice)
 *   neither, id given     → "Parent — variant xxxxxx"
 *   not a variant at all  → "Parent"
 *
 * Purchase-unit / piecesPerPack / base unit are intentionally NOT in the
 * label — they're metadata the UI shows in dedicated columns (Unit
 * column, Cost column etc.), and cramming them into the name made it
 * unreadable on narrow POS rows. Keep those fields on the type so
 * callers can still pass them without breaking — they're simply ignored
 * by the formatter today.
 */

export interface VariantLabelInput {
  parentName: string;
  brandName?: string | null;
  packSize?: string | null;
  /** Accepted but unused — see header comment. Kept so call sites don't break. */
  piecesPerPack?: number | null;
  purchaseUnit?: string | null;
  purchaseUnitQty?: number | null;
  unit?: string | null;
  /** Optional id used for the "variant xxxxxx" fallback when brand + pack are both missing. */
  id?: string | null;
}

function clean(s: string | null | undefined): string {
  return (s ?? '').toString().trim();
}

export function formatVariantLabel(v: VariantLabelInput): string {
  const parent = clean(v.parentName);
  const brand = clean(v.brandName);
  const pack = clean(v.packSize);

  // Core variant descriptor.
  let descriptor: string;
  if (brand && pack) descriptor = `${brand} (${pack})`;
  else if (brand) descriptor = brand;
  else if (pack) descriptor = `(${pack})`;
  else if (v.id) descriptor = `variant ${v.id.slice(-6)}`;
  else return parent; // non-variant ingredient — parent name only.

  return `${parent} — ${descriptor}`;
}

/**
 * Display helper for joined ingredient rows coming back from purchasing,
 * supplier-ledger, receive, and return queries. The variant's stored
 * `name` already embeds the parent prefix ("Parent — Brand"), so the
 * only piece missing from the ledger display is the pack size. This
 * wraps that one line of logic so callers don't reinvent it.
 */
export function ingredientDisplayName(ing: { name?: string | null; packSize?: string | null } | null | undefined): string {
  const name = clean(ing?.name);
  const pack = clean(ing?.packSize);
  if (!name) return '—';
  return pack ? `${name} (${pack})` : name;
}

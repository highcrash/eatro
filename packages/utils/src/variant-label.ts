/**
 * One canonical formatter for ingredient-variant display labels. Used
 * across shopping list, purchasing, receiving, returns, waste, print
 * sheets, and ledger/stock-movement notes so suppliers + users always
 * see the same shape.
 *
 * Canonical format:
 *   "ParentName — BrandName PackSize UNIT (PurchaseUnit) (PiecesPerPack PackSize PurchaseUnitQty unit)"
 *
 * Example — full fields:
 *   parent="ABC Sauce", brand="ABC", pack="Bottle", unit="ml",
 *   purchaseUnit="PCS", purchaseUnitQty=1, piecesPerPack=1
 *   →  "ABC Sauce — ABC Bottle ML (PCS) (1 Bottle 1 ml)"
 *
 * Graceful degradation — any field that's null/missing gets dropped
 * from the output without leaving an orphan arrow / empty parens:
 *   brand-only         → "Parent — BrandName"
 *   pack-only          → "Parent — PackSize"
 *   brand + pack       → "Parent — BrandName PackSize"
 *   neither + id given → "Parent — variant abc123"
 *   non-variant        → parent name only
 */

export interface VariantLabelInput {
  parentName: string;
  brandName?: string | null;
  packSize?: string | null;
  piecesPerPack?: number | null;
  purchaseUnit?: string | null;
  purchaseUnitQty?: number | null;
  /** Base unit (e.g. "kg", "ml", "L"). Shown UPPERCASED in primary descriptor. */
  unit?: string | null;
  /** Optional id used for the "variant xxxxxx" fallback when brand + pack are both missing. */
  id?: string | null;
}

function clean(s: string | null | undefined): string {
  return (s ?? '').toString().trim();
}

export function formatVariantLabel(v: VariantLabelInput): string {
  const parent = clean(v.parentName);

  // Primary descriptor — Brand + Pack + UPPERCASE(unit). Omit empties.
  const primaryParts = [clean(v.brandName), clean(v.packSize), clean(v.unit).toUpperCase()].filter(Boolean);
  let primary = primaryParts.join(' ');
  if (!primary) {
    primary = v.id ? `variant ${v.id.slice(-6)}` : '';
  }

  // Purchase unit — how the item is priced / ordered (e.g. per PCS, per CASE).
  const pu = clean(v.purchaseUnit);
  const puSegment = pu ? ` (${pu})` : '';

  // Extended description — PiecesPerPack PackSize PurchaseUnitQty unit.
  // Helps a supplier who knows "case of 24 × 500 ml bottles" more than
  // "ABC Bottle ML (CASE)". Only emit when at least two fields are
  // present — one-field output looks lopsided.
  const extended: string[] = [];
  if (v.piecesPerPack != null && v.piecesPerPack > 0) extended.push(String(v.piecesPerPack));
  if (clean(v.packSize)) extended.push(clean(v.packSize));
  if (v.purchaseUnitQty != null && v.purchaseUnitQty > 0) extended.push(String(v.purchaseUnitQty));
  if (clean(v.unit)) extended.push(clean(v.unit));
  const extSegment = extended.length >= 2 ? ` (${extended.join(' ')})` : '';

  if (!primary) return parent; // non-variant ingredient — just return parent name.
  return `${parent} — ${primary}${puSegment}${extSegment}`;
}

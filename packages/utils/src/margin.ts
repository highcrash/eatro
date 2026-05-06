/**
 * Custom-menu / added-ingredient pricing band helpers.
 *
 * Restaurant industry standard: a "margin %" is gross-profit-margin
 * measured against the SELLING price, not a markup against cost. The
 * formula is `selling = cost / (1 - margin/100)` — i.e. at 80% margin
 * the cost is 20% of the selling price (selling ≈ 5× cost), at 50%
 * margin selling = 2× cost, etc.
 *
 * This file is the single source of truth used by the POS Custom
 * Menu dialog, the POS Customise Line dialog, the server-side band
 * validator on order create / addItems, and the admin Performance
 * Report's "suggested margin" hint. Earlier each site used a
 * `cost × (1 + margin/100)` markup formula; the rename + formula
 * switch is intentional so the field labelled "margin" actually
 * computes a margin (matches admin expectations from cost-of-goods
 * spreadsheets, accounting reports, and standard menu-engineering
 * texts).
 *
 * `margin` is clamped to [0, 99]. Values >= 100 would divide by zero
 * (or go negative) and aren't meaningful as margins anyway. UI
 * inputs cap typing at 99 too — see admin Settings → Kitchen.
 */

/** Selling price implied by a target gross margin on the given cost. */
export function priceFromMargin(cost: number, marginPct: number | null | undefined): number {
  if (cost <= 0) return cost;
  const m = clampMargin(marginPct);
  if (m <= 0) return cost; // no margin requested → floor = cost itself
  return Math.round(cost / (1 - m / 100));
}

/** Clamp a user-typed margin into the valid [0, 99] range. */
export function clampMargin(m: number | null | undefined): number {
  if (m == null || !Number.isFinite(Number(m))) return 0;
  const n = Number(m);
  if (n < 0) return 0;
  if (n > 99) return 99;
  return n;
}

/**
 * Resolve a complete custom-menu band from cost + branch settings.
 * Floor + Ceiling are both gross-margin-on-selling. Negotiate floor
 * is a flat percent shaved off the floor (still cost-relative — a
 * "10% off the floor" promo for a regular customer), so the cashier
 * has wiggle room without dropping below the cost margin entirely.
 */
export function computeMarginBand(
  cost: number,
  costMarginPct: number | null,
  negotiatePct: number | null,
  maxMarginPct: number | null,
): { floor: number; minPrice: number; ceiling: number | null } {
  const floor = costMarginPct != null
    ? priceFromMargin(cost, costMarginPct)
    : cost;
  const minPrice = negotiatePct != null && Number(negotiatePct) > 0
    ? Math.round(floor * (1 - clampMargin(negotiatePct) / 100))
    : floor;
  const ceiling = maxMarginPct != null
    ? priceFromMargin(cost, maxMarginPct)
    : null;
  return { floor, minPrice, ceiling };
}

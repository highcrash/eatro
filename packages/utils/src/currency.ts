/**
 * Format a monetary amount (stored as paisa/cents) to display string.
 * @param amount - value in smallest unit (paisa for BDT)
 * @param currency - ISO currency code, defaults to BDT
 */
export function formatCurrency(amount: number, currency = 'BDT'): string {
  const major = amount / 100;
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(major);
}

/** Convert taka/major unit to paisa/smallest unit */
export function toSmallestUnit(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert paisa/smallest unit to taka/major unit */
export function toMajorUnit(amount: number): number {
  return amount / 100;
}

/** Calculate tax amount */
export function calculateTax(subtotal: number, taxRate: number): number {
  return Math.round(subtotal * (taxRate / 100));
}

/** Calculate percentage discount */
export function calculateDiscount(subtotal: number, discountPct: number): number {
  return Math.round(subtotal * (discountPct / 100));
}

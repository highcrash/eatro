/** Generate a human-readable order number: ORD-YYYYMMDD-XXXX */
export function generateOrderNumber(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${y}${m}${d}-${rand}`;
}

/**
 * Deterministic 6-char alphanumeric display code derived from an order
 * id (or any opaque id). Same input → same output, every time, on every
 * surface — receipts, sales reports, reprints. Used INSTEAD of the
 * verbose `ORD-YYYYMMDD-XXXX` order number on customer-facing prints
 * and the cashier sales-report grid, so we don't leak the date / random
 * sequence the supplier could otherwise count.
 *
 * Alphabet excludes ambiguous chars (0/O/1/I) so the code stays
 * legible from a thermal-printed receipt.
 */
export function shortOrderCode(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  let h = Math.abs(hash);
  for (let i = 0; i < 6; i++) {
    result += chars[h % chars.length];
    h = Math.floor(h / chars.length) + i;
  }
  return result;
}

/** Truncate a string to maxLen with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Slugify a name for URL-safe identifiers */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Capitalize first letter of each word */
export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

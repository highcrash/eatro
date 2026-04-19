/**
 * Shared seed defaults used by every variant. Anything brand-neutral
 * lives here:
 *
 *   - Generic payment categories + options
 *   - Random-password helper (always logged once to stdout so the
 *     operator can copy it; never persisted, never reused).
 *
 * Brand-specific data (restaurant name, menu items, staff names,
 * phone numbers, addresses) lives in the per-variant files.
 */
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export const BCRYPT_ROUNDS = 12;

/**
 * 14 chars, lowercase + digits + 2 symbols. Strong enough that a
 * leaked stdout log isn't catastrophic on its own; weak enough that
 * the operator can copy + paste without typos.
 */
export function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%';
  const buf = randomBytes(16);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[buf[i]! % chars.length];
  for (let i = 0; i < 2; i++) out += symbols[buf[12 + i]! % symbols.length];
  return out;
}

/** Print a password block once so the operator can capture it. */
export function announcePassword(label: string, plain: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n  ╭─ ${label} ─────────────────────────────╮`);
  // eslint-disable-next-line no-console
  console.log(`  │  password: ${plain}                       │`);
  // eslint-disable-next-line no-console
  console.log(`  │  (logged once — copy it now; not stored)  │`);
  // eslint-disable-next-line no-console
  console.log(`  ╰────────────────────────────────────────────╯\n`);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Default payment categories: CASH, CARD, MFS, DIGITAL. These are
 * Bangladesh-flavored but the codes are generic — the names render
 * fine in any locale. Buyers can edit/remove from Settings → Payments.
 */
export const DEFAULT_PAYMENT_METHODS: { code: string; name: string; sortOrder: number }[] = [
  { code: 'CASH', name: 'Cash', sortOrder: 0 },
  { code: 'CARD', name: 'Card', sortOrder: 1 },
  { code: 'MFS', name: 'Mobile Banking', sortOrder: 2 },
  { code: 'DIGITAL', name: 'Digital Payment', sortOrder: 3 },
];

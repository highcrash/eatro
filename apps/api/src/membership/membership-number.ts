import { randomInt } from 'crypto';

/** Card numbers start with this ("EATR" on a phone keypad). */
export const CARD_PREFIX = '3287';
export const MAX_SERIAL = 9999;

/** Luhn check digit for the digits before it (same method as bank cards). */
export function luhnCheckDigit(digits: string): string {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/** prefix (4) + serial (4) + random (7) + check digit (1). */
export function buildCardNumber(serial: number, random: () => number = () => randomInt(0, 10_000_000)): string {
  const body = `${CARD_PREFIX}${String(serial).padStart(4, '0')}${String(random()).padStart(7, '0')}`;
  return body + luhnCheckDigit(body);
}

/** Digits only, so "3287 0001 4829 1736" and a scanned QR match alike. */
export function normalizeCardNumber(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidCardNumber(digits: string): boolean {
  return /^\d{16}$/.test(digits) && digits.startsWith(CARD_PREFIX) && luhnCheckDigit(digits.slice(0, 15)) === digits[15];
}

/** "3287 0001 4829 1736" */
export function formatCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "•••• 1736", for receipts and the POS. */
export function maskCardNumber(digits: string): string {
  return `•••• ${digits.slice(-4)}`;
}

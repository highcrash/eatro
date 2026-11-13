import type { MenuUnit } from './menu-context';

export interface PartyOptionInput {
  label: string;
  lines: { ref: string; qty: number }[];
}

export interface PartyCharges {
  /** Percent, 0 when the branch has VAT switched off. */
  vatPercent: number;
  /** Percent, 0 when the branch has no service charge. */
  servicePercent: number;
}

export interface PricedPartyOption {
  label: string;
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  serviceCharge: number;
  vat: number;
  total: number;
  perHead: number;
}

export const PARTY_MIN_GUESTS = 2;
export const PARTY_MAX_GUESTS = 500;
const MAX_OPTIONS = 3;
const MAX_LINES = 15;

/**
 * Prices the dish mix the AI proposed. All money comes from the live
 * menu here; the AI only chooses dishes and quantities. Charges follow
 * the till: service charge on the food total, then VAT on both.
 * Options with an unknown dish or a silly quantity are dropped.
 */
export function priceParty(
  guests: number,
  options: PartyOptionInput[],
  byRef: Map<string, MenuUnit>,
  charges: PartyCharges,
): PricedPartyOption[] {
  if (!Number.isInteger(guests) || guests < PARTY_MIN_GUESTS || guests > PARTY_MAX_GUESTS) return [];
  const priced: PricedPartyOption[] = [];

  for (const option of options.slice(0, MAX_OPTIONS)) {
    if (!option || !Array.isArray(option.lines) || option.lines.length === 0 || option.lines.length > MAX_LINES) continue;
    const lines: PricedPartyOption['lines'] = [];
    let valid = true;
    for (const line of option.lines) {
      const unit = byRef.get(String(line?.ref ?? '').trim());
      const qty = Number(line?.qty);
      // A sharing dish may be ordered several per guest, but not without limit.
      if (!unit || !Number.isInteger(qty) || qty < 1 || qty > guests * 3) {
        valid = false;
        break;
      }
      lines.push({ name: unit.name, qty, unitPrice: unit.price, lineTotal: round2(unit.price * qty) });
    }
    if (!valid) continue;

    const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
    const serviceCharge = Math.round(subtotal * (charges.servicePercent / 100));
    const vat = Math.round((subtotal + serviceCharge) * (charges.vatPercent / 100));
    const total = round2(subtotal + serviceCharge + vat);
    priced.push({
      label: String(option.label || `Option ${priced.length + 1}`).slice(0, 30),
      lines,
      subtotal,
      serviceCharge,
      vat,
      total,
      perHead: Math.ceil(total / guests),
    });
  }
  return priced;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `৳${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The quote block appended to the reply. Numbers only, so it reads in any language. */
export function formatPartyQuote(guests: number, options: PricedPartyOption[]): string {
  return options
    .map((o) => {
      const dishes = o.lines.map((l) => `• ${l.qty}× ${l.name}`).join('\n');
      const extras = [o.serviceCharge > 0 ? `service charge ${money(o.serviceCharge)}` : '', o.vat > 0 ? `VAT ${money(o.vat)}` : ''].filter(Boolean);
      const note = extras.length > 0 ? ` (incl. ${extras.join(', ')})` : '';
      return `${o.label}: ${money(o.perHead)} per head, ${money(o.total)} for ${guests}${note}\n${dishes}`;
    })
    .join('\n\n');
}

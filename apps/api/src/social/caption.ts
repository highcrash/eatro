/**
 * Facebook auto-post caption builder.
 *
 * Supports two modes:
 *   1. Default template — owner's literal block.
 *   2. Custom template stored on `BranchSetting.fbCaptionTemplate`.
 *
 * Both walk the same set of `{PLACEHOLDER}` tokens. Anything not
 * recognised is left as-is so admins can include their own static
 * text. Empty / null custom template falls back to the default.
 */

interface CaptionInput {
  productName: string;
  /** Original price in paisa. */
  oldPrice: number;
  /** Discounted price in paisa. */
  newPrice: number;
  /** Day list (uppercase day names). null = every day. */
  days: string[] | null;
  validTill: Date;
  /** Optional human-readable time range, e.g. "5pm – 9pm". */
  timeRange?: string | null;
  address: string;
  phone: string;
}

/** Default template. Matches the literal block the owner pasted —
 *  used when the branch hasn't customised its template yet, and
 *  shown as the placeholder in the Settings textarea. */
export const DEFAULT_CAPTION_TEMPLATE = [
  '🔥 {PRODUCT NAME} – Special Offer!',
  '',
  'Enjoy your favourite {PRODUCT NAME} at a better price! 😍',
  '',
  '💸 Now: BDT {NEW PRICE}',
  'Was: BDT {OLD PRICE}',
  '🎉 Save BDT {DISCOUNT} OFF!',
  '',
  '📅 Offer Days: {DAYS} Only',
  '⏳ Valid Till: {DATE}',
  '🕒 Time: {TIME RANGE}',
  '',
  "Don't miss out—grab yours while the offer lasts!",
  '',
  'Only at Eatro — Where flavour takes the lead.',
  '',
  '📍 {ADDRESS}',
  '📞 {PHONE}',
  '',
  '#EatroOffers #SpecialDeal #FoodDeals #EatroDhaka #FlavourTakesTheLead',
].join('\n');

const DAY_LABEL: Record<string, string> = {
  SUNDAY: 'Sunday',
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
};

function formatDays(days: string[] | null): string {
  if (!days || days.length === 0 || days.length >= 7) return 'Every Day';
  return days.map((d) => DAY_LABEL[d] ?? d).join(', ');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function bdt(paisa: number): string {
  const taka = paisa / 100;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(taka);
}

/** Render the caption.
 *  - `template` falls back to DEFAULT_CAPTION_TEMPLATE when null/empty.
 *  - When `timeRange` is null/empty AND the template contains the
 *    `{TIME RANGE}` placeholder on its own line, the entire line is
 *    dropped so we don't print "🕒 Time:" with nothing after it. */
export function buildDiscountCaption(
  input: CaptionInput,
  template?: string | null,
): string {
  const tpl = (template?.trim().length ? template : DEFAULT_CAPTION_TEMPLATE).trim();

  const discount = Math.max(0, input.oldPrice - input.newPrice);
  const subs: Record<string, string> = {
    '{PRODUCT NAME}': input.productName,
    '{NEW PRICE}': bdt(input.newPrice),
    '{OLD PRICE}': bdt(input.oldPrice),
    '{DISCOUNT}': bdt(discount),
    '{DAYS}': formatDays(input.days),
    '{DATE}': formatDate(input.validTill),
    '{TIME RANGE}': input.timeRange?.trim() ?? '',
    '{ADDRESS}': input.address,
    '{PHONE}': input.phone,
  };

  // Two-pass: drop empty {TIME RANGE} lines first, then substitute.
  const lines = tpl.split('\n').filter((line) => {
    if (!line.includes('{TIME RANGE}')) return true;
    const tr = subs['{TIME RANGE}'];
    return tr.length > 0;
  });
  let out = lines.join('\n');
  for (const [token, value] of Object.entries(subs)) {
    out = out.split(token).join(value);
  }
  return out;
}

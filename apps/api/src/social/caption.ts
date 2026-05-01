/**
 * Owner-supplied caption template for menu-discount auto-posts.
 * Substitutes the live discount values into the literal block the
 * owner pasted, leaving the optional Time Range line out when absent.
 *
 * The template is intentionally fixed — the owner wants every post
 * to follow the same visual cadence on the FB page so customers
 * recognise it as Eatro branding.
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
  // "Friday, May 30, 2026"
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

export function buildDiscountCaption(input: CaptionInput): string {
  const { productName, oldPrice, newPrice, days, validTill, timeRange, address, phone } = input;
  const discount = Math.max(0, oldPrice - newPrice);
  const lines: string[] = [];
  lines.push(`🔥 ${productName} – Special Offer!`);
  lines.push('');
  lines.push(`Enjoy your favourite ${productName} at a better price! 😍`);
  lines.push('');
  lines.push(`💸 Now: BDT ${bdt(newPrice)}`);
  lines.push(`Was: BDT ${bdt(oldPrice)}`);
  lines.push(`🎉 Save BDT ${bdt(discount)} OFF!`);
  lines.push('');
  lines.push(`📅 Offer Days: ${formatDays(days)} Only`);
  lines.push(`⏳ Valid Till: ${formatDate(validTill)}`);
  if (timeRange && timeRange.trim()) {
    lines.push(`🕒 Time: ${timeRange.trim()}`);
  }
  lines.push('');
  lines.push("Don't miss out—grab yours while the offer lasts!");
  lines.push('');
  lines.push('Only at Eatro — Where flavour takes the lead.');
  lines.push('');
  lines.push(`📍 ${address}`);
  lines.push(`📞 ${phone}`);
  lines.push('');
  lines.push('#EatroOffers #SpecialDeal #FoodDeals #EatroDhaka #FlavourTakesTheLead');
  return lines.join('\n');
}

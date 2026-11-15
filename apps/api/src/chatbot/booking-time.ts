import { toAsciiDigits } from './text';

const PM_WORDS = /(sondha|sondhya|shondha|bikal|bikel|rat|raat|rate|raate|সন্ধ্যা|সন্ধ্যায়|সন্ধা|বিকাল|বিকেল|বিকালে|বিকেলে|রাত|রাতে|evening|night|tonight)/i;
const NOON_WORDS = /(dupur|dupure|দুপুর|দুপুরে|afternoon|noon)/i;
const AM_WORDS = /(sokal|shokal|সকাল|সকালে|morning)/i;

/**
 * A time the AI or a customer wrote, as 24-hour "HH:mm": "19:30", "19.30",
 * "7:30 PM", "7.30pm", "৭:৩০", "সন্ধ্যা ৭টা", "1930". Null when it is not a time.
 */
export function normalizeTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = toAsciiDigits(raw).toLowerCase().trim();
  const m = /(?<!\d)(\d{1,2})(?:\s*[:.]\s*(\d{2})|(\d{2}))?(?!\d)/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  if (h > 23 || min > 59) return null;
  // No \b: "7.30pm" has no word break between the 0 and the p.
  const pm = /(?<![a-z])(pm|p\.m\.?)(?![a-z])/.test(t) || PM_WORDS.test(t);
  const am = /(?<![a-z])(am|a\.m\.?)(?![a-z])/.test(t) || AM_WORDS.test(t);
  if (h <= 12) {
    if (pm && h < 12) h += 12;
    else if (am && h === 12) h = 0;
    else if (!am && NOON_WORDS.test(t) && h >= 1 && h <= 6) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * A time with no am or pm, read in the restaurant's hours: when it falls
 * before the first slot but the evening one is inside them, the customer
 * meant the evening ("6.30" → 18:30 for a restaurant that opens at noon).
 */
export function inOpeningHours(time: string, slots: string[]): string {
  if (slots.length === 0 || slots.includes(time)) return time;
  const h = Number(time.slice(0, 2));
  if (h >= 12) return time;
  const later = `${String(h + 12).padStart(2, '0')}${time.slice(2)}`;
  const first = slots[0];
  const last = slots[slots.length - 1];
  return time < first && later >= first && later <= last ? later : time;
}

/**
 * A message that is only a time ("19.30", "7.30 pm", "রাত ৮টা", "at 6:30"),
 * as "HH:mm". A bare number ("4") is not taken as a time: it is often the
 * number of guests.
 */
export function timeOnlyMessage(text: string): string | null {
  const t = toAsciiDigits(text).toLowerCase().trim().replace(/[?!.।]+$/, '');
  if (t.length > 40) return null;
  const rest = t
    .replace(/(?<!\d)\d{1,2}(\s*[:.]\s*\d{2})?(?!\d)/, ' ')
    .replace(/(?<![a-z])(pm|am|p\.m|a\.m)(?![a-z])/g, ' ')
    .replace(/\b(at|around|by|o'?clock|ok|okay|ta|tay|tai|e|baje|bajay|time|please|plz|vai|bhai|apu|ji|jii|hae|ha|haa|yes)\b/g, ' ')
    .replace(/(টা|টায়|টার|বাজে|এ|সময়|জি|হ্যাঁ|ঠিক আছে|ভাই|আপু)/g, ' ')
    .replace(new RegExp(PM_WORDS.source, 'gi'), ' ')
    .replace(new RegExp(NOON_WORDS.source, 'gi'), ' ')
    .replace(new RegExp(AM_WORDS.source, 'gi'), ' ')
    .replace(/[\s,:.\-]+/g, '');
  if (rest) return null;
  const hasClock = /\d{1,2}\s*[:.]\s*\d{2}/.test(t) || /(?<![a-z])(pm|am|p\.m|a\.m)(?![a-z])/.test(t) || PM_WORDS.test(t) || NOON_WORDS.test(t) || AM_WORDS.test(t) || /(টা|বাজে|baje)/.test(t);
  return hasClock ? normalizeTime(t) : null;
}

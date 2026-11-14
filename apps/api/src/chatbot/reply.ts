import type { MenuSnapshot } from './menu-context';
import type { PartyOptionInput } from './party-planner';
import { ReplyLang, toAsciiDigits } from './text';

export type AiAction =
  | { type: 'booking_request'; date: string | null; time: string | null; guests: number | null; name: string | null; occasion: string | null }
  | { type: 'party_quote'; guests: number; date: string | null; time: string | null; occasion: string | null; options: PartyOptionInput[] }
  | { type: 'handoff'; reason: string };

export interface AiReply {
  lang: ReplyLang;
  reply: string;
  /** Menu refs the reply is about. */
  items: string[];
  action: AiAction | null;
}

const MAX_REPLY_CHARS = 1500;

/** The reply language for a customer's text: Bangla script, Banglish and Bangla-English mixes all get Bangla. */
export function detectLang(text: string): ReplyLang {
  if (/[ঀ-৿]/.test(text)) return 'bn';
  const banglish = /\b(ache|achhe|ase|nai|nei|koto|kothay|kokhon|kobe|chai|lagbe|korbo|korte|hobe|ki|kom|dam|daam|amar|apnar|apnader|jon|jonno|khola|bondho|vai|bhai|apu|taka|valo|bhalo|khabar|khete|dhonnobad)\b/i;
  return banglish.test(text) ? 'bn' : 'en';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(toAsciiDigits(v)) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

function parseAction(raw: unknown): AiAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'booking_request':
      return { type: 'booking_request', date: str(a.date), time: str(a.time), guests: int(a.guests), name: str(a.name), occasion: str(a.occasion) };
    case 'party_quote': {
      const guests = int(a.guests);
      if (!guests || !Array.isArray(a.options)) return null;
      const options: PartyOptionInput[] = [];
      for (const o of a.options as unknown[]) {
        const opt = o as { label?: unknown; lines?: unknown };
        if (!opt || !Array.isArray(opt.lines)) continue;
        options.push({
          label: str(opt.label) ?? '',
          lines: (opt.lines as { ref?: unknown; qty?: unknown }[]).map((l) => ({ ref: String(l?.ref ?? ''), qty: Number(l?.qty) })),
        });
      }
      return { type: 'party_quote', guests, date: str(a.date), time: str(a.time), occasion: str(a.occasion), options };
    }
    case 'handoff':
      return { type: 'handoff', reason: str(a.reason) ?? 'Customer needs a team member' };
    default:
      return null;
  }
}

/**
 * EATRO's customers greet with salam. Models trained on Indian Bangla often
 * open with নমস্কার or Namaste, so that is swapped before anyone sees it.
 */
export function fixGreeting(text: string): string {
  return text
    .replace(/নমস্কার|নমস্তে|নমষ্কার/g, 'আসসালামু আলাইকুম')
    .replace(/\b(namaskar|nomoskar|namaste|namastey)\b/gi, 'Assalamu alaikum');
}

/**
 * Reads the model's answer. The contract is one JSON object, but weaker
 * models wrap it in a code fence or answer in plain sentences; a plain
 * answer is accepted as a reply with no action, and still price-checked.
 */
export function parseAiReply(raw: string, customerText: string): AiReply | null {
  const text = raw.trim();
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const looksLikeJson = text.startsWith('{') || text.startsWith('```') || (start >= 0 && end > start);
  if (looksLikeJson) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const said = str(obj.reply);
      const reply = said ? fixGreeting(said) : null;
      if (reply) {
        const lang = obj.lang === 'en' ? 'en' : obj.lang === 'bn' || obj.lang === 'banglish' ? 'bn' : detectLang(customerText);
        const items = Array.isArray(obj.items) ? (obj.items as unknown[]).map((i) => String(i).trim()).filter(Boolean).slice(0, 5) : [];
        return { lang, reply, items, action: parseAction(obj.action) };
      }
    } catch {
      /* fall through */
    }
    // Looked like JSON but wasn't usable: showing it to a customer would be worse than the fallback.
    return null;
  }
  return { lang: detectLang(customerText), reply: fixGreeting(text), items: [], action: null };
}

/** Every amount of money written in a text, in taka. */
export function amountsIn(text: string): number[] {
  const t = toAsciiDigits(text);
  const found: number[] = [];
  const patterns = [
    /৳\s?(\d[\d,]*(?:\.\d+)?)/g,
    /(\d[\d,]*(?:\.\d+)?)\s?(?:taka|tk\b|bdt|টাকা|\/-|\/=)/gi,
    /(?:\btk|\bbdt|\btaka)\.?\s?(\d[\d,]*(?:\.\d+)?)/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n)) found.push(n);
    }
  }
  return found;
}

export type ReplyCheck = { ok: true; reply: AiReply } | { ok: false; reason: 'UNKNOWN_ITEM' | 'UNKNOWN_PRICE' | 'TOO_LONG' };

/**
 * The gate every AI reply passes before a customer sees it: the dishes it
 * points at must exist, and every price it quotes must be a live menu
 * price (or a multiple of a referenced dish's price, or a figure from the
 * owner's own rules).
 */
export function checkReply(reply: AiReply, menu: MenuSnapshot, ownerAmounts: Set<number>): ReplyCheck {
  if (reply.reply.length > MAX_REPLY_CHARS) return { ok: false, reason: 'TOO_LONG' };
  for (const ref of reply.items) if (!menu.byRef.has(ref)) return { ok: false, reason: 'UNKNOWN_ITEM' };

  const referenced = reply.items.map((ref) => menu.byRef.get(ref)!.price);
  const sumOfReferenced = referenced.reduce((a, b) => a + b, 0);
  const allowed = (amount: number) => {
    if (menu.prices.has(amount) || ownerAmounts.has(amount)) return true;
    if (referenced.length > 1 && Math.abs(amount - sumOfReferenced) < 0.01) return true;
    return referenced.some((p) => p > 0 && Number.isInteger(amount / p) && amount / p >= 2 && amount / p <= 50);
  };
  for (const amount of amountsIn(reply.reply)) if (!allowed(amount)) return { ok: false, reason: 'UNKNOWN_PRICE' };

  // The model is told not to print its handles; drop any that slipped through.
  const cleaned = reply.reply.replace(/\s?#\d+\b/g, (m) => (menu.byRef.has(m.trim()) ? '' : m)).trim();
  return { ok: true, reply: { ...reply, reply: cleaned } };
}

/** Figures the owner wrote into rules (an advance, a minimum spend) may be quoted too. */
export function ownerAmounts(...texts: (string | null | undefined)[]): Set<number> {
  const out = new Set<number>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of toAsciiDigits(t).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return out;
}

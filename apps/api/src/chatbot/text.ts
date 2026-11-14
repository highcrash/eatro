import { normalizePhone } from '../customer/customer.service';

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** ০১৭… → 017… so phones and prices written in Bangla digits are read too. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

/** Lowercase, punctuation to spaces, single-spaced. Keeps Bangla letters. */
export function normalizeText(text: string): string {
  return toAsciiDigits(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// +880 1X… / 8801X… / 01X…, with spaces or dashes between groups.
const PHONE_RE = /(?<!\d)(?:\+?880[\s-]?|0)1[3-9](?:[\s-]?\d){8}(?!\d)/g;

/**
 * Pull a Bangladeshi mobile number out of a customer's message.
 * `masked` is what the AI sees: the number is kept on our server only.
 */
export function extractPhone(text: string): { phone: string | null; masked: string } {
  const ascii = toAsciiDigits(text);
  let phone: string | null = null;
  const masked = ascii.replace(PHONE_RE, (match) => {
    const normalized = normalizePhone(match.replace(/[\s-]/g, ''));
    if (!normalized) return match;
    phone ??= normalized;
    return '[phone number]';
  });
  return { phone, masked: phone ? masked : text };
}

export interface QuickReplyRow {
  id: string;
  keywords: string;
  answer: string;
  priority: number;
}

const QUICK_REPLY_MAX_WORDS = 8;

/**
 * Pre-ready answers. A reply fires when one of its phrases appears as
 * whole words in a short message. Long messages, and messages that hit
 * two different replies, go to the AI: "party of 40, when do you open?"
 * deserves more than the opening hours.
 */
export function matchQuickReply<T extends QuickReplyRow>(text: string, replies: T[]): T | null {
  const message = normalizeText(text);
  if (!message) return null;
  const words = message.split(' ').length;
  const padded = ` ${message} `;

  const hits: { reply: T; length: number; exact: boolean }[] = [];
  for (const reply of replies) {
    let best = 0;
    let exact = false;
    for (const raw of reply.keywords.split(/[\n,]/)) {
      const phrase = normalizeText(raw);
      if (!phrase) continue;
      if (message === phrase) exact = true;
      if (padded.includes(` ${phrase} `)) best = Math.max(best, phrase.length);
    }
    if (best > 0) hits.push({ reply, length: best, exact });
  }
  if (hits.length === 0) return null;

  const exact = hits.filter((h) => h.exact);
  if (exact.length > 0) return exact.sort((a, b) => b.reply.priority - a.reply.priority)[0].reply;
  if (words > QUICK_REPLY_MAX_WORDS || hits.length > 1) return null;
  return hits[0].reply;
}

export function fillPlaceholders(answer: string, values: Record<string, string | null | undefined>): string {
  return answer.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export type ReplyLang = 'en' | 'bn' | 'banglish';

/** Fixed sentences the server adds itself, so they never depend on the AI. */
const PHRASES = {
  estimate: {
    en: 'These are estimates. Our team will confirm the final price and menu with you.',
    bn: 'এগুলো আনুমানিক হিসাব। আমাদের টিম আপনার সাথে চূড়ান্ত মূল্য ও মেনু নিশ্চিত করবে।',
    banglish: 'Egulo estimate. Amader team apnar sathe final price ar menu confirm korbe.',
  },
  bookingReceived: {
    en: 'Booking request received: {guests} guests, {date} at {time}. We will confirm shortly.',
    bn: 'বুকিং অনুরোধ পেয়েছি: {guests} জন, {date}, {time}। আমরা শীঘ্রই নিশ্চিত করব।',
    banglish: 'Booking request peyechi: {guests} jon, {date}, {time}. Amra shighroi confirm korbo.',
  },
  slotChoices: {
    en: 'That time is not available. Open times on {date}: {slots}. Which one suits you?',
    bn: 'ওই সময়টি খালি নেই। {date} তারিখে খালি সময়: {slots}। কোনটি আপনার জন্য সুবিধাজনক?',
    banglish: 'Oi shomoy ta khali nei. {date} e khali shomoy: {slots}. Konta apnar jonno bhalo?',
  },
  noSlots: {
    en: 'We have no free table for {guests} guests on {date}. Our team will contact you to arrange it.',
    bn: '{date} তারিখে {guests} জনের জন্য খালি টেবিল নেই। আমাদের টিম আপনার সাথে যোগাযোগ করবে।',
    banglish: '{date} e {guests} joner jonno khali table nei. Amader team apnar sathe jogajog korbe.',
  },
  largeParty: {
    en: 'For {guests} guests our team arranges the booking personally. We have passed your details on and will call you to confirm.',
    bn: '{guests} জনের বুকিং আমাদের টিম সরাসরি ব্যবস্থা করে। আপনার তথ্য পাঠিয়ে দিয়েছি, নিশ্চিত করতে আমরা কল করব।',
    banglish: '{guests} joner booking amader team nijei arrange kore. Apnar details pathiye diyechi, confirm korte call korbo.',
  },
  visionSure: {
    en: 'This looks like our {name}: ৳{price}.',
    bn: 'এটি আমাদের {name} মনে হচ্ছে: ৳{price}।',
    banglish: 'Eta amader {name} mone hocche: ৳{price}.',
  },
  visionChoices: {
    en: 'Is it one of these?',
    bn: 'এগুলোর কোনোটি কি?',
    banglish: 'Egulor kono ekta ki?',
  },
  visionNone: {
    en: "Thanks for the photo. I couldn't match it to a dish on our menu, so I've asked a team member to take a look.",
    bn: 'ছবির জন্য ধন্যবাদ। মেনুর কোনো খাবারের সাথে মেলাতে পারিনি, তাই আমাদের টিমের একজনকে দেখতে বলেছি।',
    banglish: 'Chobir jonno dhonnobad. Menur kono khabarer sathe melate parini, tai amader team er ekjon ke dekhte bolechi.',
  },
  imageOff: {
    en: 'Thanks for the photo. Could you type the dish name or your question? A team member will also take a look.',
    bn: 'ছবির জন্য ধন্যবাদ। খাবারের নাম বা আপনার প্রশ্নটি লিখে দেবেন? আমাদের টিমও দেখে নেবে।',
    banglish: 'Chobir jonno dhonnobad. Khabarer nam ba apnar proshno ta likhe diben? Amader team o dekhe nibe.',
  },
  imageLimit: {
    en: "I can't read more photos today. Please type your question and I'll help.",
    bn: 'আজ আর ছবি দেখতে পারছি না। প্রশ্নটি লিখে দিন, আমি সাহায্য করব।',
    banglish: 'Aj ar chobi dekhte parchi na. Proshno ta likhe din, ami help korbo.',
  },
  voice: {
    en: "Sorry, I can't listen to voice messages. Could you type your question? A team member will also take a look.",
    bn: 'দুঃখিত, ভয়েস মেসেজ শুনতে পারি না। প্রশ্নটি লিখে দেবেন? আমাদের টিমও দেখে নেবে।',
    banglish: 'Dukkhito, voice message shunte pari na. Proshno ta likhe diben? Amader team o dekhe nibe.',
  },
  sharedPostOne: {
    en: 'That post is our {name}: ৳{price}.',
    bn: 'ওই পোস্টটি আমাদের {name}: ৳{price}।',
    banglish: 'Oi post ta amader {name}: ৳{price}.',
  },
  testMode: {
    en: '(Test mode: nothing was saved.)',
    bn: '(Test mode: nothing was saved.)',
    banglish: '(Test mode: nothing was saved.)',
  },
} as const;

export function phrase(key: keyof typeof PHRASES, lang: ReplyLang, values: Record<string, string | number> = {}): string {
  return PHRASES[key][lang].replace(/\{(\w+)\}/g, (whole, k: string) => (k in values ? String(values[k]) : whole));
}

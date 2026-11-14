import type { CommentKind, ComplaintLevel } from '@prisma/client';

import { detectLang } from './reply';
import { normalizeText, ReplyLang } from './text';

export interface Classification {
  kind: CommentKind;
  level: ComplaintLevel | null;
  topic: string | null;
  lang: ReplyLang;
  /** True when keywords decided it; false means "unclear", worth asking the AI. */
  sure: boolean;
}

/** Whole-word phrase lists. Bangla script is matched as substrings, since it has no word case. */
const LISTS = {
  serious: [
    'food poisoning', 'got sick', 'fell sick', 'vomit', 'vomiting', 'diarrhea', 'diarrhoea', 'stomach ache', 'hair in', 'cockroach', 'insect', 'worm', 'fly in',
    'rotten', 'stale', 'expired', 'raw chicken', 'undercooked chicken', 'rude', 'misbehave', 'misbehaved', 'misbehaviour', 'misbehavior', 'harass', 'harassed',
    'charged twice', 'double charged', 'overcharged', 'cheated', 'fraud', 'scam', 'pocha', 'bashi', 'telapoka', 'chul pawa', 'osustho', 'oshustho', 'baje behavior',
    'kharap bebohar', 'beyadob', 'থেকে অসুস্থ', 'অসুস্থ', 'পচা', 'বাসি', 'তেলাপোকা', 'চুল', 'খারাপ ব্যবহার', 'বেয়াদব', 'প্রতারণা', 'বমি',
  ],
  complaint: [
    'cold food', 'food was cold', 'was cold', 'served cold', 'late', 'waited', 'waiting for', 'slow service', 'too slow', 'slow', 'bland', 'tasteless', 'too salty', 'salty', 'too oily', 'oily',
    'burnt', 'small portion', 'portion was small', 'disappointed', 'disappointing', 'worst', 'terrible', 'horrible', 'awful', 'pathetic', 'not good', 'not fresh', 'bad experience',
    'bad service', 'bad food', 'never again', 'never coming back', 'waste of money', 'wrong order', 'missing item', 'thanda', 'deri', 'onek deri', 'kharap', 'baje', 'jogonno', 'faltu',
    'bekar', 'ঠান্ডা', 'দেরি', 'খারাপ', 'বাজে', 'জঘন্য', 'ফালতু', 'বেকার', 'হতাশ',
  ],
  mild: ['pricey', 'a bit expensive', 'too expensive', 'overpriced', 'expensive', 'used to be better', 'not as good', 'could be better', 'dam beshi', 'daam beshi', 'onek dam', 'দাম বেশি'],
  abuse: ['fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'khanki', 'magi', 'madarchod', 'bokachoda', 'chudi', 'choda', 'harami', 'kuttar bacha', 'shuorer bacha', 'খানকি', 'মাগি', 'হারামি', 'চোদা'],
  price: ['price', 'prices', 'pp', 'p p', 'rate', 'cost', 'how much', 'koto', 'dam', 'daam', 'dam koto', 'price plz', 'price please', 'menu price', 'taka', 'দাম', 'কত', 'প্রাইস', 'মূল্য'],
  booking: ['book', 'booking', 'reserve', 'reservation', 'table for', 'party', 'birthday', 'anniversary', 'event', 'seat', 'seats', 'group', 'bukin', 'buking', 'বুকিং', 'টেবিল', 'পার্টি', 'জন্মদিন', 'রিজার্ভ'],
  info: ['where', 'location', 'address', 'kothay', 'kotha', 'thikana', 'open', 'opening', 'closing', 'timing', 'hours', 'kokhon', 'khola', 'delivery', 'home delivery', 'parking', 'halal', 'branch', 'কোথায়', 'ঠিকানা', 'খোলা', 'কখন', 'ডেলিভারি', 'লোকেশন'],
  praise: ['love', 'loved', 'awesome', 'delicious', 'yummy', 'tasty', 'best', 'great', 'nice', 'amazing', 'excellent', 'superb', 'wonderful', 'fantastic', 'osadharon', 'darun', 'joss', 'josh', 'moja', 'mojar', 'অসাধারণ', 'দারুণ', 'মজা', 'মজার', 'সেরা', 'চমৎকার'],
} as const;

const TOPICS: [string, string[]][] = [
  ['HYGIENE', ['hair', 'cockroach', 'insect', 'worm', 'fly in', 'dirty', 'telapoka', 'chul', 'তেলাপোকা', 'চুল', 'নোংরা']],
  ['FOOD', ['cold', 'bland', 'tasteless', 'salty', 'oily', 'burnt', 'rotten', 'stale', 'sick', 'vomit', 'food', 'taste', 'thanda', 'pocha', 'bashi', 'খাবার', 'ঠান্ডা', 'পচা', 'বাসি']],
  ['SERVICE', ['rude', 'waiter', 'staff', 'service', 'misbehav', 'harass', 'bebohar', 'beyadob', 'ব্যবহার', 'বেয়াদব']],
  ['WAITING', ['late', 'wait', 'slow', 'deri', 'দেরি']],
  ['BILLING', ['charged', 'bill', 'overcharged', 'refund', 'fraud', 'cheat', 'বিল']],
  ['PRICE', ['price', 'expensive', 'pricey', 'dam', 'দাম']],
];

function has(message: string, phrases: readonly string[]): boolean {
  const padded = ` ${message} `;
  return phrases.some((p) => {
    if (/[ঀ-৿]/.test(p)) return message.includes(p);
    return padded.includes(` ${p} `) || (p.length >= 6 && message.includes(p));
  });
}

const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|xyz|info|link|top|bd|io|me|ly|shop)\b|wa\.me|t\.me)/i;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s❤️♥️]+$/u;

export function topicOf(text: string): string {
  const m = normalizeText(text);
  return TOPICS.find(([, words]) => has(m, words))?.[0] ?? 'OTHER';
}

/** Complaint level for any customer text (comments and chats), or null when it isn't a complaint. */
export function complaintLevel(text: string): ComplaintLevel | null {
  const m = normalizeText(text);
  if (has(m, LISTS.serious)) return 'SERIOUS';
  if (has(m, LISTS.complaint)) return 'ORDINARY';
  if (has(m, LISTS.mild)) return 'MILD';
  return null;
}

/**
 * Sorts a post comment. Order matters: abuse and spam first, then any
 * complaint (a complaint that mentions a price is still a complaint),
 * then the questions we can answer, then praise.
 */
export function classifyComment(text: string, ownSiteHost = 'eatrobd.com'): Classification {
  const raw = (text ?? '').trim();
  const lang = detectLang(raw);
  const base = { level: null, topic: null, lang };
  if (!raw || EMOJI_ONLY_RE.test(raw)) return { ...base, kind: 'IGNORE', sure: true };

  const m = normalizeText(raw);
  if (has(m, LISTS.abuse)) return { ...base, kind: 'ABUSE', topic: 'ABUSE', sure: true };
  // Judge whole words, so "https://eatrobd.com/menu" counts as our own link.
  const links = raw.split(/\s+/).filter((w) => LINK_RE.test(w));
  if (links.some((l) => !l.toLowerCase().includes(ownSiteHost))) return { ...base, kind: 'SPAM', sure: true };

  const level = complaintLevel(raw);
  if (level && !(level === 'MILD' && has(m, LISTS.praise))) return { ...base, kind: 'COMPLAINT', level, topic: topicOf(raw), sure: true };

  if (has(m, LISTS.booking)) return { ...base, kind: 'BOOKING', sure: true };
  if (has(m, LISTS.price) || /^\s*(\?+|price\s*\?*|pp\s*\??)\s*$/i.test(raw)) return { ...base, kind: 'PRICE', sure: true };
  if (has(m, LISTS.info)) return { ...base, kind: 'INFO', sure: true };
  if (has(m, LISTS.praise)) return { ...base, kind: 'PRAISE', sure: true };

  // Friend tags ("Rahim Ahmed", "@nadia cholo") and other short chatter.
  const words = m.split(' ').filter(Boolean);
  if (raw.startsWith('@') || words.length <= 3) return { ...base, kind: 'IGNORE', sure: true };
  return { ...base, kind: 'OTHER', sure: false };
}

/** Pick one of several wordings so the Page doesn't post the same sentence again and again. */
export function rotate<T>(options: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

export const COMMENT_REPLIES = {
  priceOne: {
    en: ['{name} is ৳{price}. Details sent to your inbox 💬', '{name}: ৳{price}. Check your inbox for more 😊', 'It is ৳{price} for {name}. We have sent you the details 📩'],
    bn: ['{name}: ৳{price}। বিস্তারিত ইনবক্সে পাঠিয়েছি 💬', '{name} এর দাম ৳{price}। ইনবক্স চেক করুন 😊'],
    banglish: ['{name}: ৳{price}. Details inbox e pathiyechi 💬', '{name} er dam ৳{price}. Inbox check korun 😊'],
  },
  priceInbox: {
    en: ['Details sent to your inbox 💬', 'We have sent you the prices in a message 📩', 'Check your inbox, we have sent the details 😊'],
    bn: ['বিস্তারিত ইনবক্সে পাঠিয়েছি 💬', 'দামসহ বিস্তারিত মেসেজে পাঠিয়েছি 📩'],
    banglish: ['Details inbox e pathiyechi 💬', 'Dam shoho details message e pathiyechi 📩'],
  },
  booking: {
    en: ["We'd love to host you! Check your inbox 📩", 'Happy to help with that. We have messaged you 😊'],
    bn: ['আপনাকে স্বাগত জানাতে পেরে খুশি হব! ইনবক্স চেক করুন 📩', 'অবশ্যই সাহায্য করব। আপনাকে মেসেজ করেছি 😊'],
    banglish: ['Apnake host korte pele khushi hobo! Inbox check korun 📩', 'Oboshshoi help korbo. Apnake message korechi 😊'],
  },
  praise: {
    en: ['Thank you so much! 🧡', 'Thank you! See you again soon 😊', 'So glad you enjoyed it! 🧡'],
    bn: ['অনেক ধন্যবাদ! 🧡', 'ধন্যবাদ! আবার আসবেন 😊'],
    banglish: ['Onek dhonnobad! 🧡', 'Dhonnobad! Abar ashben 😊'],
  },
  complaintHolding: {
    en: ["We're sorry to hear this, {name}. Please check your inbox so our manager can look into it today."],
    bn: ['দুঃখিত, {name}। অনুগ্রহ করে ইনবক্স চেক করুন, আমাদের ম্যানেজার আজই বিষয়টি দেখবেন।'],
    banglish: ['Dukkhito, {name}. Inbox check korben, amader manager aj-i bishoy ta dekhben.'],
  },
} as const;

export const PRIVATE_REPLIES = {
  price: {
    en: 'Hi {name}! Thanks for asking. {details}\nWould you like to book a table? Just tell me the date, time and number of guests.',
    bn: 'হ্যালো {name}! জানতে চাওয়ার জন্য ধন্যবাদ। {details}\nটেবিল বুক করতে চাইলে তারিখ, সময় আর কতজন জানিয়ে দিন।',
    banglish: 'Hello {name}! Jante chawar jonno dhonnobad. {details}\nTable book korte chaile date, time ar kotojon janiye din.',
  },
  priceMenu: {
    en: 'Our full menu with prices is here: {menuUrl}',
    bn: 'আমাদের পুরো মেনু ও দাম এখানে: {menuUrl}',
    banglish: 'Amader puro menu ar dam ekhane: {menuUrl}',
  },
  booking: {
    en: "Hi {name}! Happy to help with your booking. Please tell me the date, time and number of guests, and I'll send the request.",
    bn: 'হ্যালো {name}! বুকিংয়ে সাহায্য করতে পেরে খুশি। তারিখ, সময় আর কতজন জানিয়ে দিন, আমি অনুরোধ পাঠিয়ে দেব।',
    banglish: 'Hello {name}! Booking e help korte pere khushi. Date, time ar kotojon janiye din, ami request pathiye dibo.',
  },
  complaint: {
    en: "Hi {name}, I'm sorry about your experience. I've passed this to our manager, who will reply here shortly.",
    bn: 'হ্যালো {name}, আপনার অভিজ্ঞতার জন্য দুঃখিত। বিষয়টি আমাদের ম্যানেজারকে জানিয়েছি, তিনি শীঘ্রই এখানে উত্তর দেবেন।',
    banglish: 'Hello {name}, apnar obhiggotar jonno dukkhito. Bishoy ta amader manager ke janiyechi, uni shighroi ekhane reply diben.',
  },
} as const;

/** The one line a complaining customer gets in a private chat before staff take over. */
export const CHAT_COMPLAINT_LINE: Record<ReplyLang, string> = {
  en: "I'm sorry about this. I'm passing it to our manager now, who will reply here shortly.",
  bn: 'এর জন্য দুঃখিত। এখনই আমাদের ম্যানেজারকে জানাচ্ছি, তিনি শীঘ্রই এখানে উত্তর দেবেন।',
  banglish: 'Er jonno dukkhito. Ekhoni amader manager ke janacchi, uni shighroi ekhane reply diben.',
};

export const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (w, k: string) => (k in v ? String(v[k]) : w));

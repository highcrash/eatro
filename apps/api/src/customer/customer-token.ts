import { createHmac, hkdfSync, timingSafeEqual } from 'crypto';

import { UnauthorizedException } from '@nestjs/common';

/**
 * Signed tokens for customers of the QR app and website. A customer only
 * gets one by typing the SMS code, and every endpoint that reads or
 * changes a customer's data checks it, instead of trusting a customer id
 * sent by the browser.
 *
 *  - session: "this browser is customer X of branch B", for 30 days.
 *  - signup:  "this browser proved it owns phone P", for 15 minutes, so
 *             a brand-new customer can finish signing up.
 */
const SESSION_MS = 30 * 24 * 3600_000;
const SIGNUP_MS = 15 * 60_000;

type Claims =
  | { k: 'session'; cid: string; bid: string; exp: number }
  | { k: 'signup'; phone: string; bid: string; exp: number };

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const source = process.env.JWT_SECRET?.trim();
  if (!source) throw new Error('JWT_SECRET must be set for customer logins');
  cachedKey = Buffer.from(hkdfSync('sha256', source, 'restora-customer', 'customer-session-v1', 32));
  return cachedKey;
}

function sign(claims: Claims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = createHmac('sha256', key()).update(body).digest('base64url');
  return `c1.${body}.${mac}`;
}

function read(token: string | undefined | null): Claims | null {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  const [version, body, mac] = token.split('.');
  if (version !== 'c1' || !body || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', key()).update(body).digest('base64url'));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
    if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function customerSessionToken(customerId: string, branchId: string): string {
  return sign({ k: 'session', cid: customerId, bid: branchId, exp: Date.now() + SESSION_MS });
}

export function signupToken(branchId: string, phone: string): string {
  return sign({ k: 'signup', phone, bid: branchId, exp: Date.now() + SIGNUP_MS });
}

/** The logged-in customer, or null. When `branchId` is given the token must be for that branch. */
export function sessionCustomerId(token: string | undefined | null, branchId?: string | null): string | null {
  const c = read(token);
  if (!c || c.k !== 'session') return null;
  if (branchId && c.bid !== branchId) return null;
  return c.cid;
}

/** Like sessionCustomerId, but a missing or expired login is a 401 the apps answer by logging out. */
export function requireCustomer(token: string | undefined | null, branchId?: string | null): string {
  const cid = sessionCustomerId(token, branchId);
  if (!cid) throw new UnauthorizedException({ code: 'CUSTOMER_LOGIN_REQUIRED', message: 'Please log in again with your phone number.' });
  return cid;
}

/** The phone this browser verified by SMS for signup, or null. */
export function signupPhone(token: string | undefined | null, branchId: string): string | null {
  const c = read(token);
  if (!c || c.k !== 'signup' || c.bid !== branchId) return null;
  return c.phone;
}

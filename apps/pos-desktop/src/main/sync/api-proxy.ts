import { randomBytes } from 'crypto';
import { readConfig } from '../config/store';
import {
  getAccessToken,
  getRefreshToken,
  updateAccessToken,
} from '../session/session';
import { onlineDetector } from './online-detector';
import { enqueue } from './outbox';
import { getCached, setCached } from './cache-store';
import { rewritePath, isSynthetic } from './id-remap';
import {
  buildCreateOrderResponse,
  buildAddItemsResponse,
  buildPaymentResponse,
  buildApplyDiscountResponse,
} from './synthetic';
import { listShadowOrders, getShadowOrder, parseOrderListPath } from './shadow-orders';

/**
 * Central HTTP proxy that every renderer API call flows through. Handles:
 *   - attaching session tokens and Idempotency-Key headers
 *   - serving GETs from a SQLite cache when offline (cache survives restart)
 *   - synthesizing plausible responses for offline mutations so the POS
 *     keeps flowing as if the network succeeded (orders, items, payments,
 *     apply-discount — voids go through the basic queue path)
 *   - transparent 401 refresh
 */

export interface ApiFetchInput {
  method: string;
  path: string;                 // relative, e.g. "/orders"
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface ApiFetchResult {
  status: number;
  ok: boolean;
  body: unknown;
  queued?: boolean;
  idempotencyKey?: string;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function cuid32(): string { return randomBytes(16).toString('hex'); }

/**
 * Does this path target an offline-synthesizable mutation? We only synthesize
 * what the cashier's hot path needs; voids and approvals fall through to the
 * plain queue and will replay when online.
 */
function offlineSynthesizable(method: string, path: string): 'create-order' | 'add-items' | 'pay' | 'apply-discount' | null {
  if (method !== 'POST') return null;
  if (path === '/orders') return 'create-order';
  if (/^\/orders\/[^/]+\/items$/.test(path)) return 'add-items';
  if (/^\/orders\/[^/]+\/payment$/.test(path)) return 'pay';
  if (/^\/orders\/[^/]+\/apply-discount$/.test(path)) return 'apply-discount';
  return null;
}

function extractOrderId(path: string): string | null {
  const m = /^\/orders\/([^/]+)/.exec(path);
  return m ? m[1] : null;
}

export async function apiFetch(input: ApiFetchInput): Promise<ApiFetchResult> {
  const cfg = await readConfig();
  if (!cfg) {
    return { status: 500, ok: false, body: { message: 'Terminal is not paired' } };
  }

  const method = input.method.toUpperCase();
  const isMutation = MUTATION_METHODS.has(method);
  const idempotencyKey = input.idempotencyKey ?? (isMutation ? cuid32() : undefined);
  const authToken = getAccessToken();

  // Rewrite synthetic IDs to real ones if the drain has already learned the
  // mapping — this covers the edge case where the user goes back online and
  // immediately edits an offline order before drain completes.
  const effectivePath = isMutation ? rewritePath(input.path) : input.path;

  const url = `${cfg.serverUrl}/api/v1${effectivePath}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.headers ?? {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };

  if (!onlineDetector.isOnline()) {
    return handleOffline(input, method, isMutation, authToken, idempotencyKey, cfg.branch.id);
  }

  try {
    let res = await fetch(url, {
      method,
      headers,
      body: input.body == null ? undefined : JSON.stringify(input.body),
    });

    // Transparent 401 refresh so the POS never sees an expired-token bounce.
    const isAuthPath = input.path.startsWith('/auth/');
    if (res.status === 401 && !isAuthPath) {
      const refreshed = await tryRefreshSession(cfg.serverUrl);
      if (refreshed) {
        res = await fetch(url, {
          method,
          headers: { ...headers, Authorization: `Bearer ${refreshed}` },
          body: input.body == null ? undefined : JSON.stringify(input.body),
        });
      }
    }

    const text = await res.text();
    const parsed = text ? safeParse(text) : null;
    if (!isMutation && res.ok) setCached(method, input.path, res.status, parsed);
    return { status: res.status, ok: res.ok, body: parsed, idempotencyKey };
  } catch (err) {
    // Network blew up mid-request. Fall through to the offline path so the
    // cashier gets the same UX whether the detector already flipped or not.
    console.warn('[api-proxy] fetch failed, serving offline path:', (err as Error).message);
    return handleOffline(input, method, isMutation, authToken, idempotencyKey, cfg.branch.id);
  }
}

function handleOffline(
  input: ApiFetchInput,
  method: string,
  isMutation: boolean,
  authToken: string | null,
  idempotencyKey: string | undefined,
  branchId: string,
): ApiFetchResult {
  if (!isMutation) {
    // Handle /orders list specially: merge cached server orders with locally
    // synthesized ones, so a cashier who went offline before ever visiting a
    // table page still sees their new order on refetch.
    const orderFilter = parseOrderListPath(input.path);
    if (orderFilter) {
      const cached = getCached(method, input.path);
      const base = Array.isArray(cached?.body) ? (cached!.body as Array<{ id: string }>) : [];
      const shadows = listShadowOrders(orderFilter).map((s) => s.body).filter((b) => b != null) as Array<{ id: string }>;
      const byId = new Map<string, unknown>();
      for (const o of base) byId.set(o.id, o);
      for (const o of shadows) byId.set(o.id, o); // shadow wins — newer
      return { status: 200, ok: true, body: Array.from(byId.values()) };
    }
    // /orders/<id> detail — check shadow first, then cache.
    const detailMatch = /^\/orders\/([^/?]+)$/.exec(input.path);
    if (detailMatch) {
      const shadow = getShadowOrder(detailMatch[1]);
      if (shadow?.body) return { status: 200, ok: true, body: shadow.body };
    }
    const cached = getCached(method, input.path);
    if (cached) return { status: cached.status, ok: true, body: cached.body };
    return { status: 200, ok: true, body: emptyShapeFor(input.path) };
  }

  // Mutations: try to synthesize a believable response for the ones the POS
  // actually needs offline. For everything else queue and hand the POS a
  // minimal 202 — same as before (notes-edit, void, etc. replay on reconnect).
  const kind = offlineSynthesizable(method, input.path);
  let synth: unknown = null;
  if (kind === 'create-order') {
    synth = buildCreateOrderResponse(input.body as Parameters<typeof buildCreateOrderResponse>[0], branchId);
  } else if (kind === 'add-items') {
    const orderId = extractOrderId(input.path)!;
    synth = buildAddItemsResponse(orderId, (input.body as Parameters<typeof buildAddItemsResponse>[1]) ?? []);
  } else if (kind === 'pay') {
    const orderId = extractOrderId(input.path)!;
    synth = buildPaymentResponse(orderId, input.body as Parameters<typeof buildPaymentResponse>[1]);
  } else if (kind === 'apply-discount') {
    const orderId = extractOrderId(input.path)!;
    synth = buildApplyDiscountResponse(orderId, input.body as Parameters<typeof buildApplyDiscountResponse>[1]);
  }

  // Queue the original request. Subsequent items/payments targeting a
  // synthetic order id ride on that same synthetic id in the path; the drain
  // will rewrite them after the create call returns the real id.
  enqueue({
    method,
    path: input.path,
    body: input.body,
    authToken,
    idempotencyKey,
  });

  if (synth) {
    return { status: 200, ok: true, body: synth, queued: true, idempotencyKey };
  }
  return {
    status: 202,
    ok: true,
    body: { queued: true, idempotencyKey },
    queued: true,
    idempotencyKey,
  };
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Best-guess empty payload for offline first-load when we have no cache at
 * all. Single-record endpoints need `{}`, lists need `[]`; returning the
 * wrong shape crashes the POS.
 */
function emptyShapeFor(path: string): unknown {
  if (
    path === '/branding' ||
    path === '/branch-settings' ||
    path === '/auth/me' ||
    path.startsWith('/work-periods/current') ||
    /^\/menu\/(item|category)\//.test(path) ||
    /^\/orders\/[^/?]+$/.test(path)
  ) return {};
  return [];
}

let refreshing: Promise<string | null> | null = null;

async function tryRefreshSession(serverUrl: string): Promise<string | null> {
  if (refreshing) return refreshing;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshing = (async () => {
    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken?: string };
      if (!data?.accessToken) return null;
      updateAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();

  return refreshing;
}

// Silence unused-var warnings when isSynthetic is re-exported for future use.
void isSynthetic;

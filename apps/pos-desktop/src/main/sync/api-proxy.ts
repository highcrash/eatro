import { randomBytes } from 'crypto';
import { readConfig } from '../config/store';
import {
  getAccessToken,
  getRefreshToken,
  updateAccessToken,
} from '../session/session';
import { onlineDetector } from './online-detector';
import { enqueue } from './outbox';

/**
 * Central HTTP proxy that every renderer API call flows through. Handles:
 *   - attaching session tokens and Idempotency-Key headers
 *   - queueing mutations when offline (synthetic 202 response)
 *   - returning 503 for GETs when offline (renderer falls back to cache)
 */

export interface ApiFetchInput {
  method: string;
  path: string;                 // relative, e.g. "/orders"
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;      // caller may pre-compute one so they can
                                // correlate with local records
}

export interface ApiFetchResult {
  status: number;
  ok: boolean;
  body: unknown;
  queued?: boolean;             // true when offline → outbox
  idempotencyKey?: string;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function cuid32(): string { return randomBytes(16).toString('hex'); }

export async function apiFetch(input: ApiFetchInput): Promise<ApiFetchResult> {
  const cfg = await readConfig();
  if (!cfg) {
    return { status: 500, ok: false, body: { message: 'Terminal is not paired' } };
  }

  const method = input.method.toUpperCase();
  const isMutation = MUTATION_METHODS.has(method);
  const idempotencyKey = input.idempotencyKey ?? (isMutation ? cuid32() : undefined);
  const authToken = getAccessToken();

  const url = `${cfg.serverUrl}/api/v1${input.path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.headers ?? {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };

  if (!onlineDetector.isOnline()) {
    if (!isMutation) {
      // GET while offline — caller should fall back to its cache.
      return { status: 503, ok: false, body: { offline: true } };
    }
    enqueue({
      method,
      path: input.path,
      body: input.body,
      authToken,
      idempotencyKey,
    });
    return {
      status: 202,
      ok: true,
      body: { queued: true, idempotencyKey },
      queued: true,
      idempotencyKey,
    };
  }

  // Online path — forward the real request. On transient failure, if it's
  // a mutation we queue it for sync instead of surfacing the error.
  try {
    let res = await fetch(url, {
      method,
      headers,
      body: input.body == null ? undefined : JSON.stringify(input.body),
    });

    // Transparent 401 refresh: if the access token expired and we still have
    // a refresh token, swap tokens ourselves and retry once. This keeps the
    // POS renderer from ever seeing a 401 — so its fake 'desktop-managed'
    // refresh path never kicks in and the cashier isn't randomly logged out.
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
    return { status: res.status, ok: res.ok, body: parsed, idempotencyKey };
  } catch (err) {
    // Network blew up mid-request. For mutations, outbox and report queued.
    if (isMutation) {
      enqueue({
        method,
        path: input.path,
        body: input.body,
        authToken,
        idempotencyKey,
      });
      return {
        status: 202,
        ok: true,
        body: { queued: true, idempotencyKey, reason: (err as Error).message },
        queued: true,
        idempotencyKey,
      };
    }
    return { status: 0, ok: false, body: { message: (err as Error).message } };
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

// Cache a single in-flight refresh promise so a burst of 401s doesn't trigger
// N parallel refresh calls.
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
      // Clear the cache so the next future refresh starts fresh.
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();

  return refreshing;
}

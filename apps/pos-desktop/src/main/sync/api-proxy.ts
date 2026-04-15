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
 *   - serving GETs from an in-memory cache when offline so the POS can
 *     keep rendering instead of throwing into a white screen
 *   - transparent 401 refresh
 */

// In-memory response cache for GETs. Key = "GET <path>". Survives until
// process exit; that's fine — a desktop terminal stays open all day, and a
// fresh restart re-fetches everything once online again.
const responseCache = new Map<string, { status: number; body: unknown; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(method: string, path: string): string { return `${method} ${path}`; }

function getCached(method: string, path: string) {
  const entry = responseCache.get(cacheKey(method, path));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    responseCache.delete(cacheKey(method, path));
    return null;
  }
  return entry;
}

function setCached(method: string, path: string, status: number, body: unknown): void {
  if (status < 200 || status >= 300) return;
  responseCache.set(cacheKey(method, path), { status, body, ts: Date.now() });
}

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
      // Serve from the offline cache when we have it; that keeps
      // menu / tables / branding / staff queries rendering instead of
      // throwing the POS into a white screen on connection drop.
      const cached = getCached(method, input.path);
      if (cached) {
        return { status: cached.status, ok: true, body: cached.body };
      }
      // No cached snapshot — return an empty payload that React Query treats
      // as a successful empty list/object. Better than throwing for the
      // common "first load while offline" case.
      return { status: 200, ok: true, body: emptyShapeFor(input.path) };
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
    if (!isMutation) setCached(method, input.path, res.status, parsed);
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
    // Network blew up on a GET — fall back to cache or an empty payload
    // so render code doesn't crash on undefined.
    const cached = getCached(method, input.path);
    if (cached) {
      return { status: cached.status, ok: true, body: cached.body };
    }
    return { status: 200, ok: true, body: emptyShapeFor(input.path) };
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Best-guess empty payload for offline first-load. The POS treats arrays
 * and objects very differently when rendering; returning the wrong shape
 * is what crashes pages. These heuristics handle the common endpoints.
 */
function emptyShapeFor(path: string): unknown {
  // Branding / website content / single-record endpoints expect an object.
  if (
    path === '/branding' ||
    path === '/branch-settings' ||
    path === '/auth/me' ||
    /^\/menu\/(item|category)\//.test(path)
  ) return {};
  // Everything else assumed to be a list.
  return [];
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

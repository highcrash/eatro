import { useSessionStore } from '../store/session.store';

/** Resolves an `/api/v1/...` path to the absolute URL for the current environment. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export function apiUrl(path: string): string {
  // Accept callers passing either '/api/v1/x' (legacy) or '/x'.
  const trimmed = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
  return `${BASE}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

interface QrFetchInit extends RequestInit {
  /** Optional idempotency key for the server's IdempotencyInterceptor.
   *  Set this on POST /orders/qr (and only there) so a double-tap or
   *  network retry replays the cached response instead of creating a
   *  second order. The cart store generates one UUID per cart and
   *  resets it on clearCart(). */
  idempotencyKey?: string;
}

/**
 * Wrapper around `fetch` that auto-injects the QR session's device id
 * (x-qr-device-id) on every request, and an Idempotency-Key header
 * when caller passes one. Use for ALL mutating QR endpoints — the
 * server's auth check on /orders/qr/:id/items + cancel + notes +
 * request-bill compares against `Order.primaryDeviceId`, so mutations
 * sent without this header would 403.
 *
 * Read endpoints don't strictly need the header but it's harmless to
 * send and keeps call sites symmetric.
 */
export async function qrFetch(path: string, init?: QrFetchInit): Promise<Response> {
  const { idempotencyKey, headers, ...rest } = init ?? {};
  const deviceId = useSessionStore.getState().deviceId;
  const merged: Record<string, string> = {
    'x-qr-device-id': deviceId,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };
  return fetch(apiUrl(path), { ...rest, headers: merged });
}

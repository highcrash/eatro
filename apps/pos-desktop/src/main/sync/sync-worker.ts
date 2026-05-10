import { readConfig } from '../config/store';
import { getAccessToken, getRefreshToken, updateAccessToken } from '../session/session';
import { onlineDetector } from './online-detector';
import {
  listPending,
  listPendingDue,
  nextDueAtMs,
  markSuccess,
  markFailed,
  markAttemptLoss,
  wakeAllPending,
  type OutboxRow,
} from './outbox';
import { isSynthetic, mapSyntheticToReal, rewritePath, pathHasSynthetic } from './id-remap';
import { getLocalDb } from '../db/local-db';
import { clearShadowOrders } from './shadow-orders';

const FALLBACK_TICK_MS = 30_000;
const MIN_TICK_MS = 250;

/**
 * Drains pending outbox rows to the server in order. Runs:
 *   - once, automatically, whenever the online detector flips offline → online
 *   - on demand via forceDrain()
 *
 * Each row carries its own Idempotency-Key so retries are safe.
 *
 * Synthetic-id remap: offline mutations on /orders generate a synthetic id
 * and the cashier keeps working against it. When we replay the create call
 * the server returns the real id — we record the mapping and rewrite every
 * subsequent path segment that still references the synthetic id.
 *
 * Failure policy:
 *   - 5xx / network error  → attempts++ and stay 'pending' for next cycle
 *   - 4xx  (bad request, auth)    → mark 'failed', surfaced in Sync Issues UI
 *   - 2xx / 3xx                   → delete row, continue
 */

type Listener = () => void;
const listeners = new Set<Listener>();

let draining = false;

export function onSyncActivity(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function notify() { for (const cb of listeners) cb(); }

export async function forceDrain(): Promise<{ drained: number; failed: number; remaining: number }> {
  if (draining) return { drained: 0, failed: 0, remaining: listPending().length };
  draining = true;
  let drained = 0;
  let failed = 0;
  try {
    const cfg = await readConfig();
    if (!cfg) return { drained: 0, failed: 0, remaining: 0 };

    // Only fire rows whose backoff window has elapsed. A row that's still
    // sleeping (e.g. transient 5xx 4 seconds ago, next-attempt-in 16s) is
    // skipped this cycle — the scheduler will wake us up when it's due.
    const rows = listPendingDue();
    for (const row of rows) {
      if (!onlineDetector.isOnline()) break;
      const outcome = await tryDeliver(cfg.serverUrl, row);
      if (outcome === 'success') drained++;
      else if (outcome === 'hard-fail') failed++;
      notify();
    }
    // After a successful drain, the server has the authoritative order state.
    // Purge /orders* cache entries so the next GET refetches real data and
    // the synthetic entries vanish cleanly — but leave menu/tables/branding
    // cached in case the terminal drops offline again before the next pull.
    if (drained > 0 && listPending().length === 0) {
      getLocalDb().prepare(`DELETE FROM response_cache WHERE path_key LIKE 'GET /orders%'`).run();
      clearShadowOrders();
    }
    return { drained, failed, remaining: listPending().length };
  } finally {
    draining = false;
    notify();
    scheduleNextTick();
  }
}

async function tryDeliver(serverUrl: string, row: OutboxRow): Promise<'success' | 'transient' | 'hard-fail'> {
  // Rewrite any synthetic ids in the path that have already been mapped by
  // previous rows in this drain loop (or an earlier run).
  const path = rewritePath(row.path);

  // If the path still contains a synthetic id at this point, the parent
  // create-order row must be drained first. It'll be earlier in the FIFO
  // because mutations are appended in cashier order, so this usually doesn't
  // trigger — but if we ever get here, skip this cycle and retry next tick.
  if (pathHasSynthetic(path)) {
    markAttemptLoss(row.id, 'waiting for parent order id');
    return 'transient';
  }

  const url = `${serverUrl}/api/v1${path}`;
  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': row.idempotencyKey,
    };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  try {
    const initialToken = getAccessToken() ?? row.authToken;
    let res = await fetch(url, {
      method: row.method,
      headers: buildHeaders(initialToken),
      body: row.body ?? undefined,
    });
    // Transparent 401 refresh: the row's captured authToken can be stale
    // (8h JWT TTL; an overnight offline → morning drain hits expiry on
    // every queued row). One refresh attempt + one retry, mirroring the
    // api-proxy live-call path. If refresh fails the row falls through
    // to the 4xx branch and surfaces in Sync Issues for manual triage.
    if (res.status === 401) {
      const fresh = await tryRefreshSession(serverUrl);
      if (fresh) {
        res = await fetch(url, {
          method: row.method,
          headers: buildHeaders(fresh),
          body: row.body ?? undefined,
        });
      }
    }
    if (res.ok) {
      // POST /orders just succeeded — bind the synthetic this row owns
      // (or the oldest unmapped one for legacy outbox rows that predate
      // the client_hint column) to the real id the server returned.
      if (row.method === 'POST' && row.path === '/orders') {
        let realId: string | undefined;
        try {
          const text = await res.text();
          const data = text ? JSON.parse(text) : null;
          realId = (data as { id?: string } | null)?.id ?? undefined;
        } catch {
          // body parse failure handled below as missing-id
        }
        if (!realId) {
          // 2xx with no id is a server / proxy bug — better to surface
          // it now than let every dependent row spin on
          // pathHasSynthetic('off_order_*') for 50 attempts.
          markFailed(row.id, 'POST /orders returned 2xx with no id in body');
          return 'hard-fail';
        }
        if (row.clientHint) {
          mapSyntheticToReal(row.clientHint, realId);
        } else {
          bindOldestUnmappedOrder(realId);
        }
      }
      markSuccess(row.id);
      return 'success';
    }
    const text = await res.text().catch(() => '');
    if (res.status >= 500) {
      markAttemptLoss(row.id, `HTTP ${res.status}: ${truncate(text)}`);
      return 'transient';
    }
    markFailed(row.id, `HTTP ${res.status}: ${truncate(text)}`);
    return 'hard-fail';
  } catch (err) {
    markAttemptLoss(row.id, (err as Error).message);
    return 'transient';
  }
}

/**
 * Refresh the access token using the stored refresh token. Returns the new
 * access token, or null if the refresh failed. Mirrors the inline refresh
 * inside api-proxy — kept duplicated to avoid a circular import between
 * two sync-layer modules.
 */
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

/**
 * Bind the oldest still-unmapped synthetic order id to the given real id.
 * We don't have a direct correlation between the POST /orders outbox row
 * and the synthetic id the builder minted — but they are produced in the
 * same sequence and drained in the same order, so binding the oldest
 * unmapped order row is correct.
 */
function bindOldestUnmappedOrder(realId: string): void {
  const row = getLocalDb()
    .prepare(`SELECT synthetic_id FROM id_remap WHERE kind = 'order' AND real_id IS NULL ORDER BY created_at_ms ASC LIMIT 1`)
    .get() as { synthetic_id: string } | undefined;
  if (row?.synthetic_id) mapSyntheticToReal(row.synthetic_id, realId);
}

function truncate(s: string): string {
  return s.length <= 200 ? s : s.slice(0, 200) + '…';
}

/**
 * Single self-rescheduling timer driven by the next due row in the outbox.
 * Replaces the old "drain whenever the detector flips online" pattern,
 * which never retried a transient failure until the cashier reopened the
 * lid or the network bounced again.
 */
let tickHandle: NodeJS.Timeout | null = null;

function scheduleNextTick(): void {
  if (tickHandle) { clearTimeout(tickHandle); tickHandle = null; }
  const next = nextDueAtMs();
  if (next == null) {
    // Nothing pending — re-check after FALLBACK_TICK_MS in case we missed
    // an online-detector flip or a renderer enqueue raced our notify().
    tickHandle = setTimeout(() => void forceDrain(), FALLBACK_TICK_MS);
    return;
  }
  const wait = Math.max(MIN_TICK_MS, next - Date.now());
  tickHandle = setTimeout(() => void forceDrain(), wait);
}

export function startSyncWorker(): void {
  onlineDetector.on('change', (next, prev) => {
    if (prev !== 'online' && next === 'online') {
      // Wake up every sleeping pending row so the next drain tick
      // tries them all immediately. Without this a row whose backoff
      // window grew to 10 min during the offline / server-error
      // period would keep showing as "1 pending" for up to 10 min
      // after reconnect even though the network is healthy again.
      wakeAllPending();
      void forceDrain();
    }
  });
  scheduleNextTick();
}

// Silence unused-var: isSynthetic re-exported for callers that want cheap check.
void isSynthetic;

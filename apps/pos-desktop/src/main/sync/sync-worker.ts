import { readConfig } from '../config/store';
import { getAccessToken } from '../session/session';
import { onlineDetector } from './online-detector';
import {
  listPending,
  markSuccess,
  markFailed,
  markAttemptLoss,
  type OutboxRow,
} from './outbox';
import { isSynthetic, mapSyntheticToReal, rewritePath } from './id-remap';
import { getLocalDb } from '../db/local-db';

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

    const rows = listPending();
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
    }
    return { drained, failed, remaining: listPending().length };
  } finally {
    draining = false;
    notify();
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
  if (/\boff_[A-Za-z0-9]+\b/.test(path)) {
    markAttemptLoss(row.id, 'waiting for parent order id');
    return 'transient';
  }

  const url = `${serverUrl}/api/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': row.idempotencyKey,
  };
  const currentToken = getAccessToken();
  const tokenToUse = currentToken ?? row.authToken;
  if (tokenToUse) headers['Authorization'] = `Bearer ${tokenToUse}`;

  try {
    const res = await fetch(url, {
      method: row.method,
      headers,
      body: row.body ?? undefined,
    });
    if (res.ok) {
      // If this was a POST /orders and we had issued a synthetic id, learn
      // the real id so subsequent rows targeting `/orders/<syn>/...` get
      // rewritten before dispatch.
      if (row.method === 'POST' && row.path === '/orders') {
        try {
          const text = await res.text();
          const data = text ? JSON.parse(text) : null;
          const realId = (data as { id?: string } | null)?.id;
          // The synthetic id never travels in the request body — it lives in
          // the idempotencyKey's sibling record. Instead of threading it
          // through, we recover it from the remap table: any synthetic id
          // still without a real id and created around this order's time.
          // Simpler: the outbox row's idempotency key IS unique per synthetic
          // order, and the synthetic builder registered the id when it minted
          // it. We don't have a direct key → so we accept that the caller
          // (handleOffline) should register the mapping via the request body
          // if possible; fall back to scanning all unmapped synthetic orders
          // and binding the oldest one.
          if (realId) bindOldestUnmappedOrder(realId);
        } catch {
          // response body parse failure shouldn't fail the drain
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

export function startSyncWorker(): void {
  onlineDetector.on('change', (next, prev) => {
    if (prev !== 'online' && next === 'online') {
      void forceDrain();
    }
  });
}

// Silence unused-var: isSynthetic re-exported for callers that want cheap check.
void isSynthetic;

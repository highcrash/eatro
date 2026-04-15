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

/**
 * Drains pending outbox rows to the server in order. Runs:
 *   - once, automatically, whenever the online detector flips offline → online
 *   - on demand via forceDrain()
 *
 * Each row carries its own Idempotency-Key so retries are safe.
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
      if (!onlineDetector.isOnline()) break; // lost connection mid-drain
      const ok = await tryDeliver(cfg.serverUrl, row);
      if (ok === 'success') drained++;
      else if (ok === 'hard-fail') failed++;
      notify();
    }
    return { drained, failed, remaining: listPending().length };
  } finally {
    draining = false;
    notify();
  }
}

async function tryDeliver(serverUrl: string, row: OutboxRow): Promise<'success' | 'transient' | 'hard-fail'> {
  const url = `${serverUrl}/api/v1${row.path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': row.idempotencyKey,
  };
  // Prefer the current session token if one exists (a newer cashier is in);
  // otherwise replay with the token captured at enqueue time.
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
      markSuccess(row.id);
      return 'success';
    }
    // Server reachable but rejected — 4xx is a business error, 5xx is transient.
    const text = await res.text().catch(() => '');
    if (res.status >= 500) {
      markAttemptLoss(row.id, `HTTP ${res.status}: ${truncate(text)}`);
      return 'transient';
    }
    markFailed(row.id, `HTTP ${res.status}: ${truncate(text)}`);
    return 'hard-fail';
  } catch (err) {
    // Genuinely offline / DNS fail. Treat as transient.
    markAttemptLoss(row.id, (err as Error).message);
    return 'transient';
  }
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

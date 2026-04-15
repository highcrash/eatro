import { randomBytes } from 'crypto';
import { getLocalDb } from '../db/local-db';

/**
 * Persistent FIFO of API mutations that couldn't reach the server
 * (terminal was offline, server was 5xx, etc.). Each row carries the
 * Idempotency-Key the original request was signed with, so redelivery
 * is safe: the server returns the cached response instead of executing
 * twice.
 *
 * Hardening (Phase 7B):
 * - Per-row exponential backoff via next_attempt_at_ms. Transient
 *   failures push the next attempt out by 2^attempts seconds (capped
 *   at 10 min) so a flaky network doesn't burn CPU and a stuck row
 *   doesn't block earlier siblings indefinitely.
 * - Retry budget: after MAX_TRANSIENT_ATTEMPTS the row is auto-marked
 *   failed with a clear reason, surfacing it in the Sync Issues UI for
 *   manual resolution.
 * - Outbox cap: enqueueing fails loud once the queue exceeds
 *   MAX_OUTBOX_SIZE so we never silently DROP a payment on the floor;
 *   the renderer surfaces this back to the cashier.
 */

export type OutboxStatus = 'pending' | 'failed';

export interface OutboxRow {
  id: string;
  idempotencyKey: string;
  method: string;
  path: string;                 // e.g. "/orders"
  body: string | null;          // JSON-serialized
  authToken: string | null;     // captured at enqueue time, for later replay
  createdAtMs: number;
  attempts: number;
  lastError: string | null;
  status: OutboxStatus;
  nextAttemptAtMs: number;
}

const MAX_TRANSIENT_ATTEMPTS = 50;
const MAX_OUTBOX_SIZE = 5_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10 * 60_000;

/** Pure function: how long to wait before the Nth attempt (1-indexed). */
export function backoffMsFor(attempt: number): number {
  if (attempt <= 1) return 0;
  const exponent = Math.min(attempt - 1, 16);
  const ms = BASE_BACKOFF_MS * Math.pow(2, exponent);
  // 10–20% jitter so a thundering herd of failed rows doesn't all retry
  // at the same instant.
  const jitter = ms * (0.1 + Math.random() * 0.1);
  return Math.min(MAX_BACKOFF_MS, Math.round(ms + jitter));
}

export class OutboxFullError extends Error {
  constructor(size: number) {
    super(`Outbox is full (${size} queued); rejecting new mutation. Drain or clear the queue.`);
    this.name = 'OutboxFullError';
  }
}

function cuid(): string {
  // Cheap 24-char random id — fine for outbox rows; deterministic ids for
  // business records are generated separately at the call site.
  return randomBytes(12).toString('hex');
}

export interface EnqueueInput {
  method: string;
  path: string;
  body: unknown;
  authToken: string | null;
  idempotencyKey?: string; // optional — caller can supply their own if they
                           // generated one up-front for the original request.
}

export function enqueue(input: EnqueueInput): OutboxRow {
  const total = totalRows();
  if (total >= MAX_OUTBOX_SIZE) {
    throw new OutboxFullError(total);
  }
  const now = Date.now();
  const row: OutboxRow = {
    id: cuid(),
    idempotencyKey: input.idempotencyKey ?? cuid(),
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body == null ? null : JSON.stringify(input.body),
    authToken: input.authToken,
    createdAtMs: now,
    attempts: 0,
    lastError: null,
    status: 'pending',
    nextAttemptAtMs: now,
  };
  getLocalDb()
    .prepare(
      `INSERT INTO outbox (id, idempotency_key, method, path, body, auth_token, created_at_ms, attempts, last_error, status, next_attempt_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.idempotencyKey,
      row.method,
      row.path,
      row.body,
      row.authToken,
      row.createdAtMs,
      row.attempts,
      row.lastError,
      row.status,
      row.nextAttemptAtMs,
    );
  return row;
}

function mapRow(r: any): OutboxRow {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    method: r.method,
    path: r.path,
    body: r.body,
    authToken: r.auth_token,
    createdAtMs: r.created_at_ms,
    attempts: r.attempts,
    lastError: r.last_error,
    status: r.status as OutboxStatus,
    nextAttemptAtMs: Number(r.next_attempt_at_ms ?? 0),
  };
}

/**
 * Pending rows whose backoff window has elapsed and are ready to attempt
 * right now. Rows still in their wait window are excluded — the caller
 * should be using nextDueAtMs() to schedule the next drain cycle.
 */
export function listPendingDue(): OutboxRow[] {
  const now = Date.now();
  return (getLocalDb()
    .prepare(`SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at_ms <= ? ORDER BY created_at_ms ASC`)
    .all(now) as any[]).map(mapRow);
}

/** Every pending row regardless of backoff state. Used for diagnostics + counts. */
export function listPending(): OutboxRow[] {
  return (getLocalDb()
    .prepare(`SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at_ms ASC`)
    .all() as any[]).map(mapRow);
}

export function listFailed(): OutboxRow[] {
  return (getLocalDb()
    .prepare(`SELECT * FROM outbox WHERE status = 'failed' ORDER BY created_at_ms ASC`)
    .all() as any[]).map(mapRow);
}

export function counts(): { pending: number; failed: number } {
  const row = getLocalDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM outbox`,
    )
    .get() as { pending: number | null; failed: number | null };
  return { pending: Number(row?.pending ?? 0), failed: Number(row?.failed ?? 0) };
}

function totalRows(): number {
  const row = getLocalDb().prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number };
  return Number(row?.n ?? 0);
}

/**
 * Earliest next_attempt_at_ms among pending rows. Returns null when nothing
 * is pending. The sync worker uses this to schedule its next wake-up
 * instead of polling on a fixed interval.
 */
export function nextDueAtMs(): number | null {
  const row = getLocalDb()
    .prepare(`SELECT MIN(next_attempt_at_ms) AS m FROM outbox WHERE status = 'pending'`)
    .get() as { m: number | null };
  return row?.m ?? null;
}

export function markSuccess(id: string): void {
  getLocalDb().prepare('DELETE FROM outbox WHERE id = ?').run(id);
}

export function markFailed(id: string, error: string): void {
  getLocalDb()
    .prepare(
      `UPDATE outbox
         SET status = 'failed',
             attempts = attempts + 1,
             last_error = ?
       WHERE id = ?`,
    )
    .run(error, id);
}

/**
 * Push the next attempt out by an exponential-backoff window. After
 * MAX_TRANSIENT_ATTEMPTS the row is flipped to 'failed' so it surfaces in
 * the Sync Issues UI instead of grinding forever.
 */
export function markAttemptLoss(id: string, error: string): void {
  const db = getLocalDb();
  const cur = db.prepare(`SELECT attempts FROM outbox WHERE id = ?`).get(id) as { attempts: number } | undefined;
  if (!cur) return;
  const nextAttempts = cur.attempts + 1;
  if (nextAttempts >= MAX_TRANSIENT_ATTEMPTS) {
    db.prepare(
      `UPDATE outbox
         SET status = 'failed',
             attempts = ?,
             last_error = ?
       WHERE id = ?`,
    ).run(nextAttempts, `${error} (exceeded ${MAX_TRANSIENT_ATTEMPTS} attempts)`, id);
    return;
  }
  const wait = backoffMsFor(nextAttempts);
  db.prepare(
    `UPDATE outbox
       SET attempts = ?,
           last_error = ?,
           next_attempt_at_ms = ?
     WHERE id = ?`,
  ).run(nextAttempts, error, Date.now() + wait, id);
}

export function retry(id: string): void {
  getLocalDb()
    .prepare(
      `UPDATE outbox
         SET status = 'pending',
             attempts = 0,
             last_error = NULL,
             next_attempt_at_ms = ?
       WHERE id = ?`,
    )
    .run(Date.now(), id);
}

/** Reset every failed row back to pending. Returns the row count touched. */
export function retryAllFailed(): number {
  const res = getLocalDb()
    .prepare(
      `UPDATE outbox
         SET status = 'pending',
             attempts = 0,
             last_error = NULL,
             next_attempt_at_ms = ?
       WHERE status = 'failed'`,
    )
    .run(Date.now());
  return Number(res.changes ?? 0);
}

export function dismiss(id: string): void {
  getLocalDb().prepare(`DELETE FROM outbox WHERE id = ?`).run(id);
}

export function clearAll(): void {
  getLocalDb().prepare('DELETE FROM outbox').run();
}

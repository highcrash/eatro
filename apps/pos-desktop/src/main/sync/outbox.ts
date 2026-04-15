import { randomBytes } from 'crypto';
import { getLocalDb } from '../db/local-db';

/**
 * Persistent FIFO of API mutations that couldn't reach the server
 * (terminal was offline, server was 5xx, etc.). Each row carries the
 * Idempotency-Key the original request was signed with, so redelivery
 * is safe: the server returns the cached response instead of executing
 * twice.
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
  const row: OutboxRow = {
    id: cuid(),
    idempotencyKey: input.idempotencyKey ?? cuid(),
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body == null ? null : JSON.stringify(input.body),
    authToken: input.authToken,
    createdAtMs: Date.now(),
    attempts: 0,
    lastError: null,
    status: 'pending',
  };
  getLocalDb()
    .prepare(
      `INSERT INTO outbox (id, idempotency_key, method, path, body, auth_token, created_at_ms, attempts, last_error, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

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

export function markAttemptLoss(id: string, error: string): void {
  // Increment attempt count but keep as pending for retry next drain cycle.
  getLocalDb()
    .prepare(
      `UPDATE outbox
         SET attempts = attempts + 1,
             last_error = ?
       WHERE id = ?`,
    )
    .run(error, id);
}

export function retry(id: string): void {
  getLocalDb()
    .prepare(
      `UPDATE outbox
         SET status = 'pending',
             attempts = 0,
             last_error = NULL
       WHERE id = ?`,
    )
    .run(id);
}

export function dismiss(id: string): void {
  getLocalDb().prepare(`DELETE FROM outbox WHERE id = ?`).run(id);
}

export function clearAll(): void {
  getLocalDb().prepare('DELETE FROM outbox').run();
}

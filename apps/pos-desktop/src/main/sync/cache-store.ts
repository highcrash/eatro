import { getLocalDb } from '../db/local-db';

/**
 * SQLite-backed persistent cache for GET responses. Survives app restart so
 * a terminal that boots offline can still render menu, tables, branding,
 * staff, and whatever else was pulled the last time it was online.
 *
 * Only 2xx responses are cached. Cache entries are kept indefinitely — the
 * cache is overwritten on every successful online fetch, and it's safer to
 * serve slightly-stale data than to empty-payload the POS.
 */

export interface CacheEntry {
  status: number;
  body: unknown;
  updatedAtMs: number;
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function getCached(method: string, path: string): CacheEntry | null {
  const row = getLocalDb()
    .prepare(`SELECT status, body, updated_at_ms FROM response_cache WHERE path_key = ?`)
    .get(key(method, path)) as { status: number; body: string; updated_at_ms: number } | undefined;
  if (!row) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(row.body); } catch { parsed = row.body; }
  return { status: row.status, body: parsed, updatedAtMs: row.updated_at_ms };
}

export function setCached(method: string, path: string, status: number, body: unknown): void {
  if (status < 200 || status >= 300) return;
  const text = body == null ? 'null' : typeof body === 'string' ? JSON.stringify(body) : JSON.stringify(body);
  getLocalDb()
    .prepare(
      `INSERT INTO response_cache (path_key, status, body, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path_key) DO UPDATE SET
         status = excluded.status,
         body = excluded.body,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(key(method, path), status, text, Date.now());
}

/**
 * Mutate the cached body for a path (no-op if missing). Used after synthetic
 * offline POSTs so subsequent list fetches include the new record.
 */
export function updateCachedBody(method: string, path: string, updater: (body: unknown) => unknown): void {
  const entry = getCached(method, path);
  if (!entry) return;
  const next = updater(entry.body);
  setCached(method, path, entry.status, next);
}

/** List every cache entry whose path starts with prefix. Useful for fanning
 *  updates across query variants like `/orders?tableId=A`, `/orders?status=OPEN`. */
export function findCachedByPrefix(prefix: string): Array<{ path: string; entry: CacheEntry }> {
  const rows = getLocalDb()
    .prepare(
      `SELECT path_key, status, body, updated_at_ms FROM response_cache WHERE path_key LIKE ?`,
    )
    .all(`GET ${prefix}%`) as Array<{ path_key: string; status: number; body: string; updated_at_ms: number }>;
  return rows.map((r) => {
    let parsed: unknown;
    try { parsed = JSON.parse(r.body); } catch { parsed = r.body; }
    return {
      path: r.path_key.slice('GET '.length),
      entry: { status: r.status, body: parsed, updatedAtMs: r.updated_at_ms },
    };
  });
}

export function clearCache(): void {
  getLocalDb().prepare(`DELETE FROM response_cache`).run();
}

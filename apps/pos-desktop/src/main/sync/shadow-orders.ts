import { getLocalDb } from '../db/local-db';

/**
 * Persistent store of synthetic orders created while offline. Merged into
 * every offline GET /orders* response so the POS's refetch after a
 * synthetic POST still finds the new order — even if the specific query
 * variant (say `?tableId=X`) was never cached while online.
 */

export interface ShadowOrder {
  id: string;
  tableId: string | null;
  branchId: string;
  status: string;
  body: unknown; // full Order object, exactly as handed to the renderer
  createdAtMs: number;
  updatedAtMs: number;
}

export function upsertShadowOrder(order: {
  id: string;
  tableId: string | null;
  branchId: string;
  status: string;
  body: unknown;
}): void {
  const now = Date.now();
  getLocalDb()
    .prepare(
      `INSERT INTO shadow_orders (id, table_id, branch_id, status, body, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         table_id = excluded.table_id,
         status   = excluded.status,
         body     = excluded.body,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      order.id,
      order.tableId,
      order.branchId,
      order.status,
      JSON.stringify(order.body),
      now,
      now,
    );
}

export function getShadowOrder(id: string): ShadowOrder | null {
  const row = getLocalDb()
    .prepare(`SELECT * FROM shadow_orders WHERE id = ?`)
    .get(id) as { id: string; table_id: string | null; branch_id: string; status: string; body: string; created_at_ms: number; updated_at_ms: number } | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.body); } catch { /* ignore */ }
  return {
    id: row.id,
    tableId: row.table_id,
    branchId: row.branch_id,
    status: row.status,
    body: parsed,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

/**
 * List shadow orders matching the given query params. If `tableId` is set,
 * only orders for that table are returned. If `statuses` is non-empty, only
 * orders whose status is in the set are returned. Both may be supplied
 * together (AND semantics).
 */
export function listShadowOrders(filter: { tableId?: string | null; statuses?: string[] } = {}): ShadowOrder[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tableId !== undefined) {
    if (filter.tableId === null) {
      clauses.push('table_id IS NULL');
    } else {
      clauses.push('table_id = ?');
      params.push(filter.tableId);
    }
  }
  if (filter.statuses && filter.statuses.length) {
    clauses.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
    params.push(...filter.statuses);
  } else {
    // Match the server's default: /orders?tableId=X implicitly excludes
    // PAID and VOID orders. Without this, a freshly paid offline order
    // would stay visible on the OrderPage until the drain clears shadow.
    clauses.push(`status NOT IN ('PAID','VOID')`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getLocalDb()
    .prepare(`SELECT * FROM shadow_orders ${where} ORDER BY created_at_ms DESC`)
    .all(...params) as Array<{ id: string; table_id: string | null; branch_id: string; status: string; body: string; created_at_ms: number; updated_at_ms: number }>;
  return rows.map((r) => {
    let parsed: unknown = null;
    try { parsed = JSON.parse(r.body); } catch { /* ignore */ }
    return {
      id: r.id,
      tableId: r.table_id,
      branchId: r.branch_id,
      status: r.status,
      body: parsed,
      createdAtMs: r.created_at_ms,
      updatedAtMs: r.updated_at_ms,
    };
  });
}

export function clearShadowOrders(): void {
  getLocalDb().prepare(`DELETE FROM shadow_orders`).run();
}

/**
 * Parse /orders or /orders?tableId=X&status=PENDING style paths into a
 * filter suitable for listShadowOrders. Returns null if the path doesn't
 * look like the list endpoint.
 */
export function parseOrderListPath(path: string): { tableId?: string | null; statuses?: string[] } | null {
  if (!path.startsWith('/orders')) return null;
  const qIdx = path.indexOf('?');
  const query = qIdx === -1 ? '' : path.slice(qIdx + 1);
  // /orders/<id> is a detail path, not a list — skip.
  const head = qIdx === -1 ? path : path.slice(0, qIdx);
  if (head !== '/orders') return null;
  const params = new URLSearchParams(query);
  const filter: { tableId?: string | null; statuses?: string[] } = {};
  if (params.has('tableId')) filter.tableId = params.get('tableId') || null;
  if (params.has('status')) {
    filter.statuses = (params.get('status') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return filter;
}

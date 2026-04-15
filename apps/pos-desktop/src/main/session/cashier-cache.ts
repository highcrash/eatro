import { getLocalDb } from '../db/local-db';

export interface CashierEntry {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Cached list of cashiers for the paired branch. Refreshed whenever the
 * terminal successfully talks to the server — used by the lock screen so
 * cashiers can still see their own tile when the terminal boots offline.
 *
 * Note: only cashiers with PINs can sign in offline. First-time setup
 * (password flow) requires the server to be reachable.
 */

export function getCachedCashiers(): CashierEntry[] {
  const rows = getLocalDb()
    .prepare('SELECT id, name, email, role FROM cashiers ORDER BY name ASC')
    .all() as CashierEntry[];
  return rows;
}

export function replaceCashiers(list: CashierEntry[]): void {
  const db = getLocalDb();
  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR REPLACE INTO cashiers (id, name, email, role, updated_at_ms) VALUES (?, ?, ?, ?, ?)',
  );
  const del = db.prepare('DELETE FROM cashiers WHERE id NOT IN (SELECT value FROM json_each(?))');
  const tx = db.transaction((cashiers: CashierEntry[]) => {
    for (const c of cashiers) insert.run(c.id, c.name, c.email, c.role, now);
    del.run(JSON.stringify(cashiers.map((c) => c.id)));
  });
  tx(list);
}

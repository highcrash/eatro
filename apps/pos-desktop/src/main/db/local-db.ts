import { app } from 'electron';
import Database, { type Database as BetterSqlite } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Local SQLite for the desktop app. Stores:
 *   - cashier_pins: bcrypt hashes of cashier PINs + lockout state
 *   - cashiers: cached snapshot of the branch's cashier list (used by lock screen when offline)
 *
 * Phase 4 will add:
 *   - outbox: FIFO of mutations waiting for sync
 *   - cache_orders, cache_tables, cache_menu etc. as needed
 *
 * The DB file lives in %APPDATA%/Your Restaurant POS/local.db. File permissions are
 * per-Windows-user by default. Contents are NOT encrypted as a blob — PIN
 * hashes are bcrypt so they're safe at rest even if the file leaks.
 */

let _db: BetterSqlite | null = null;

export function getLocalDb(): BetterSqlite {
  if (_db) return _db;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'local.db');
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function ensureColumn(db: BetterSqlite, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: BetterSqlite): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_pins (
      staff_id         TEXT PRIMARY KEY,
      pin_hash         TEXT NOT NULL,
      failed_attempts  INTEGER NOT NULL DEFAULT 0,
      locked_until_ms  INTEGER,
      updated_at_ms    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashiers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL,
      role          TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id                TEXT PRIMARY KEY,
      idempotency_key   TEXT NOT NULL,
      method            TEXT NOT NULL,
      path              TEXT NOT NULL,
      body              TEXT,
      auth_token        TEXT,
      created_at_ms     INTEGER NOT NULL,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',   -- pending | failed
      -- Earliest absolute time (ms epoch) at which the next drain attempt may
      -- fire. Set to created_at_ms on enqueue and pushed forward by the
      -- exponential backoff after each transient failure.
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status, created_at_ms);
    -- outbox_next_attempt_idx is created below, after ensureColumn guarantees
    -- the next_attempt_at_ms column exists on terminals upgrading from an
    -- older schema. If we declared it here the index DDL would reference an
    -- unknown column and the whole migration batch would fail on upgrade.

    -- Cached GET responses keyed by "METHOD PATH". Offline reads fall back here
    -- so the POS keeps rendering menu, tables, branding, etc. Written on every
    -- successful online GET; read when offline or on network failure.
    CREATE TABLE IF NOT EXISTS response_cache (
      path_key      TEXT PRIMARY KEY,
      status        INTEGER NOT NULL,
      body          TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    -- Maps synthetic IDs generated while offline (for orders + their items/payments)
    -- to the real IDs the server assigned on drain. Drain rewrites subsequent
    -- requests targeting synthetic IDs before replaying them.
    CREATE TABLE IF NOT EXISTS id_remap (
      synthetic_id  TEXT PRIMARY KEY,
      real_id       TEXT,
      kind          TEXT NOT NULL,                  -- 'order' | 'item' | 'payment'
      created_at_ms INTEGER NOT NULL
    );

    -- Offline-created orders kept in their full synthetic Order shape, keyed
    -- by the synthetic id. Offline GET /orders queries union these with the
    -- cached server list so the POS's refetch after a synthetic mutation
    -- still sees the new order even if there was no prior cache for the
    -- specific table/status filter.
    --
    -- Rows are cleared once the outbox has drained — by then the server has
    -- the authoritative copy and React Query will refetch real data.
    CREATE TABLE IF NOT EXISTS shadow_orders (
      id            TEXT PRIMARY KEY,
      table_id      TEXT,
      branch_id     TEXT NOT NULL,
      status        TEXT NOT NULL,
      body          TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shadow_orders_table_idx ON shadow_orders(table_id);
    CREATE INDEX IF NOT EXISTS shadow_orders_status_idx ON shadow_orders(status);
  `);

  // Backfill the next_attempt_at_ms column on existing terminals upgrading
  // from a release that didn't have it. CREATE TABLE IF NOT EXISTS skips
  // schema changes on an existing table, so an explicit ALTER is needed.
  ensureColumn(db, 'outbox', 'next_attempt_at_ms', 'next_attempt_at_ms INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS outbox_next_attempt_idx ON outbox(status, next_attempt_at_ms)`);
}

/** For tests / recovery. */
export function closeLocalDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

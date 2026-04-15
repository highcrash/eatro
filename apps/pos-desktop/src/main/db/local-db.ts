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
 * The DB file lives in %APPDATA%/Restora POS/local.db. File permissions are
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
      status            TEXT NOT NULL DEFAULT 'pending'    -- pending | failed
    );
    CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status, created_at_ms);
  `);
}

/** For tests / recovery. */
export function closeLocalDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

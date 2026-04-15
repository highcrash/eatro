import * as bcrypt from 'bcryptjs';
import { getLocalDb } from '../db/local-db';

/**
 * Cashier PIN management, local to this terminal. Not synced to server.
 *
 * Lockout policy:
 *   - 3 wrong PINs → 30 s lockout
 *   - 5 more wrong PINs after unlock → 5 min lockout
 *   - Forever 5-attempt cycles of 5-minute lockouts — the cashier is expected
 *     to either remember their PIN or re-prove identity via password (first-
 *     time setup flow) and set a new one.
 */

const PIN_LOCKOUT_BURST = 3;
const PIN_LOCKOUT_BURST_MS = 30_000;
const PIN_LOCKOUT_HARD = 8;
const PIN_LOCKOUT_HARD_MS = 5 * 60_000;

export interface PinStatus {
  hasPin: boolean;
  lockedUntilMs: number | null;
  failedAttempts: number;
}

export function getPinStatus(staffId: string): PinStatus {
  const row = getLocalDb()
    .prepare('SELECT failed_attempts, locked_until_ms FROM cashier_pins WHERE staff_id = ?')
    .get(staffId) as { failed_attempts: number; locked_until_ms: number | null } | undefined;
  if (!row) return { hasPin: false, lockedUntilMs: null, failedAttempts: 0 };
  return {
    hasPin: true,
    lockedUntilMs: row.locked_until_ms,
    failedAttempts: row.failed_attempts,
  };
}

export async function setPin(staffId: string, pin: string): Promise<void> {
  assertValidPin(pin);
  const hash = await bcrypt.hash(pin, 10);
  const now = Date.now();
  getLocalDb()
    .prepare(
      `INSERT INTO cashier_pins (staff_id, pin_hash, failed_attempts, locked_until_ms, updated_at_ms)
       VALUES (?, ?, 0, NULL, ?)
       ON CONFLICT (staff_id) DO UPDATE SET
         pin_hash = excluded.pin_hash,
         failed_attempts = 0,
         locked_until_ms = NULL,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(staffId, hash, now);
}

export type PinVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no-pin' }
  | { ok: false; reason: 'locked'; lockedUntilMs: number }
  | { ok: false; reason: 'wrong'; failedAttempts: number; lockedUntilMs: number | null };

export async function verifyPin(staffId: string, pin: string): Promise<PinVerifyResult> {
  const db = getLocalDb();
  const row = db
    .prepare('SELECT pin_hash, failed_attempts, locked_until_ms FROM cashier_pins WHERE staff_id = ?')
    .get(staffId) as
    | { pin_hash: string; failed_attempts: number; locked_until_ms: number | null }
    | undefined;

  if (!row) return { ok: false, reason: 'no-pin' };

  const now = Date.now();
  if (row.locked_until_ms && row.locked_until_ms > now) {
    return { ok: false, reason: 'locked', lockedUntilMs: row.locked_until_ms };
  }

  const matches = await bcrypt.compare(pin, row.pin_hash);
  if (matches) {
    db.prepare('UPDATE cashier_pins SET failed_attempts = 0, locked_until_ms = NULL WHERE staff_id = ?').run(staffId);
    return { ok: true };
  }

  const attempts = row.failed_attempts + 1;
  let lockedUntil: number | null = null;
  if (attempts >= PIN_LOCKOUT_HARD) {
    lockedUntil = now + PIN_LOCKOUT_HARD_MS;
  } else if (attempts >= PIN_LOCKOUT_BURST) {
    lockedUntil = now + PIN_LOCKOUT_BURST_MS;
  }
  db.prepare('UPDATE cashier_pins SET failed_attempts = ?, locked_until_ms = ? WHERE staff_id = ?').run(
    attempts,
    lockedUntil,
    staffId,
  );
  return { ok: false, reason: 'wrong', failedAttempts: attempts, lockedUntilMs: lockedUntil };
}

export function clearPin(staffId: string): void {
  getLocalDb().prepare('DELETE FROM cashier_pins WHERE staff_id = ?').run(staffId);
}

function assertValidPin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN must be 4 to 6 digits');
  }
}

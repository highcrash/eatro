import { createHmac, randomBytes } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';

/**
 * Local HMAC + machine-fingerprint helpers for the installed-side cache.
 *
 * Two jobs:
 *   1. Compute a stable `machineId` for this install. Used as the salt
 *      for both the license fingerprint (sent to the server at activate)
 *      and the row-tampering HMAC (verified on every read of LicenseRecord).
 *   2. HMAC-sign the cached LicenseRecord's authoritative fields with a
 *      key derived from `machineId + bundled public key`. A buyer who
 *      `UPDATE license_records SET status='ACTIVE'` invalidates the
 *      stored verdictHmac, so the gate treats the row as missing on the
 *      next read and forces a fresh online verify.
 *
 * The HMAC key is intentionally NOT stored anywhere. It's recomputed on
 * boot from values that are either burned into the build (publicKey) or
 * derivable from the OS (machineId). Lose the binary OR move the DB to a
 * different machine → HMAC mismatches → re-activation required.
 */

let cachedMachineId: string | null = null;

/**
 * Returns a stable, opaque per-machine identifier. Tries the OS's
 * machine-id files first (Linux/macOS), falls back to a hash of MAC
 * addresses + hostname. NOT cryptographically meaningful — only needs
 * to be stable across reboots on the same machine.
 *
 * Cached after first call so the various boot-time consumers all see
 * the same value even if /etc/machine-id changes mid-process (it
 * can't, but the cache also avoids re-doing the file IO on every
 * assert).
 */
export function machineId(): string {
  if (cachedMachineId) return cachedMachineId;
  const fromOs = readOsMachineId();
  if (fromOs) {
    cachedMachineId = sha256Hex(fromOs).slice(0, 32);
    return cachedMachineId;
  }
  // Fallback: hash MAC addresses + hostname. Less stable across NIC
  // changes but works on Windows/Docker where /etc/machine-id may be
  // absent or shared across containers (containers SHARE /etc/machine-id
  // by default — bad, but the MAC fallback at least varies).
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i!.mac)
    .sort()
    .join('|');
  cachedMachineId = sha256Hex(`${hostname()}|${macs}|fallback`).slice(0, 32);
  return cachedMachineId;
}

function readOsMachineId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    if (fs.existsSync('/etc/machine-id')) {
      const v = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (v) return v;
    }
    if (fs.existsSync('/var/lib/dbus/machine-id')) {
      const v = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
      if (v) return v;
    }
  } catch {
    // ENOENT / permission — fall through to the network-based fallback.
  }
  return null;
}

/**
 * Derive the symmetric key that protects the local LicenseRecord row.
 * Inputs:
 *   - publicKeyB64u: ed25519 public key bundled into the build at
 *     compile time (LICENSE_PUBLIC_KEY_ED25519). A different build (or
 *     a tampered binary) gets a different key.
 *   - machineId: see above.
 * Output: 32-byte HMAC key (Buffer).
 */
export function deriveVerdictKey(publicKeyB64u: string): Buffer {
  // HKDF would be more correct here but Node's HMAC is already a
  // PRF and the inputs are already high-entropy — single HMAC step
  // is sufficient and avoids dragging the HKDF helper in.
  return createHmac('sha256', `restora-license-verdict|${publicKeyB64u}`)
    .update(machineId())
    .digest();
}

/**
 * Sign the authoritative fields of a LicenseRecord. Result is base64url
 * of HMAC-SHA256 over a canonical "k=v|k=v|..." string. Order matters —
 * keep the field list AND the order in sync with `verifyVerdict`.
 */
export function signVerdict(
  publicKeyB64u: string,
  fields: VerdictFields,
): string {
  const data = canonicalize(fields);
  const mac = createHmac('sha256', deriveVerdictKey(publicKeyB64u))
    .update(data)
    .digest();
  return base64url(mac);
}

export function verifyVerdict(
  publicKeyB64u: string,
  fields: VerdictFields,
  expected: string,
): boolean {
  const actual = signVerdict(publicKeyB64u, fields);
  // Constant-time compare. For 43-char base64url strings the timing
  // difference is irrelevant in practice but the cost is also zero.
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export interface VerdictFields {
  licenseId: string;
  activatedDomain: string;
  fingerprint: string;
  status: string;
  signedProof: string;
  lastVerifiedAtMs: number;
  expiresAtMs: number | null;
  graceUntilMs: number | null;
}

function canonicalize(f: VerdictFields): string {
  // Single line, pipe-separated, fixed order. NOT JSON — JSON's whitespace
  // tolerance would let "active "  and "active" hash differently if
  // anything trimmed the value mid-flight.
  return [
    `lid=${f.licenseId}`,
    `dom=${f.activatedDomain}`,
    `fp=${f.fingerprint}`,
    `st=${f.status}`,
    `proof=${f.signedProof}`,
    `lv=${f.lastVerifiedAtMs}`,
    `exp=${f.expiresAtMs ?? 'null'}`,
    `grc=${f.graceUntilMs ?? 'null'}`,
  ].join('|');
}

function sha256Hex(s: string): string {
  return createHmac('sha256', 'restora-machine-id').update(s).digest('hex');
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Throwaway helper to derive a stable per-install fingerprint sent to
 * the license server at activate time. The server pins each license to
 * this fingerprint so a stolen purchase code can't be re-activated on a
 * different machine without first deactivating the original install.
 */
export function fingerprint(): string {
  return base64url(
    createHmac('sha256', 'restora-fingerprint')
      .update(machineId())
      .digest(),
  ).slice(0, 32);
}

/** Test-only: reset the cached machineId so unit tests can mutate the env. */
export function _resetCachedMachineIdForTests(): void {
  cachedMachineId = null;
}

// `randomBytes` import is kept for future test fixtures + to remind
// readers the helper is available without a separate import.
void randomBytes;

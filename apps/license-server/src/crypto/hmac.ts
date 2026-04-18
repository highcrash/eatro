import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Per-license HMAC secret derivation + request signing helpers.
 *
 * The license server hands each activation a unique 32-byte HMAC secret.
 * Installed clients use it to sign every subsequent verify/deactivate
 * call so a passive observer can't replay or forge requests for that
 * license — and a leak of one license's secret doesn't help attack
 * another.
 *
 * Derivation pipeline (server side):
 *   1. randomBytes(32) → IKM (input keying material)
 *   2. HKDF-SHA256(IKM, salt=LICENSE_HMAC_PEPPER, info=licenseId, len=32)
 *      → final hmacSecret
 *   3. AES-GCM-wrap with KEK → store in License.hmacSecretEnc
 *
 * Why HKDF + a server-side pepper, not just `randomBytes(32)`:
 *   - Defense-in-depth: if the DB leaks but the env doesn't, the
 *     wrapped secrets are recoverable (KEK in env), and even if both
 *     leak the attacker still needs the pepper to reproduce HKDF
 *     output for any client that derives keys client-side later.
 *   - The license-server itself stores the HKDF output (the result),
 *     not the IKM, so we don't need to remember the IKM. The pepper
 *     just adds one more secret to the chain.
 *
 * Wire signing format (matches the public-controller HMAC guard):
 *   sig = HMAC-SHA256(hmacSecret, `${unixSeconds}.${rawJsonBody}`)
 *   X-Signature: base64url(sig)
 *   X-Timestamp: <unixSeconds>
 *
 * The server reconstructs the same string and `timingSafeEqual` checks
 * the sigs. A 60-second drift window blocks replay; the body is in the
 * signed string so swapping bodies after-the-fact fails the check.
 */

const HMAC_ALGO = 'sha256';
const SECRET_LEN = 32;
const REPLAY_WINDOW_SECONDS = 60;

/**
 * Decode the LICENSE_HMAC_PEPPER from base64. Same lenient base64/base64url
 * acceptance + 32-byte length enforcement as the KEK.
 */
export function decodePepper(b64: string): Buffer {
  const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `LICENSE_HMAC_PEPPER must decode to exactly 32 bytes (got ${buf.length}). ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

/**
 * Derive a fresh per-license HMAC secret. Server calls this once during
 * activation; the result is the secret returned to the client AND wrapped
 * for storage.
 */
export function deriveLicenseHmacSecret(licenseId: string, pepper: Buffer): Buffer {
  // HKDF-Extract+Expand in one shot. `hkdfSync` returns an ArrayBuffer
  // (Node's typing is a bit awkward), so wrap in Buffer for ergonomics.
  const ikm = randomBytes(SECRET_LEN);
  const out = hkdfSync(HMAC_ALGO, ikm, pepper, Buffer.from(licenseId, 'utf8'), SECRET_LEN);
  return Buffer.from(out);
}

export function signRequest(
  hmacSecret: Buffer,
  timestamp: number,
  rawBody: string,
): string {
  const data = `${timestamp}.${rawBody}`;
  const mac = createHmac(HMAC_ALGO, hmacSecret).update(data, 'utf8').digest();
  return base64url(mac);
}

export interface VerifyOptions {
  /** Provided by the caller as `now()` for testability. Defaults to Date.now()/1000. */
  nowSeconds?: number;
}

/**
 * Returns true iff:
 *   - timestamp is within ±REPLAY_WINDOW_SECONDS of now, AND
 *   - HMAC of `<timestamp>.<rawBody>` equals the provided signature.
 *
 * timingSafeEqual prevents byte-by-byte timing attacks on the comparison.
 * `false` is returned (no exception) for any malformed / out-of-window
 * input — the caller handles the 401 / log line.
 */
export function verifyRequest(
  hmacSecret: Buffer,
  timestamp: number,
  rawBody: string,
  signatureB64u: string,
  opts: VerifyOptions = {},
): boolean {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) return false;

  let provided: Buffer;
  try {
    provided = base64urlDecode(signatureB64u);
  } catch {
    return false;
  }

  const expected = createHmac(HMAC_ALGO, hmacSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest();

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

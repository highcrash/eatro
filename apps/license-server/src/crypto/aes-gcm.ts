import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope used for "wrapping" sensitive secrets at rest:
 *  - SigningKey.ed25519PrivateKeyEnc (raw 32B ed25519 seed)
 *  - License.hmacSecretEnc          (raw 32B HMAC secret)
 *
 * The KEK (key-encryption key) is held in `LICENSE_SIGNING_KEK`. A DB
 * dump alone is useless without the KEK; the KEK alone (no DB) is also
 * useless. Compromise of EITHER triggers the same response: rotate the
 * KEK + re-wrap every signing key + every license hmacSecret.
 *
 * Wire format (printable, since we store in `text` columns):
 *   base64url(iv12) + "." + base64url(ciphertext) + "." + base64url(authTag16)
 *
 * Why three parts: GCM separates the auth tag from the ciphertext at
 * the API level (Node's `cipher.getAuthTag()`), so we serialize them
 * apart. The IV is random per-encryption (12 bytes per NIST SP 800-38D)
 * and stored alongside — IVs aren't secret, only their uniqueness
 * matters.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Decode the KEK from base64. Accepts both base64 and base64url. Throws
 * if the result isn't exactly 32 bytes — silent KEK corruption would be
 * the worst possible failure mode.
 */
export function decodeKek(b64: string): Buffer {
  // Tolerate base64url (-_ instead of +/), and missing padding.
  const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `LICENSE_SIGNING_KEK must decode to exactly 32 bytes (got ${buf.length}). ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

export function wrap(plaintext: Buffer, kek: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, kek, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64u(iv)}.${b64u(enc)}.${b64u(tag)}`;
}

export function unwrap(envelope: string, kek: Buffer): Buffer {
  const parts = envelope.split('.');
  if (parts.length !== 3) {
    throw new Error('aes-gcm.unwrap: malformed envelope (expected iv.ct.tag)');
  }
  const iv = b64uDecode(parts[0]);
  const ct = b64uDecode(parts[1]);
  const tag = b64uDecode(parts[2]);
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('aes-gcm.unwrap: bad iv/tag length');
  }
  const decipher = createDecipheriv(ALGO, kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Buffer {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

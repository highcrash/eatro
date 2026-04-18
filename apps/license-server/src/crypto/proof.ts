import { canonicalize, type JsonValue } from './jcs';
import { signMessage, verifyMessage } from './ed25519';

/**
 * Signed proofs returned by activate/verify.
 *
 * Wire format (JWT-ish, but ed25519 over JCS-canonical-JSON, no JOSE):
 *   base64url(canonical-payload) + "." + base64url(ed25519-sig)
 *
 * The proof is what the installed client caches and consults during
 * offline windows. Tampering (changing status, expiry, or domain) is
 * caught because the signature only verifies against the canonical
 * bytes the server signed.
 *
 * The kid lives INSIDE the payload, not in a separate header — keeps
 * the format trivial to parse with a single split. Clients that have
 * cached an older kid look up `/products/:sku/public-key` to fetch the
 * current pair (server keeps the previous public key live for 30 days
 * after rotation).
 */

export interface ProofPayload {
  /** Format version. Bump if the payload schema changes. */
  v: 1;
  /** Signing key id — points the client at the right public key. */
  kid: string;
  licenseId: string;
  productSku: string;
  domain: string;
  fingerprint: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING';
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. Null for term-less licenses (typical CodeCanyon case). */
  expiresAt: number | null;
  /** Unix seconds. Client trusts this proof for offline use until then. */
  graceUntil: number;
  /** Unix seconds. Client SHOULD revalidate by now (server hint). */
  revalidateAfter: number;
  /** Random per-issue. Defeats trivial replay even within the same second. */
  nonce: string;
}

export function signProof(payload: ProofPayload, privateSeed: Buffer): string {
  // canonicalize accepts the typed payload via the same JsonValue shape —
  // ProofPayload is a strict subset of JsonValue, so this is sound.
  const canonical = canonicalize(payload as unknown as JsonValue);
  const payloadBuf = Buffer.from(canonical, 'utf8');
  const sig = signMessage(payloadBuf, privateSeed);
  return `${b64u(payloadBuf)}.${b64u(sig)}`;
}

export interface ParsedProof {
  payload: ProofPayload;
  /** True iff the signature verifies under the supplied public key. */
  valid: boolean;
}

/**
 * Parse + signature-verify a proof. Returns `{ valid: false }` on any
 * structural problem; throws only on truly broken input (bad base64).
 *
 * Callers are expected to inspect `payload.kid` first to pick the right
 * public key (fetched from `/products/:sku/public-key`).
 */
export function parseProof(token: string, publicKey: Buffer): ParsedProof {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('parseProof: expected exactly one "." in proof token');
  }
  const payloadBuf = b64uDecode(parts[0]);
  const sigBuf = b64uDecode(parts[1]);

  let payload: ProofPayload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8')) as ProofPayload;
  } catch {
    throw new Error('parseProof: payload is not valid JSON');
  }

  // Ensure the bytes the server signed match what we just parsed —
  // re-canonicalise and compare. Defeats payload-substitution attacks
  // where bytes differ but JSON.parse is lenient enough to accept both.
  const recomputed = canonicalize(payload as unknown as JsonValue);
  if (recomputed !== payloadBuf.toString('utf8')) {
    return { payload, valid: false };
  }

  const valid = verifyMessage(payloadBuf, sigBuf, publicKey);
  return { payload, valid };
}

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Buffer {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

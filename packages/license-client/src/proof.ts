/**
 * Parse + verify the signed proofs issued by the license server.
 *
 * Wire format (compact JWT-ish):
 *   base64url(canonical JSON payload) + "." + base64url(ed25519 sig)
 *
 * Runs in three environments:
 *   Node (NestJS license gate)   — uses node:crypto.verify
 *   Electron main (POS desktop)  — same (full Node)
 *   Browser (public API call)    — uses Web Crypto subtle
 *
 * Detection is done per-call so a single bundled build works in all
 * three. Bundlers that tree-shake unused branches will still include
 * both paths, but they're ~30 lines combined.
 */

import { canonicalize } from './jcs';

export interface ProofPayload {
  v: 1;
  kid: string;
  licenseId: string;
  productSku: string;
  domain: string;
  fingerprint: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING';
  issuedAt: number;
  expiresAt: number | null;
  graceUntil: number;
  revalidateAfter: number;
  nonce: string;
}

export interface ParsedProof {
  payload: ProofPayload;
  valid: boolean;
}

/**
 * Parse + signature-verify a proof token against a known ed25519
 * public key (raw 32 bytes, base64url-encoded).
 *
 * Returns `{ valid: false }` for a structurally-OK-but-bad-signature
 * proof so the caller can still see what the server claimed.
 * Throws only for genuine garbage (wrong format / bad base64).
 */
export async function parseProof(token: string, publicKeyB64u: string): Promise<ParsedProof> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('parseProof: expected exactly one "." in proof token');
  }
  const payloadBuf = base64urlDecode(parts[0]);
  const sigBuf = base64urlDecode(parts[1]);

  let payload: ProofPayload;
  try {
    payload = JSON.parse(utf8Decode(payloadBuf)) as ProofPayload;
  } catch {
    throw new Error('parseProof: payload is not valid JSON');
  }

  // Payload-substitution defense: we re-canonicalise and compare bytes.
  // If the raw payload bytes differ from the canonical form even though
  // JSON.parse accepted both, the server didn't sign THIS exact byte
  // sequence and verification fails even if the sig itself checks out.
  const recomputed = canonicalize(payload as unknown as Record<string, unknown>);
  if (recomputed !== utf8Decode(payloadBuf)) {
    return { payload, valid: false };
  }

  const pubKey = base64urlDecode(publicKeyB64u);
  if (pubKey.length !== 32) {
    throw new Error('parseProof: public key must decode to exactly 32 bytes');
  }

  const valid = await verifyEd25519(payloadBuf, sigBuf, pubKey);
  return { payload, valid };
}

// ── crypto backend detection ──────────────────────────────────────────

async function verifyEd25519(msg: Uint8Array, sig: Uint8Array, pubKey: Uint8Array): Promise<boolean> {
  // Prefer node:crypto if we're in a Node-like runtime — handles
  // Electron main + the NestJS license gate. `typeof process !==
  // 'undefined' && process.versions?.node` is the standard check.
  if (typeof process !== 'undefined' && process.versions?.node) {
    return verifyEd25519Node(msg, sig, pubKey);
  }
  // Browser fallback via Web Crypto subtle. Ed25519 needs Chrome 113+ /
  // Safari 17+ / Firefox 130+ — CodeCanyon buyer's admin-in-browser
  // verify calls (rare) will need a recent browser.
  return verifyEd25519Web(msg, sig, pubKey);
}

async function verifyEd25519Node(msg: Uint8Array, sig: Uint8Array, pubKey: Uint8Array): Promise<boolean> {
  // Dynamic require so browser bundles don't pull node:crypto in.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createPublicKey, verify } = await import('node:crypto');

  // Rebuild the SPKI DER blob from the raw 32-byte public key by
  // prefixing the standard ed25519 SPKI header — saves us from
  // requiring callers to provide pre-wrapped PEM/DER.
  const SPKI_PREFIX = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const spki = new Uint8Array(SPKI_PREFIX.length + pubKey.length);
  spki.set(SPKI_PREFIX, 0);
  spki.set(pubKey, SPKI_PREFIX.length);

  const keyObject = createPublicKey({
    key: Buffer.from(spki),
    format: 'der',
    type: 'spki',
  });

  return verify(null, Buffer.from(msg), keyObject, Buffer.from(sig));
}

async function verifyEd25519Web(msg: Uint8Array, sig: Uint8Array, pubKey: Uint8Array): Promise<boolean> {
  const g = globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } };
  if (!g.crypto?.subtle) {
    throw new Error('parseProof: no crypto backend available (no node:crypto, no web crypto subtle)');
  }
  // Cast Uint8Array views as BufferSource — TS's DOM lib expects an
  // ArrayBuffer-backed view and our Uint8Array<ArrayBufferLike> needs
  // a nudge through the type system.
  const key = await g.crypto.subtle.importKey('raw', pubKey as BufferSource, { name: 'Ed25519' }, false, ['verify']);
  return g.crypto.subtle.verify({ name: 'Ed25519' }, key, sig as BufferSource, msg as BufferSource);
}

// ── encoding helpers (zero-dep) ──────────────────────────────────────

function base64urlDecode(s: string): Uint8Array {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  // Node/browser both expose atob; Node 16+ added atob to globalThis.
  // Buffer.from would be Node-only so we stick to atob for portability.
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8Decode(buf: Uint8Array): string {
  // TextDecoder is available in Node 11+ and every modern browser.
  return new TextDecoder('utf-8').decode(buf);
}

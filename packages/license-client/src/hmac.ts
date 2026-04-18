/**
 * HMAC-SHA256 request signing. Client side — produces the X-Signature
 * header the license server's HmacRequestGuard validates.
 *
 * Same wire format as apps/license-server/src/crypto/hmac.ts:
 *   sig = HMAC-SHA256(hmacSecret, `${unixSeconds}.${rawBody}`)
 *   X-Signature: base64url(sig)
 *   X-Timestamp: <unix seconds>
 *
 * Backend-agnostic same as proof.ts: Node's crypto.createHmac when
 * available, otherwise Web Crypto subtle.importKey + subtle.sign.
 */

export async function signRequest(
  hmacSecret: Uint8Array,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const data = `${timestamp}.${rawBody}`;
  const mac = await hmacSha256(hmacSecret, data);
  return base64url(mac);
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createHmac } = await import('node:crypto');
    const buf = createHmac('sha256', Buffer.from(key)).update(data, 'utf8').digest();
    return new Uint8Array(buf);
  }
  const g = globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } };
  if (!g.crypto?.subtle) {
    throw new Error('signRequest: no crypto backend (no node:crypto, no web crypto subtle)');
  }
  const cryptoKey = await g.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await g.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data) as BufferSource);
  return new Uint8Array(sig);
}

function base64url(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(s: string): Uint8Array {
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

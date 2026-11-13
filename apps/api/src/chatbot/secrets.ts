import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Encryption for secrets the owner pastes into admin (AI keys now, the
 * Meta app secret later). AES-256-GCM; stored as `v1.<iv>.<tag>.<data>`.
 *
 * The key is SECRETS_KEY when set, otherwise derived from JWT_SECRET so
 * no new server setting is needed. Changing the key source makes stored
 * secrets unreadable: `decryptSecret` then returns null and admin asks
 * for the key again.
 */
export function secretsKey(env: { SECRETS_KEY?: string; JWT_SECRET?: string }): Buffer {
  const source = env.SECRETS_KEY?.trim() || env.JWT_SECRET?.trim();
  if (!source) throw new Error('SECRETS_KEY or JWT_SECRET must be set to store keys');
  return Buffer.from(hkdfSync('sha256', source, 'restora-secrets', 'chatbot-v1', 32));
}

const b64u = (b: Buffer) => b.toString('base64url');

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', b64u(iv), b64u(cipher.getAuthTag()), b64u(data)].join('.');
}

export function decryptSecret(stored: string, key: Buffer): string | null {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** What admin shows instead of a key: enough to recognise it, never enough to use it. */
export function keyHint(plain: string): string {
  return plain.length > 8 ? `…${plain.slice(-4)}` : '…';
}

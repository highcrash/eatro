import { randomBytes } from 'node:crypto';
import { decodeKek, wrap, unwrap } from './aes-gcm';

describe('aes-gcm', () => {
  const kek = randomBytes(32);

  it('round-trips a plaintext through wrap/unwrap', () => {
    const pt = Buffer.from('the quick brown fox', 'utf8');
    const env = wrap(pt, kek);
    expect(unwrap(env, kek).equals(pt)).toBe(true);
  });

  it('produces a different envelope each call (random IV)', () => {
    const pt = Buffer.from('same plaintext', 'utf8');
    const a = wrap(pt, kek);
    const b = wrap(pt, kek);
    expect(a).not.toBe(b);
    // But both decrypt to the same value.
    expect(unwrap(a, kek).equals(unwrap(b, kek))).toBe(true);
  });

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const env = wrap(Buffer.from('secret'), kek);
    const parts = env.split('.');
    // Flip one bit in the ciphertext segment.
    const ctBuf = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - parts[1].length % 4) % 4), 'base64');
    ctBuf[0] ^= 0x01;
    const tampered = `${parts[0]}.${ctBuf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${parts[2]}`;
    expect(() => unwrap(tampered, kek)).toThrow();
  });

  it('rejects unwrap with the wrong KEK', () => {
    const env = wrap(Buffer.from('secret'), kek);
    const wrongKek = randomBytes(32);
    expect(() => unwrap(env, wrongKek)).toThrow();
  });

  it('decodeKek accepts base64 + base64url + missing padding', () => {
    const raw = randomBytes(32);
    const std = raw.toString('base64');
    const url = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeKek(std).equals(raw)).toBe(true);
    expect(decodeKek(url).equals(raw)).toBe(true);
  });

  it('decodeKek rejects wrong-length input', () => {
    expect(() => decodeKek(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => decodeKek(Buffer.alloc(31).toString('base64'))).toThrow();
  });
});

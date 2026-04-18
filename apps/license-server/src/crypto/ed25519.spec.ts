import { generateKeypair, signMessage, verifyMessage, publicKeyFromSeed } from './ed25519';

describe('ed25519', () => {
  it('generateKeypair returns 32-byte seed + 32-byte public key', () => {
    const kp = generateKeypair();
    expect(kp.privateSeed.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
  });

  it('round-trips: a signature over msg verifies under matching public key', () => {
    const { privateSeed, publicKey } = generateKeypair();
    const msg = Buffer.from('the quick brown fox jumps over the lazy dog', 'utf8');
    const sig = signMessage(msg, privateSeed);
    expect(verifyMessage(msg, sig, publicKey)).toBe(true);
  });

  it('rejects a signature under a different public key', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const msg = Buffer.from('hello', 'utf8');
    const sig = signMessage(msg, a.privateSeed);
    expect(verifyMessage(msg, sig, b.publicKey)).toBe(false);
  });

  it('rejects a signature for a tampered message', () => {
    const { privateSeed, publicKey } = generateKeypair();
    const msg = Buffer.from('hello', 'utf8');
    const sig = signMessage(msg, privateSeed);
    const tampered = Buffer.from('Hello', 'utf8');
    expect(verifyMessage(tampered, sig, publicKey)).toBe(false);
  });

  it('publicKeyFromSeed reproduces the same public key', () => {
    const kp = generateKeypair();
    const recomputed = publicKeyFromSeed(kp.privateSeed);
    expect(recomputed.equals(kp.publicKey)).toBe(true);
  });

  it('signMessage rejects wrong-length seed', () => {
    const msg = Buffer.from('x');
    expect(() => signMessage(msg, Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it('verifyMessage rejects wrong-length public key', () => {
    const msg = Buffer.from('x');
    expect(() => verifyMessage(msg, Buffer.alloc(64), Buffer.alloc(31))).toThrow(/32 bytes/);
  });
});

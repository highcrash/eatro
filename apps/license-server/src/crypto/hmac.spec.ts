import { randomBytes } from 'node:crypto';
import { decodePepper, deriveLicenseHmacSecret, signRequest, verifyRequest } from './hmac';

describe('hmac', () => {
  const pepper = randomBytes(32);

  describe('deriveLicenseHmacSecret', () => {
    it('returns 32 bytes', () => {
      const s = deriveLicenseHmacSecret('lic_abc', pepper);
      expect(s.length).toBe(32);
    });

    it('returns different secrets for different licenseIds (info input matters)', () => {
      const a = deriveLicenseHmacSecret('lic_a', pepper);
      const b = deriveLicenseHmacSecret('lic_b', pepper);
      expect(a.equals(b)).toBe(false);
    });

    it('returns different secrets across calls for the same id (random IKM)', () => {
      const a = deriveLicenseHmacSecret('lic_x', pepper);
      const b = deriveLicenseHmacSecret('lic_x', pepper);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('signRequest / verifyRequest round-trip', () => {
    const secret = randomBytes(32);
    const ts = 1700000000;
    const body = '{"hello":"world"}';

    it('verifies a freshly signed request', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, ts, body, sig, { nowSeconds: ts })).toBe(true);
    });

    it('rejects when the body is changed', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, ts, '{"hello":"WORLD"}', sig, { nowSeconds: ts })).toBe(false);
    });

    it('rejects when the timestamp is changed (HMAC differs)', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, ts + 1, body, sig, { nowSeconds: ts + 1 })).toBe(false);
    });

    it('rejects when timestamp drifts beyond ±60s', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, ts, body, sig, { nowSeconds: ts + 61 })).toBe(false);
      expect(verifyRequest(secret, ts, body, sig, { nowSeconds: ts - 61 })).toBe(false);
    });

    it('accepts within the ±60s replay window', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, ts, body, sig, { nowSeconds: ts + 59 })).toBe(true);
      expect(verifyRequest(secret, ts, body, sig, { nowSeconds: ts - 59 })).toBe(true);
    });

    it('rejects when the wrong secret is used', () => {
      const sig = signRequest(secret, ts, body);
      const wrong = randomBytes(32);
      expect(verifyRequest(wrong, ts, body, sig, { nowSeconds: ts })).toBe(false);
    });

    it('returns false (not throw) on malformed signature', () => {
      expect(verifyRequest(secret, ts, body, 'not-base64-!!!', { nowSeconds: ts })).toBe(false);
    });

    it('returns false on non-finite timestamp', () => {
      const sig = signRequest(secret, ts, body);
      expect(verifyRequest(secret, NaN, body, sig, { nowSeconds: ts })).toBe(false);
    });
  });

  describe('decodePepper', () => {
    it('accepts standard + url-safe base64', () => {
      const raw = randomBytes(32);
      const std = raw.toString('base64');
      const url = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(decodePepper(std).equals(raw)).toBe(true);
      expect(decodePepper(url).equals(raw)).toBe(true);
    });

    it('rejects wrong length', () => {
      expect(() => decodePepper(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    });
  });
});

import { generateKeypair } from './ed25519';
import { signProof, parseProof, type ProofPayload } from './proof';

describe('proof', () => {
  const { privateSeed, publicKey } = generateKeypair();

  const payload: ProofPayload = {
    v: 1,
    kid: 'kid-test',
    licenseId: 'lic_abc',
    productSku: 'restora-pos-cc',
    domain: 'demo.example.com',
    fingerprint: 'sha256:abcd',
    status: 'ACTIVE',
    issuedAt: 1700000000,
    expiresAt: null,
    graceUntil: 1700604800,
    revalidateAfter: 1700086400,
    nonce: 'n-aaa',
  };

  it('signProof returns a base64url.base64url token', () => {
    const token = signProof(payload, privateSeed);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('parseProof verifies a freshly signed proof + returns the payload', () => {
    const token = signProof(payload, privateSeed);
    const result = parseProof(token, publicKey);
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual(payload);
  });

  it('parseProof reports valid=false under a different public key', () => {
    const other = generateKeypair();
    const token = signProof(payload, privateSeed);
    const result = parseProof(token, other.publicKey);
    expect(result.valid).toBe(false);
    // Payload still parses — only the signature is rejected.
    expect(result.payload.licenseId).toBe('lic_abc');
  });

  it('parseProof rejects payload-substitution attacks', () => {
    const token = signProof(payload, privateSeed);
    const [encodedPayload, sig] = token.split('.');

    // Decode, mutate, re-encode WITHOUT canonical-resigning.
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
    decoded.status = 'EXPIRED';
    const mutatedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tampered = `${mutatedPayload}.${sig}`;

    const result = parseProof(tampered, publicKey);
    expect(result.valid).toBe(false);
  });

  it('parseProof throws on structurally broken token', () => {
    expect(() => parseProof('no-dot-at-all', publicKey)).toThrow();
    expect(() => parseProof('a.b.c', publicKey)).toThrow();
  });

  it('parseProof throws when payload is not valid JSON', () => {
    const bogus = Buffer.from('not json').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parseProof(`${bogus}.AAAA`, publicKey)).toThrow();
  });
});

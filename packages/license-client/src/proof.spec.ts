import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalize } from './jcs';
import { parseProof, type ProofPayload } from './proof';

// Sign a proof locally using Node crypto — mirrors the server's wire
// format (JCS canonical + ed25519 + compact base64url.base64url). We
// rebuild it in the test file rather than importing from the server so
// the client package stays zero-dep at runtime AND in tests.
function signLocalProof(payload: ProofPayload, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string {
  const canonical = canonicalize(payload as unknown as Record<string, unknown>);
  const payloadBuf = Buffer.from(canonical, 'utf8');
  const sig = sign(null, payloadBuf, privateKey);
  return `${b64u(payloadBuf)}.${b64u(sig)}`;
}

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function rawPublicKeyB64u(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): string {
  // SPKI DER for ed25519 = 12-byte prefix + 32-byte raw key. Slice to the raw.
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return b64u(Buffer.from(der.subarray(der.length - 32)));
}

describe('proof (client)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64u = rawPublicKeyB64u(publicKey);

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

  it('parseProof verifies a valid proof + returns the payload', async () => {
    const token = signLocalProof(payload, privateKey);
    const result = await parseProof(token, pubB64u);
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual(payload);
  });

  it('parseProof reports valid=false under a different public key', async () => {
    const other = generateKeyPairSync('ed25519');
    const token = signLocalProof(payload, privateKey);
    const result = await parseProof(token, rawPublicKeyB64u(other.publicKey));
    expect(result.valid).toBe(false);
    expect(result.payload.licenseId).toBe('lic_abc');
  });

  it('parseProof rejects payload-substitution attacks', async () => {
    const token = signLocalProof(payload, privateKey);
    const [encodedPayload, sig] = token.split('.');

    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
    decoded.status = 'EXPIRED';
    const mutatedPayload = b64u(Buffer.from(JSON.stringify(decoded)));
    const tampered = `${mutatedPayload}.${sig}`;

    const result = await parseProof(tampered, pubB64u);
    expect(result.valid).toBe(false);
  });

  it('parseProof throws on structurally broken token', async () => {
    await expect(parseProof('no-dot-at-all', pubB64u)).rejects.toThrow();
    await expect(parseProof('a.b.c', pubB64u)).rejects.toThrow();
  });

  it('parseProof throws when payload is not valid JSON', async () => {
    const bogus = b64u(Buffer.from('not json'));
    await expect(parseProof(`${bogus}.AAAA`, pubB64u)).rejects.toThrow();
  });

  it('parseProof rejects public keys that are not exactly 32 bytes', async () => {
    const token = signLocalProof(payload, privateKey);
    const shortKey = b64u(Buffer.from([1, 2, 3, 4]));
    await expect(parseProof(token, shortKey)).rejects.toThrow(/32 bytes/);
  });
});

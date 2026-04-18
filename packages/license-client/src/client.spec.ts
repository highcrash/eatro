import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { canonicalize } from './jcs';
import { activate, verify, localVerdict, hostMatchesLicense, LicenseApiError } from './client';
import { memoryStorage } from './storage';
import type { ProofPayload } from './proof';
import type { LicenseClientConfig } from './types';

// A minimal fake license server. Implements just enough of the wire
// protocol to round-trip activate/verify through the client. Issues
// ed25519-signed proofs using a locally-generated keypair so we can
// exercise the whole signature-verification path end-to-end.
function makeFakeServer(opts: { initialStatus?: ProofPayload['status']; domain?: string } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ format: 'der', type: 'spki' });
  const pubB64u = b64u(Buffer.from(pubRaw.subarray(pubRaw.length - 32)));
  const kid = 'kid-fake-1';
  const state = {
    licenseId: 'lic_test',
    domain: opts.domain ?? 'demo.example.com',
    fingerprint: 'fp-test',
    status: (opts.initialStatus ?? 'ACTIVE') as ProofPayload['status'],
    hmacSecretB64u: b64u(randomBytes(32)),
    issuedAtStart: 1_700_000_000,
  };

  function signProof(nowSec: number, status = state.status): string {
    const payload: ProofPayload = {
      v: 1,
      kid,
      licenseId: state.licenseId,
      productSku: 'restora-pos-cc',
      domain: state.domain,
      fingerprint: state.fingerprint,
      status,
      issuedAt: nowSec,
      expiresAt: null,
      // 7-day grace window. The client measures grace from its own
      // lastVerifiedAtMs (clock-rewind resistant), but issuedAt/graceUntil
      // must bracket that window consistently.
      graceUntil: nowSec + 7 * 24 * 3600,
      revalidateAfter: nowSec + 24 * 3600,
      nonce: `n-${nowSec}`,
    };
    const canonical = canonicalize(payload as unknown as Record<string, unknown>);
    const payloadBuf = Buffer.from(canonical, 'utf8');
    const sig = sign(null, payloadBuf, privateKey);
    return `${b64u(payloadBuf)}.${b64u(sig)}`;
  }

  let nextStatus: ProofPayload['status'] = state.status;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^.*\/v1/, '');
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const nowSec = Math.floor(Date.now() / 1000);

    if (path === '/licenses/activate') {
      if (body.purchaseCode !== 'GOOD-CODE') {
        return jsonRes(403, { result: 'INVALID_CODE', message: 'bad code' });
      }
      state.status = nextStatus;
      return jsonRes(200, {
        licenseId: state.licenseId,
        hmacSecret: state.hmacSecretB64u,
        kid,
        signedProof: signProof(nowSec, state.status),
        revalidateAfter: nowSec + 24 * 3600,
      });
    }

    if (path === '/licenses/verify') {
      state.status = nextStatus;
      return jsonRes(200, {
        status: state.status,
        signedProof: signProof(nowSec, state.status),
      });
    }

    if (path === '/licenses/deactivate') {
      return jsonRes(200, { ok: true });
    }

    return jsonRes(404, { result: 'NOT_FOUND', message: path });
  }) as typeof fetch;

  return {
    fetchImpl,
    pubB64u,
    kid,
    setStatus(s: ProofPayload['status']) { nextStatus = s; },
  };
}

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonRes(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cfg(server: ReturnType<typeof makeFakeServer>, nowMs: number): LicenseClientConfig {
  return {
    baseUrl: 'https://license.test/api/v1',
    productSku: 'restora-pos-cc',
    publicKey: server.pubB64u,
    publicKeyKid: server.kid,
    storage: memoryStorage(),
    now: () => nowMs,
    fetch: server.fetchImpl,
  };
}

describe('license-client flow', () => {
  it('activate stores state + returns active verdict', async () => {
    const server = makeFakeServer();
    const c = cfg(server, Date.now());
    const verdict = await activate(c, {
      purchaseCode: 'GOOD-CODE',
      domain: 'demo.example.com',
      fingerprint: 'fp-test',
    });
    expect(verdict.mode).toBe('active');
    expect(verdict.status).toBe('ACTIVE');
    expect(verdict.licenseId).toBe('lic_test');
    expect(await c.storage.read()).toMatchObject({ licenseId: 'lic_test' });
  });

  it('activate surfaces server errors as LicenseApiError', async () => {
    const server = makeFakeServer();
    const c = cfg(server, Date.now());
    await expect(
      activate(c, { purchaseCode: 'BAD', domain: 'demo.example.com', fingerprint: 'fp-test' }),
    ).rejects.toBeInstanceOf(LicenseApiError);
  });

  it('verify refreshes lastVerifiedAtMs and issues a fresh proof', async () => {
    const server = makeFakeServer();
    let now = Date.now();
    const c = cfg(server, now);
    await activate(c, { purchaseCode: 'GOOD-CODE', domain: 'demo.example.com', fingerprint: 'fp-test' });

    // Advance 3h and re-verify — still active, lastVerifiedAtMs moves forward.
    now += 3 * 3600 * 1000;
    (c as { now: () => number }).now = () => now;
    const v = await verify(c);
    expect(v.mode).toBe('active');
    const saved = await c.storage.read();
    expect(saved!.lastVerifiedAtMs).toBe(now);
  });

  it('localVerdict returns grace after 24h offline, locked after 7d', async () => {
    const server = makeFakeServer();
    let now = Date.now();
    const c = cfg(server, now);
    await activate(c, { purchaseCode: 'GOOD-CODE', domain: 'demo.example.com', fingerprint: 'fp-test' });

    // +25 hours → grace.
    now += 25 * 3600 * 1000;
    (c as { now: () => number }).now = () => now;
    const grace = await localVerdict(c);
    expect(grace.mode).toBe('grace');
    expect(grace.graceDaysRemaining).toBeGreaterThan(0);

    // +8 days → locked.
    now += 8 * 24 * 3600 * 1000;
    (c as { now: () => number }).now = () => now;
    const locked = await localVerdict(c);
    expect(locked.mode).toBe('locked');
    expect(locked.graceDaysRemaining).toBe(0);
  });

  it('localVerdict returns locked when server-side REVOKED, regardless of recency', async () => {
    const server = makeFakeServer();
    const c = cfg(server, Date.now());
    await activate(c, { purchaseCode: 'GOOD-CODE', domain: 'demo.example.com', fingerprint: 'fp-test' });

    server.setStatus('REVOKED');
    await verify(c);

    const v = await localVerdict(c);
    expect(v.mode).toBe('locked');
    expect(v.status).toBe('REVOKED');
    expect(v.reason).toMatch(/revoked/i);
  });

  it('localVerdict with empty storage returns missing', async () => {
    const server = makeFakeServer();
    const c = cfg(server, Date.now());
    const v = await localVerdict(c);
    expect(v.mode).toBe('missing');
    expect(v.licenseId).toBeNull();
  });

  it('hostMatchesLicense accepts wildcards + blocks suffix-append', () => {
    const payload = { domain: '*.example.com' } as unknown as ProofPayload;
    expect(hostMatchesLicense(payload, 'app.example.com')).toBe(true);
    expect(hostMatchesLicense(payload, 'example.com')).toBe(true);
    expect(hostMatchesLicense(payload, 'example.com.attacker.io')).toBe(false);
    expect(hostMatchesLicense(payload, 'notexample.com')).toBe(false);
  });
});

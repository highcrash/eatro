import { parseProof, type ProofPayload } from './proof';
import { signRequest, base64urlDecode } from './hmac';
import { domainMatches } from './domain-match';
import type {
  LicenseClientConfig,
  PersistedState,
  Verdict,
  VerdictMode,
} from './types';

/**
 * High-level client API. Three network operations + one pure-offline
 * verdict calculator. Everything is idempotent-safe — retrying
 * activate() with the same {code, domain, fingerprint} is the server's
 * defined behaviour and just re-issues a proof.
 *
 * Error handling:
 *   - Network failures (fetch rejects) → throw, so the caller can
 *     decide whether to fall back to localVerdict().
 *   - Server returns 4xx → throw LicenseApiError with the server's
 *     { result, message } attached.
 *   - Server returns 200 but the proof signature doesn't verify →
 *     throw. A bogus proof should never be silently cached.
 */

export class LicenseApiError extends Error {
  readonly status: number;
  readonly result: string;
  constructor(status: number, result: string, message: string) {
    super(message);
    this.name = 'LicenseApiError';
    this.status = status;
    this.result = result;
  }
}

export interface ActivateInput {
  purchaseCode: string;
  domain: string;
  fingerprint: string;
}

export async function activate(cfg: LicenseClientConfig, input: ActivateInput): Promise<Verdict> {
  const res = await postJson(cfg, '/licenses/activate', {
    productSku: cfg.productSku,
    purchaseCode: input.purchaseCode,
    domain: input.domain,
    fingerprint: input.fingerprint,
  });

  const body = res as {
    licenseId: string;
    hmacSecret: string;
    kid: string;
    signedProof: string;
    revalidateAfter: number;
  };

  // Verify the proof before caching. Never trust an unverified proof —
  // a man-in-the-middle could hand back a bogus ACTIVE response.
  const publicKey = await publicKeyFor(cfg, body.kid);
  const parsed = await parseProof(body.signedProof, publicKey);
  if (!parsed.valid) {
    throw new LicenseApiError(200, 'SIG_FAIL', 'Server proof failed signature verification');
  }

  const state: PersistedState = {
    licenseId: body.licenseId,
    hmacSecretB64u: body.hmacSecret,
    signedProof: body.signedProof,
    lastVerifiedAtMs: (cfg.now ?? Date.now)(),
    kid: body.kid,
  };
  await cfg.storage.write(state);
  return verdictFromProof(parsed.payload, state.lastVerifiedAtMs, cfg);
}

export async function verify(cfg: LicenseClientConfig): Promise<Verdict> {
  const state = await Promise.resolve(cfg.storage.read());
  if (!state) {
    return missingVerdict('No license cached — activate first');
  }

  const now = (cfg.now ?? Date.now)();
  const body = { licenseId: state.licenseId, fingerprint: fingerprintFromProofOrThrow(state) };
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(now / 1000);
  const hmacSecret = base64urlDecode(state.hmacSecretB64u);
  const sig = await signRequest(hmacSecret, timestamp, rawBody);

  const res = await postSignedJson(cfg, '/licenses/verify', rawBody, timestamp, sig);
  const { status, signedProof } = res as { status: ProofPayload['status']; signedProof: string };

  const publicKey = await publicKeyFor(cfg, state.kid, state.signedProof);
  const parsed = await parseProof(signedProof, publicKey);
  if (!parsed.valid) {
    throw new LicenseApiError(200, 'SIG_FAIL', 'Server proof failed signature verification');
  }

  const nextState: PersistedState = {
    ...state,
    signedProof,
    lastVerifiedAtMs: now,
    kid: parsed.payload.kid,
  };
  await cfg.storage.write(nextState);

  // Surface the server's verdict — if it flipped us to REVOKED, the
  // proof carries status:REVOKED and verdictFromProof returns locked.
  void status;
  return verdictFromProof(parsed.payload, now, cfg);
}

export async function deactivate(cfg: LicenseClientConfig): Promise<void> {
  const state = await Promise.resolve(cfg.storage.read());
  if (!state) return; // nothing to deactivate

  const body = { licenseId: state.licenseId, fingerprint: fingerprintFromProofOrThrow(state) };
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor((cfg.now ?? Date.now)() / 1000);
  const hmacSecret = base64urlDecode(state.hmacSecretB64u);
  const sig = await signRequest(hmacSecret, timestamp, rawBody);

  try {
    await postSignedJson(cfg, '/licenses/deactivate', rawBody, timestamp, sig);
  } finally {
    // Clear local state even if the server call fails — the admin can
    // reconcile server-side usedActivations manually if needed.
    await Promise.resolve(cfg.storage.clear());
  }
}

/**
 * Decide a verdict from cached state alone, no network. Used on boot
 * before verify() and whenever a verify() fails with a network error.
 */
export async function localVerdict(cfg: LicenseClientConfig): Promise<Verdict> {
  const state = await Promise.resolve(cfg.storage.read());
  if (!state) return missingVerdict('No license cached');

  const publicKey = await publicKeyFor(cfg, state.kid, state.signedProof);
  const parsed = await parseProof(state.signedProof, publicKey);
  if (!parsed.valid) {
    return {
      mode: 'locked',
      status: null,
      graceDaysRemaining: 0,
      licenseId: state.licenseId,
      domain: null,
      reason: 'Cached proof signature failed — cache may be tampered with',
    };
  }

  const now = (cfg.now ?? Date.now)();
  return verdictFromProof(parsed.payload, state.lastVerifiedAtMs, cfg, now);
}

/**
 * Compare a hostname against the license's registered domain pattern.
 * Called at request time by the gate module to reject mismatches.
 */
export function hostMatchesLicense(payload: ProofPayload, host: string): boolean {
  // Host is already normalised by the server's matcher when the proof
  // was issued; we re-normalise the caller's host here to avoid trust
  // boundaries between normalize calls on either side.
  const normalizedHost = host.trim().toLowerCase()
    .replace(/\.$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return domainMatches(payload.domain, normalizedHost);
}

// ── internals ─────────────────────────────────────────────────────────

function missingVerdict(reason: string): Verdict {
  return {
    mode: 'missing',
    status: null,
    graceDaysRemaining: 0,
    licenseId: null,
    domain: null,
    reason,
  };
}

function fingerprintFromProofOrThrow(state: PersistedState): string {
  // Pull the fingerprint out of the cached proof so the client can't
  // accidentally send a DIFFERENT fingerprint than the one it
  // activated with. The payload is base64url-encoded JSON; we decode
  // just enough to read `fingerprint`.
  const [payloadPart] = state.signedProof.split('.');
  try {
    const standard = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    const bin = atob(padded);
    const json = new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json) as { fingerprint: string };
    if (typeof payload.fingerprint !== 'string') throw new Error('missing fingerprint');
    return payload.fingerprint;
  } catch (err) {
    throw new Error(`license-client: cached proof is malformed (${(err as Error).message})`);
  }
}

function verdictFromProof(
  payload: ProofPayload,
  lastVerifiedAtMs: number,
  cfg: LicenseClientConfig,
  now = (cfg.now ?? Date.now)(),
): Verdict {
  // Status-based locking trumps grace. A revoked license is locked
  // immediately regardless of how recently we last verified.
  if (payload.status === 'REVOKED' || payload.status === 'EXPIRED') {
    return {
      mode: 'locked',
      status: payload.status,
      graceDaysRemaining: 0,
      licenseId: payload.licenseId,
      domain: payload.domain,
      reason: payload.status === 'REVOKED' ? 'License revoked by admin' : 'License expired',
    };
  }

  // Grace window is measured from LAST SUCCESSFUL VERIFY, not from the
  // proof's graceUntil. This way a clock-rewind attack can't extend
  // the window — lastVerifiedAtMs comes from the client's own wall
  // clock at successful-fetch time, stored in storage.
  const graceEndMs = lastVerifiedAtMs + (payload.graceUntil - payload.issuedAt) * 1000;
  const msRemaining = graceEndMs - now;

  let mode: VerdictMode;
  let reason: string;
  if (now - lastVerifiedAtMs < 24 * 3600 * 1000) {
    mode = 'active';
    reason = 'Verified within last 24h';
  } else if (msRemaining > 0) {
    mode = 'grace';
    reason = `Offline grace period — last verified ${daysAgo(lastVerifiedAtMs, now)} day(s) ago`;
  } else {
    mode = 'locked';
    reason = 'Offline grace expired — reconnect to verify your license';
  }

  return {
    mode,
    status: payload.status,
    graceDaysRemaining: Math.max(0, Math.floor(msRemaining / (24 * 3600 * 1000))),
    licenseId: payload.licenseId,
    domain: payload.domain,
    reason,
  };
}

function daysAgo(thenMs: number, nowMs: number): number {
  return Math.floor((nowMs - thenMs) / (24 * 3600 * 1000));
}

async function publicKeyFor(
  cfg: LicenseClientConfig,
  kid: string,
  _cachedProof?: string,
): Promise<string> {
  // Fast path: bundled kid matches what we need. Expected 99% of the time.
  if (kid === cfg.publicKeyKid) return cfg.publicKey;

  // The server rotated keys. Fetch the current pair and check whether
  // the bundled OR the previous key covers this kid.
  const res = await doFetch(cfg, `/products/${encodeURIComponent(cfg.productSku)}/public-key`);
  const body = (await res.json()) as {
    kid: string;
    publicKey: string;
    previousKid: string | null;
    previousPublicKey: string | null;
  };
  if (body.kid === kid) return body.publicKey;
  if (body.previousKid === kid && body.previousPublicKey) return body.previousPublicKey;
  throw new Error(`license-client: unknown kid "${kid}" — client build is older than the retire window`);
}

async function postJson(cfg: LicenseClientConfig, path: string, payload: unknown): Promise<unknown> {
  const res = await doFetch(cfg, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

async function postSignedJson(
  cfg: LicenseClientConfig,
  path: string,
  rawBody: string,
  timestamp: number,
  sig: string,
): Promise<unknown> {
  const res = await doFetch(cfg, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timestamp': String(timestamp),
      'X-Signature': sig,
    },
    body: rawBody,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

async function doFetch(cfg: LicenseClientConfig, path: string, init?: RequestInit): Promise<Response> {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch as typeof fetch);
  return fetchImpl(`${cfg.baseUrl}${path}`, init);
}

async function throwApiError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { result?: string; message?: string } | null;
  throw new LicenseApiError(
    res.status,
    body?.result ?? 'ERROR',
    body?.message ?? res.statusText,
  );
}

import type { LicenseStorage, PersistedState } from '@restora/license-client';
import type { PrismaService } from '../prisma/prisma.service';
import { signVerdict, verifyVerdict } from './license.crypto';

/**
 * Bridges @restora/license-client's `LicenseStorage` interface to our
 * Prisma-backed `LicenseRecord` singleton row. The client only knows
 * about a flat blob (`PersistedState`); we map that onto our richer
 * row, adding:
 *
 *   - `verdictHmac` written on every save and verified on every read,
 *     keyed off `machineId + bundled public key`. Tampering with the row
 *     (most obvious: `UPDATE … SET status='ACTIVE'`) fails verification
 *     and we return `null` from `read()` — forcing the gate to treat the
 *     install as un-activated and require a fresh online verify.
 *   - `purchaseCodeTail` for support visibility (last 8 chars; never the
 *     full code).
 *   - `activatedDomain` carried through so the host-match guard has it
 *     without re-parsing the cached proof.
 */
export class PrismaLicenseStorage implements LicenseStorage {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicKeyB64u: string,
  ) {}

  async read(): Promise<PersistedState | null> {
    const row = await this.prisma.licenseRecord.findUnique({ where: { id: 'self' } });
    if (!row) return null;

    const ok = verifyVerdict(
      this.publicKeyB64u,
      {
        licenseId: row.licenseId,
        activatedDomain: row.activatedDomain,
        fingerprint: row.fingerprint,
        status: row.status,
        signedProof: row.signedProof,
        lastVerifiedAtMs: row.lastVerifiedAt.getTime(),
        expiresAtMs: row.expiresAt?.getTime() ?? null,
        graceUntilMs: row.graceUntil?.getTime() ?? null,
      },
      row.verdictHmac,
    );
    if (!ok) {
      // Don't delete the row — leave it so support can see "the buyer
      // tried to tamper with the license". The gate calls activate()
      // again from scratch on the next request.
      return null;
    }

    return {
      licenseId: row.licenseId,
      hmacSecretB64u: row.hmacSecretEnc,
      signedProof: row.signedProof,
      lastVerifiedAtMs: row.lastVerifiedAt.getTime(),
      kid: extractKid(row.signedProof),
    };
  }

  async write(state: PersistedState): Promise<void> {
    // Pull the authoritative fields out of the proof so the row reflects
    // exactly what the server signed. This is the ONLY place we trust
    // the proof's payload — everywhere else verifies the signature first.
    const payload = decodeProofPayload(state.signedProof);

    const fields = {
      licenseId: state.licenseId,
      activatedDomain: payload.domain,
      fingerprint: payload.fingerprint,
      status: payload.status,
      signedProof: state.signedProof,
      lastVerifiedAtMs: state.lastVerifiedAtMs,
      expiresAtMs: payload.expiresAt ? payload.expiresAt * 1000 : null,
      graceUntilMs: payload.graceUntil ? payload.graceUntil * 1000 : null,
    };
    const verdictHmac = signVerdict(this.publicKeyB64u, fields);

    await this.prisma.licenseRecord.upsert({
      where: { id: 'self' },
      create: {
        id: 'self',
        licenseId: state.licenseId,
        purchaseCodeTail: 'unknown',
        activatedDomain: payload.domain,
        fingerprint: payload.fingerprint,
        hmacSecretEnc: state.hmacSecretB64u,
        status: payload.status,
        signedProof: state.signedProof,
        lastVerifiedAt: new Date(state.lastVerifiedAtMs),
        expiresAt: fields.expiresAtMs ? new Date(fields.expiresAtMs) : null,
        graceUntil: fields.graceUntilMs ? new Date(fields.graceUntilMs) : null,
        verdictHmac,
      },
      update: {
        licenseId: state.licenseId,
        activatedDomain: payload.domain,
        fingerprint: payload.fingerprint,
        hmacSecretEnc: state.hmacSecretB64u,
        status: payload.status,
        signedProof: state.signedProof,
        lastVerifiedAt: new Date(state.lastVerifiedAtMs),
        expiresAt: fields.expiresAtMs ? new Date(fields.expiresAtMs) : null,
        graceUntil: fields.graceUntilMs ? new Date(fields.graceUntilMs) : null,
        verdictHmac,
      },
    });
  }

  async clear(): Promise<void> {
    await this.prisma.licenseRecord.deleteMany({ where: { id: 'self' } });
  }

  /**
   * Update the purchaseCodeTail after activate. The license-client only
   * knows about its abstract storage contract, not our extra columns —
   * we patch the tail in directly from the gate after a successful
   * activate() call so support has something to grep.
   */
  async setPurchaseCodeTail(tail: string): Promise<void> {
    await this.prisma.licenseRecord.update({
      where: { id: 'self' },
      data: { purchaseCodeTail: tail },
    });
  }
}

interface ProofPayload {
  kid: string;
  domain: string;
  fingerprint: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  issuedAt: number;
  expiresAt: number | null;
  graceUntil: number;
}

function decodeProofPayload(token: string): ProofPayload {
  const [encoded] = token.split('.');
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json) as ProofPayload;
}

function extractKid(token: string): string {
  return decodeProofPayload(token).kid;
}

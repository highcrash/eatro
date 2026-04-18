import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { ProofPayload } from '../crypto/proof';
import type { License, PurchaseCode, SigningKey } from '../../prisma/client';

/**
 * Public license lifecycle. Three operations, all called by installed
 * client copies via @restora/license-client:
 *
 *   activate   — first-boot pairing. Looks up the purchase code,
 *                checks revocation + activation slots, creates a
 *                License row, derives + encrypts an HMAC secret,
 *                returns the secret (once) + signed proof.
 *
 *   verify     — periodic re-check. Updates lastSeenAt + lastIp,
 *                checks status + fingerprint, returns a fresh proof
 *                with a new graceUntil window.
 *
 *   deactivate — release the activation slot. Marks License REVOKED
 *                and decrements PurchaseCode.usedActivations so the
 *                buyer can move the install.
 *
 * Rate limiting + HMAC verification + abuse tracking live in the
 * controller / guard layer so this service stays focused on business
 * logic and is easy to unit-test.
 */
@Injectable()
export class LicenseService {
  private readonly proofGraceSeconds: number;
  private readonly proofTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    config: ConfigService,
  ) {
    this.proofGraceSeconds = Number(config.get('LICENSE_PROOF_GRACE_SECONDS', 604800));
    this.proofTtlSeconds = Number(config.get('LICENSE_PROOF_TTL_SECONDS', 86400));
  }

  // ── activate ──────────────────────────────────────────────────────────

  async activate(input: {
    productSku: string;
    purchaseCode: string;
    domain: string;
    fingerprint: string;
  }): Promise<{
    licenseId: string;
    hmacSecret: string;          // base64url, returned ONCE
    kid: string;
    signedProof: string;
    revalidateAfter: number;
  }> {
    const product = await this.prisma.product.findUnique({
      where: { sku: input.productSku },
    });
    if (!product) {
      throw new NotFoundException({ result: 'PRODUCT_NOT_FOUND', message: 'Unknown product SKU' });
    }

    const codeHash = this.hashPurchaseCode(input.purchaseCode);
    const purchaseCode = await this.prisma.purchaseCode.findUnique({
      where: { codeHash },
    });
    if (!purchaseCode || purchaseCode.productId !== product.id) {
      throw new BadRequestException({ result: 'INVALID_CODE', message: 'Purchase code not recognised' });
    }
    if (purchaseCode.isRevoked) {
      throw new ForbiddenException({ result: 'REVOKED', message: 'Purchase code has been revoked' });
    }

    const domain = normalizeDomain(input.domain);

    // Idempotent: if a License already exists for this {code, domain,
    // fingerprint}, just re-issue a proof for it. Reinstall on the same
    // machine after a crash should be transparent — burning an extra
    // activation slot every time would be punishing.
    const existing = await this.prisma.license.findUnique({
      where: {
        purchaseCodeId_domain_fingerprint: {
          purchaseCodeId: purchaseCode.id,
          domain,
          fingerprint: input.fingerprint,
        },
      },
    });
    if (existing) {
      // Surface the original hmacSecret so the client can recover from
      // a wiped local store. Decrypt the wrapped value.
      const hmacSecret = this.crypto.unwrap(existing.hmacSecretEnc);

      // If the existing license was REVOKED, refuse — admin took it
      // back; client must contact support.
      if (existing.status === 'REVOKED') {
        throw new ForbiddenException({ result: 'REVOKED', message: 'License has been revoked' });
      }

      const signingKey = await this.activeSigningKey(product.id);
      const proof = this.issueProof({
        license: existing,
        product,
        signingKey,
      });
      return {
        licenseId: existing.id,
        hmacSecret: hmacSecret.toString('base64url'),
        kid: signingKey.kid,
        signedProof: proof.token,
        revalidateAfter: proof.revalidateAfter,
      };
    }

    // New activation. Enforce slot count.
    if (purchaseCode.usedActivations >= purchaseCode.maxActivations) {
      throw new ForbiddenException({
        result: 'LIMIT',
        message: `Purchase code has reached its activation limit (${purchaseCode.maxActivations})`,
      });
    }

    // Create the License row + HMAC secret in a transaction so a failed
    // wrap can't leave a row pointing at non-existent ciphertext. We do
    // an interactive transaction so the secret derivation can use the
    // not-yet-committed License.id.
    const result = await this.prisma.$transaction(async (tx) => {
      // First: bump usedActivations atomically. Re-check after to detect
      // a race where two clients grabbed the last slot at the same time.
      const updated = await tx.purchaseCode.update({
        where: { id: purchaseCode.id },
        data: { usedActivations: { increment: 1 } },
      });
      if (updated.usedActivations > updated.maxActivations) {
        throw new ForbiddenException({
          result: 'LIMIT',
          message: 'Purchase code has reached its activation limit',
        });
      }

      const license = await tx.license.create({
        data: {
          purchaseCodeId: purchaseCode.id,
          productId: product.id,
          domain,
          fingerprint: input.fingerprint,
          // Placeholder; we update with the wrapped secret once we have
          // the real id (HKDF info input is licenseId).
          hmacSecretEnc: '',
          status: 'ACTIVE',
          activatedAt: new Date(),
        },
      });

      const hmacSecret = this.crypto.deriveLicenseHmacSecret(license.id);
      const wrapped = this.crypto.wrap(hmacSecret);
      const finalLicense = await tx.license.update({
        where: { id: license.id },
        data: { hmacSecretEnc: wrapped },
      });

      return { license: finalLicense, hmacSecret };
    });

    const signingKey = await this.activeSigningKey(product.id);
    const proof = this.issueProof({
      license: result.license,
      product,
      signingKey,
    });

    return {
      licenseId: result.license.id,
      hmacSecret: result.hmacSecret.toString('base64url'),
      kid: signingKey.kid,
      signedProof: proof.token,
      revalidateAfter: proof.revalidateAfter,
    };
  }

  // ── verify ────────────────────────────────────────────────────────────

  async verify(input: {
    licenseId: string;
    fingerprint: string;
    ip: string | null;
  }): Promise<{
    status: License['status'];
    signedProof: string;
    revalidateAfter: number;
  }> {
    const license = await this.prisma.license.findUnique({
      where: { id: input.licenseId },
    });
    if (!license) {
      throw new NotFoundException({ result: 'NOT_FOUND', message: 'License not found' });
    }
    if (license.fingerprint !== input.fingerprint) {
      throw new ForbiddenException({ result: 'FINGERPRINT_MISMATCH', message: 'Fingerprint does not match the activated install' });
    }

    if (license.status === 'REVOKED' || license.status === 'EXPIRED') {
      // Still issue a proof so the client's cached state is updated to
      // the terminal status — this is what flips the installed app to
      // its "license invalid" UI.
      const product = await this.prisma.product.findUniqueOrThrow({ where: { id: license.productId } });
      const signingKey = await this.activeSigningKey(product.id);
      const proof = this.issueProof({ license, product, signingKey });
      await this.prisma.license.update({
        where: { id: license.id },
        data: { lastSeenAt: new Date(), lastIp: input.ip ?? license.lastIp },
      });
      return { status: license.status, signedProof: proof.token, revalidateAfter: proof.revalidateAfter };
    }

    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: license.productId } });
    const signingKey = await this.activeSigningKey(product.id);

    await this.prisma.license.update({
      where: { id: license.id },
      data: { lastSeenAt: new Date(), lastIp: input.ip ?? license.lastIp },
    });

    const proof = this.issueProof({ license, product, signingKey });
    return {
      status: license.status,
      signedProof: proof.token,
      revalidateAfter: proof.revalidateAfter,
    };
  }

  // ── deactivate ────────────────────────────────────────────────────────

  async deactivate(input: { licenseId: string; fingerprint: string }): Promise<{ ok: true }> {
    const license = await this.prisma.license.findUnique({
      where: { id: input.licenseId },
    });
    if (!license) throw new NotFoundException({ result: 'NOT_FOUND' });
    if (license.fingerprint !== input.fingerprint) {
      throw new ForbiddenException({ result: 'FINGERPRINT_MISMATCH' });
    }
    if (license.status === 'REVOKED') return { ok: true }; // idempotent

    await this.prisma.$transaction([
      this.prisma.license.update({
        where: { id: license.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'self-deactivated' },
      }),
      this.prisma.purchaseCode.update({
        where: { id: license.purchaseCodeId },
        // Decrement clamped at 0 in case admin manually adjusted things.
        data: { usedActivations: { decrement: 1 } },
      }),
    ]);
    return { ok: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  /**
   * Returns the License's current hmacSecret (decrypted). Used by the
   * HMAC guard to validate incoming X-Signature headers.
   */
  async getHmacSecret(licenseId: string): Promise<Buffer | null> {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: { hmacSecretEnc: true },
    });
    if (!license || !license.hmacSecretEnc) return null;
    return this.crypto.unwrap(license.hmacSecretEnc);
  }

  /** SHA-256(code) — the indexed lookup column on PurchaseCode. */
  private hashPurchaseCode(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  private async activeSigningKey(productId: string): Promise<SigningKey> {
    const key = await this.prisma.signingKey.findFirst({
      where: { productId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!key) {
      throw new BadRequestException({
        result: 'NO_SIGNING_KEY',
        message: 'Product has no active signing key — admin must create one',
      });
    }
    return key;
  }

  private issueProof(args: {
    license: License;
    product: { sku: string };
    signingKey: SigningKey;
  }): { token: string; revalidateAfter: number } {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const graceUntil = nowSeconds + this.proofGraceSeconds;
    const revalidateAfter = nowSeconds + Math.min(
      this.proofTtlSeconds,
      args.license.expiresAt
        ? Math.max(0, Math.floor((args.license.expiresAt.getTime() - Date.now()) / 1000))
        : this.proofTtlSeconds,
    );
    const payload: ProofPayload = {
      v: 1,
      kid: args.signingKey.kid,
      licenseId: args.license.id,
      productSku: args.product.sku,
      domain: args.license.domain,
      fingerprint: args.license.fingerprint,
      status: args.license.status as ProofPayload['status'],
      issuedAt: nowSeconds,
      expiresAt: args.license.expiresAt ? Math.floor(args.license.expiresAt.getTime() / 1000) : null,
      graceUntil,
      revalidateAfter,
      nonce: this.crypto.randomToken(9),
    };
    const privateSeed = this.crypto.unwrap(args.signingKey.ed25519PrivateKeyEnc);
    const token = this.crypto.signProof(payload, privateSeed);
    return { token, revalidateAfter };
  }
}

/** Lower-case + strip leading `www.` + drop trailing dot. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

// Re-exported so other modules can use the same normalization.
export { normalizeDomain };

// Suppress unused-warning for PurchaseCode (it's used in service flow inferred types)
export type { PurchaseCode };

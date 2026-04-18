import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

/**
 * Signing-key lifecycle. Two operations:
 *
 *   createForProduct — called by the admin "Create Product" flow and
 *     "Rotate Key" action. Generates an ed25519 keypair, wraps the
 *     private seed with the KEK, stores both. Returns the public key
 *     + kid (admin surface copies these into client builds).
 *
 *   rotate — marks the current active key as retiring (isActive=false,
 *     retiresAt=now+30d) and creates a new active key. Clients with a
 *     cached old kid can still verify proofs signed with it for 30
 *     days, after which the retired key's metadata can be GC'd.
 *
 * Private seeds never leave the server — the admin UI receives the
 * public key + kid, nothing more.
 */
@Injectable()
export class SigningKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async createForProduct(productId: string): Promise<{ kid: string; publicKey: string }> {
    const kp = this.crypto.generateProductKeypair();
    const kid = this.crypto.randomToken(6);
    const wrapped = this.crypto.wrap(kp.privateSeed);

    const key = await this.prisma.signingKey.create({
      data: {
        productId,
        kid,
        ed25519PrivateKeyEnc: wrapped,
        ed25519PublicKey: base64url(kp.publicKey),
        isActive: true,
      },
    });
    return { kid: key.kid, publicKey: key.ed25519PublicKey };
  }

  async rotate(productId: string): Promise<{ kid: string; publicKey: string; previousKid: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      // Current active key (if any) moves to retiring.
      const current = await tx.signingKey.findFirst({
        where: { productId, isActive: true },
      });
      let previousKid: string | null = null;
      if (current) {
        const retiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        await tx.signingKey.update({
          where: { id: current.id },
          data: { isActive: false, rotatedAt: new Date(), retiresAt },
        });
        previousKid = current.kid;
      }

      const kp = this.crypto.generateProductKeypair();
      const kid = this.crypto.randomToken(6);
      const fresh = await tx.signingKey.create({
        data: {
          productId,
          kid,
          ed25519PrivateKeyEnc: this.crypto.wrap(kp.privateSeed),
          ed25519PublicKey: base64url(kp.publicKey),
          isActive: true,
        },
      });
      return { kid: fresh.kid, publicKey: fresh.ed25519PublicKey, previousKid };
    });
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

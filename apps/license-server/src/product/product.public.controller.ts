import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public product metadata. Currently exposes the active + previous-active
 * ed25519 public keys so installed clients with a stale baked-in `kid`
 * can fetch the new key after rotation.
 *
 * Cache-Control allows a short edge cache here (5 min) — public keys
 * rotate at most monthly and a cached response that's a few minutes
 * stale doesn't break anything (clients fall back to the bundled key).
 * If a CDN is in front and you absolutely want zero caching, override
 * with no-store at the proxy.
 */
@ApiTags('Products (public)')
@Controller('products')
export class ProductPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':sku/public-key')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  async getPublicKey(@Param('sku') sku: string) {
    const product = await this.prisma.product.findUnique({
      where: { sku },
      include: {
        signingKeys: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!product) throw new NotFoundException({ result: 'PRODUCT_NOT_FOUND' });

    const active = product.signingKeys.find((k) => k.isActive);
    if (!active) throw new NotFoundException({ result: 'NO_ACTIVE_KEY' });

    // The most-recent NON-active key is the "previous", served during
    // its 30-day retirement window so clients with the old kid can
    // still verify proofs they cached before the rotation.
    const previous = product.signingKeys.find((k) => !k.isActive);

    return {
      productSku: product.sku,
      kid: active.kid,
      publicKey: active.ed25519PublicKey,
      previousKid: previous?.kid ?? null,
      previousPublicKey: previous?.ed25519PublicKey ?? null,
    };
  }
}

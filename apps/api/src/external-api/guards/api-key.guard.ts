import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { isApiScope, type ApiScope } from '../dto/api-scope.const';

/// Parses Authorization: Bearer rk_<prefix>_<secret>, validates against
/// ExternalApiKey rows, and attaches req.apiClient on success. Updates
/// lastUsedAt fire-and-forget so the guard never blocks on a write.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const token = auth.slice('Bearer '.length).trim();
    // Format: rk_<8 hex>_<base64url secret>. Cannot use split('_') because
    // base64url legally contains '_' — splitting on all underscores would
    // reject ~half of valid keys. Use anchored indexOf instead.
    if (!token.startsWith('rk_')) throw new UnauthorizedException('Malformed API key');
    const afterPrefixTag = token.slice(3);
    const sep = afterPrefixTag.indexOf('_');
    if (sep <= 0) throw new UnauthorizedException('Malformed API key');
    const prefix = afterPrefixTag.slice(0, sep);
    const secret = afterPrefixTag.slice(sep + 1);
    if (!/^[0-9a-f]{8}$/.test(prefix) || secret.length === 0) {
      throw new UnauthorizedException('Malformed API key');
    }

    const key = await this.prisma.externalApiKey.findUnique({ where: { prefix } });
    if (!key) {
      // Burn a constant-ish amount of CPU even when the prefix doesn't
      // match, to keep the timing side channel quiet.
      await bcrypt.compare(secret, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
      throw new UnauthorizedException('Invalid API key');
    }

    if (key.revokedAt) throw new UnauthorizedException('API key revoked');
    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new UnauthorizedException('API key expired');
    }

    const ok = await bcrypt.compare(secret, key.keyHash);
    if (!ok) throw new UnauthorizedException('Invalid API key');

    req.apiClient = {
      keyId: key.id,
      branchId: key.branchId,
      scopes: key.scopes.filter(isApiScope) as ApiScope[],
    };

    // Fire-and-forget lastUsedAt bump. Failures here must not break the
    // request — they would manifest as a missed "last used" tick at most.
    void this.prisma.externalApiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}

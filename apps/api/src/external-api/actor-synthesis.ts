import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '@restora/types';

import { PrismaService } from '../prisma/prisma.service';

/// External API keys are issued by an OWNER and the key row carries that
/// staff member's id in `createdById`. When the external surface needs
/// to perform a write that the internal services attribute to a real
/// staff actor (audit-log entries, activity logs, campaign createdBy,
/// etc.), we load the creator and synthesize a JwtPayload-shaped object
/// so the inner service signatures stay unchanged.
///
/// Why a synthetic JwtPayload instead of a separate "external actor"
/// type: the alternative ripples through every service that takes
/// `actor: JwtPayload`, and the audit story is actually clearer if the
/// human who issued the key is the recorded actor. The key is the
/// delegated capability, not the principal.
@Injectable()
export class ActorSynthesisService {
  constructor(private readonly prisma: PrismaService) {}

  async fromApiKey(keyId: string, branchId: string): Promise<JwtPayload> {
    const key = await this.prisma.externalApiKey.findFirst({
      where: { id: keyId, branchId },
      include: { createdBy: { select: { id: true, email: true, role: true, customRoleId: true } } },
    });
    if (!key) {
      throw new UnauthorizedException('API key not found during actor synthesis');
    }
    if (!key.createdBy) {
      // Should never happen — schema enforces createdBy is non-null —
      // but the relation is a join, so we defend.
      throw new UnauthorizedException('Key has no creator staff record');
    }
    return {
      sub: key.createdBy.id,
      email: key.createdBy.email,
      role: key.createdBy.role,
      customRoleId: key.createdBy.customRoleId ?? null,
      branchId,
    };
  }
}

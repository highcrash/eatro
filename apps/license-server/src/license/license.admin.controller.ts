import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import { AdminJwtGuard } from '../admin-auth/admin-jwt.guard';

class LicensesListQuery {
  @IsOptional() @IsString() productId?: string;

  @IsOptional() @IsEnum(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED'])
  status?: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

  @IsOptional() @IsString() @MaxLength(253)
  domain?: string;

  @IsOptional() @IsInt() @Min(1) @Max(500)
  pageSize?: number;

  @IsOptional() @IsInt() @Min(1)
  page?: number;
}

class RevokeDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

/**
 * Admin read + revoke for licenses. No create endpoint — licenses are
 * only created by the public /activate flow. No "resend proof" either:
 * the next /verify from the client naturally pulls a fresh proof so
 * there's nothing to push.
 */
@ApiTags('Admin — licenses')
@ApiBearerAuth()
@Controller('admin/licenses')
@UseGuards(AdminJwtGuard)
export class LicenseAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: LicensesListQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const where: Record<string, unknown> = {};
    if (q.productId) where.productId = q.productId;
    if (q.status) where.status = q.status;
    if (q.domain) where.domain = { contains: q.domain.toLowerCase(), mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.license.findMany({
        where,
        orderBy: { activatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          product: { select: { sku: true, name: true } },
          purchaseCode: { select: { code: true } },
        },
      }),
      this.prisma.license.count({ where }),
    ]);

    return {
      items: items.map((r) => ({
        id: r.id,
        product: r.product,
        purchaseCode: r.purchaseCode.code,
        domain: r.domain,
        fingerprint: r.fingerprint,
        status: r.status,
        activatedAt: r.activatedAt,
        expiresAt: r.expiresAt,
        lastSeenAt: r.lastSeenAt,
        lastIp: r.lastIp,
        revokedAt: r.revokedAt,
        revokedReason: r.revokedReason,
      })),
      page,
      pageSize,
      total,
    };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const lic = await this.prisma.license.findUnique({
      where: { id },
      include: {
        product: { select: { sku: true, name: true } },
        purchaseCode: { select: { code: true, source: true } },
      },
    });
    if (!lic) throw new NotFoundException({ result: 'NOT_FOUND' });
    return lic;
  }

  /**
   * Revoking a license flips its status to REVOKED and decrements the
   * parent purchase code's usedActivations so the slot frees up. The
   * installed client still has a valid cached proof until its graceUntil,
   * so the next network-connected verify is where revocation actually
   * bites — then the client sees status:REVOKED in the fresh proof.
   */
  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @Body() dto: RevokeDto) {
    const lic = await this.prisma.license.findUnique({ where: { id } });
    if (!lic) throw new NotFoundException({ result: 'NOT_FOUND' });
    if (lic.status === 'REVOKED') return { ok: true };

    await this.prisma.$transaction([
      this.prisma.license.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: dto.reason ?? 'admin-revoked' },
      }),
      this.prisma.purchaseCode.update({
        where: { id: lic.purchaseCodeId },
        data: { usedActivations: { decrement: 1 } },
      }),
    ]);
    return { ok: true };
  }
}

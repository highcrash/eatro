import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import { AdminJwtGuard } from '../admin-auth/admin-jwt.guard';

class LogsQuery {
  @IsOptional() @IsString() licenseId?: string;

  @IsOptional() @IsEnum(['ACTIVATE', 'VERIFY', 'DEACTIVATE', 'BLOCKED', 'ROTATE'])
  action?: 'ACTIVATE' | 'VERIFY' | 'DEACTIVATE' | 'BLOCKED' | 'ROTATE';

  @IsOptional() @IsString() @MaxLength(64) ip?: string;

  @IsOptional() @IsInt() @Min(1) @Max(500) pageSize?: number;
  @IsOptional() @IsInt() @Min(1) page?: number;
}

@ApiTags('Admin — logs + stats')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AdminJwtGuard)
export class LogAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('logs')
  async list(@Query() q: LogsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;

    const where: Record<string, unknown> = {};
    if (q.licenseId) where.licenseId = q.licenseId;
    if (q.action) where.action = q.action;
    if (q.ip) where.ip = q.ip;

    const [items, total] = await Promise.all([
      this.prisma.checkLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.checkLog.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  /**
   * Dashboard counts. Cheap queries only — admin hits this on the
   * landing page and it has to feel snappy. No per-row stats.
   */
  @Get('stats')
  async stats() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000);
    const oneDayAgo = new Date(Date.now() - 86400 * 1000);

    const [
      products,
      purchaseCodes,
      purchaseCodesUnused,
      licensesActive,
      licensesRevoked,
      failedActivates7d,
      blockedIps24h,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.purchaseCode.count(),
      this.prisma.purchaseCode.count({ where: { isRevoked: false, usedActivations: 0 } }),
      this.prisma.license.count({ where: { status: 'ACTIVE' } }),
      this.prisma.license.count({ where: { status: 'REVOKED' } }),
      this.prisma.checkLog.count({
        where: { action: 'ACTIVATE', result: { not: 'OK' }, at: { gte: sevenDaysAgo } },
      }),
      this.prisma.checkLog.count({
        where: { action: 'BLOCKED', at: { gte: oneDayAgo } },
      }),
    ]);

    return {
      products,
      purchaseCodes,
      purchaseCodesUnused,
      licensesActive,
      licensesRevoked,
      failedActivates7d,
      blockedIps24h,
    };
  }
}

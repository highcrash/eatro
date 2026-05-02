import { Controller, Get, Delete, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from './activity-log.service';

@ApiTags('Activity Log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('activity-logs')
@Roles('OWNER', 'MANAGER')
export class ActivityLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly service: ActivityLogService,
  ) {}

  /**
   * Paginated, filterable list. Default sort: createdAt desc. Uses
   * cursor-based pagination on (createdAt, id) so a heavy table doesn't
   * pay for OFFSET. The cursor is the last-seen `id` from the previous
   * page; the response includes the nextCursor in `meta`.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('actorId') actorId?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(200, Math.max(1, Number(limitStr) || 100));
    const where: Prisma.ActivityLogWhereInput = { branchId: user.branchId };

    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) {
        const end = new Date(to);
        // `to` filter is inclusive at end-of-day so picking the same day
        // for from + to returns events from the whole day.
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = end;
      }
    }
    if (category) where.category = category as Prisma.ActivityLogWhereInput['category'];
    if (action) where.action = action as Prisma.ActivityLogWhereInput['action'];
    if (entityType) where.entityType = entityType;
    if (actorId) where.actorId = actorId;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { entityName: { contains: term, mode: 'insensitive' } },
        { summary: { contains: term, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page,
      meta: {
        nextCursor: hasMore ? page[page.length - 1]?.id : null,
        count: page.length,
      },
    };
  }

  /**
   * Full chronological history for a single entity — drives the
   * "click Orange Juice → see every change" drill-in. Capped at 500
   * rows; entity-level history that long is a strong sign the cleanup
   * cron isn't running.
   */
  @Get('entity/:entityType/:entityId')
  async entityHistory(
    @CurrentUser() user: JwtPayload,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.prisma.activityLog.findMany({
      where: { branchId: user.branchId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Per-category counts in the supplied range — feeds the admin filter
   * chips so the UI can show "MENU (42), EXPENSE (7), …" without
   * round-tripping for each.
   */
  @Get('categories')
  async categoryCounts(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where: Prisma.ActivityLogWhereInput = { branchId: user.branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = end;
      }
    }
    const grouped = await this.prisma.activityLog.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
    });
    return grouped.map((g) => ({ category: g.category, count: g._count._all }));
  }

  /**
   * Distinct actors in the supplied range — feeds the actor dropdown.
   */
  @Get('actors')
  async actorList(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where: Prisma.ActivityLogWhereInput = { branchId: user.branchId };
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = end;
      }
    }
    const rows = await this.prisma.activityLog.findMany({
      where,
      select: { actorId: true, actorName: true, actorRole: true },
      distinct: ['actorId'],
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.filter((r) => r.actorId);
  }

  /**
   * Manual purge. OWNER only — same surface as the nightly cron. The
   * `olderThanDays` knob lets the owner blow away anything from before
   * a date cutoff without dropping the whole table.
   */
  @Delete('purge')
  @Roles('OWNER')
  async purge(@Query('olderThanDays') olderThanDaysStr?: string) {
    const days = Number(olderThanDaysStr ?? 90);
    const deleted = await this.service.purgeOlderThan(days);
    return { deleted, olderThanDays: days };
  }
}

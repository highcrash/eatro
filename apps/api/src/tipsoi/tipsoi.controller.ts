import { Controller, Get, Post, Patch, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { TipsoiClient } from './tipsoi.client';
import { TipsoiSyncService } from './tipsoi.sync.service';

/**
 * Tipsoi integration admin surface. All endpoints OWNER-only — the
 * API token controls a remote attendance feed and is sensitive.
 *
 *   GET    /tipsoi/settings   — current branch config (token masked)
 *   PATCH  /tipsoi/settings   — update toggle / token / rule defaults
 *   POST   /tipsoi/test-token — smoke-test creds against /api/v1/people
 *   POST   /tipsoi/sync       — manual sync trigger (default: last 7 days)
 */
@Controller('tipsoi')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TipsoiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TipsoiClient,
    private readonly sync: TipsoiSyncService,
  ) {}

  /** Returns the branch's Tipsoi + attendance-rule config. Token is
   *  masked for OWNER too on the GET payload — if they need to copy
   *  it back out, they'd just paste a fresh one. (We never want a
   *  fully-clear token returning over the wire.) */
  @Get('settings')
  @Roles('OWNER', 'MANAGER')
  async getSettings(@CurrentUser() user: JwtPayload) {
    const settings = await this.prisma.branchSetting.upsert({
      where: { branchId: user.branchId },
      create: { branchId: user.branchId },
      update: {},
    });
    return {
      tipsoiEnabled: settings.tipsoiEnabled,
      tipsoiApiUrl: settings.tipsoiApiUrl,
      // Mask: indicate presence but never echo the secret.
      tipsoiApiTokenSet: !!settings.tipsoiApiToken,
      tipsoiLastSyncAt: settings.tipsoiLastSyncAt,
      tipsoiLastSyncStatus: settings.tipsoiLastSyncStatus,
      attendanceShiftStart: settings.attendanceShiftStart,
      attendanceShiftEnd: settings.attendanceShiftEnd,
      attendanceLateGraceMinutes: settings.attendanceLateGraceMinutes,
      attendanceHalfDayAfterMinutes: settings.attendanceHalfDayAfterMinutes,
    };
  }

  @Patch('settings')
  @Roles('OWNER')
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      tipsoiEnabled?: boolean;
      tipsoiApiToken?: string | null;
      tipsoiApiUrl?: string;
      attendanceShiftStart?: string;
      attendanceShiftEnd?: string;
      attendanceLateGraceMinutes?: number;
      attendanceHalfDayAfterMinutes?: number;
    },
  ) {
    // Empty string token = clear it. Undefined = leave alone.
    const data: Record<string, unknown> = {};
    if (dto.tipsoiEnabled !== undefined) data.tipsoiEnabled = dto.tipsoiEnabled;
    if (dto.tipsoiApiUrl !== undefined && dto.tipsoiApiUrl.trim()) data.tipsoiApiUrl = dto.tipsoiApiUrl.trim();
    if (dto.tipsoiApiToken !== undefined) {
      data.tipsoiApiToken = dto.tipsoiApiToken && dto.tipsoiApiToken.trim() ? dto.tipsoiApiToken.trim() : null;
    }
    if (dto.attendanceShiftStart !== undefined) data.attendanceShiftStart = dto.attendanceShiftStart;
    if (dto.attendanceShiftEnd !== undefined) data.attendanceShiftEnd = dto.attendanceShiftEnd;
    if (dto.attendanceLateGraceMinutes !== undefined) data.attendanceLateGraceMinutes = dto.attendanceLateGraceMinutes;
    if (dto.attendanceHalfDayAfterMinutes !== undefined) data.attendanceHalfDayAfterMinutes = dto.attendanceHalfDayAfterMinutes;

    await this.prisma.branchSetting.upsert({
      where: { branchId: user.branchId },
      create: { branchId: user.branchId, ...data },
      update: data,
    });
    return this.getSettings(user);
  }

  @Post('test-token')
  @Roles('OWNER')
  async testToken(@Body() dto: { apiUrl?: string; apiToken?: string }) {
    if (!dto.apiToken?.trim()) throw new BadRequestException('apiToken required');
    const apiUrl = (dto.apiUrl?.trim() || 'https://api-inovace360.com');
    return this.client.testToken({ apiUrl, apiToken: dto.apiToken.trim() });
  }

  /** Manual sync. Body `{ from?, to? }` accepts ISO date strings.
   *  Default: last 7 days. */
  @Post('sync')
  @Roles('OWNER')
  async runSync(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { from?: string; to?: string },
  ) {
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new BadRequestException('Invalid from/to');
    return this.sync.syncRange(user.branchId, from, to);
  }
}

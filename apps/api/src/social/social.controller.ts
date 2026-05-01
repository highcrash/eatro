import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { SocialService } from './social.service';

/**
 * Admin-only routes for the auto-Facebook-post feature.
 *
 * Settings (connect / disconnect / token) are OWNER-only. Queue
 * mutations (reschedule / post-now / cancel) allow OWNER + MANAGER.
 * Image preview is OWNER + MANAGER (so the admin queue panel can
 * render thumbnails).
 */
@Controller('social')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('settings')
  @Roles('OWNER', 'MANAGER')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.social.getSettings(user.branchId);
  }

  @Post('settings/enabled')
  @Roles('OWNER')
  setEnabled(@CurrentUser() user: JwtPayload, @Body() dto: { enabled: boolean }) {
    return this.social.setEnabled(user.branchId, dto.enabled === true);
  }

  @Post('settings/default-post-time')
  @Roles('OWNER')
  setDefaultPostTime(@CurrentUser() user: JwtPayload, @Body() dto: { time: string }) {
    return this.social.setDefaultPostTime(user.branchId, dto.time);
  }

  /** Save (or clear) the per-branch FB caption template. Pass an empty
   *  string to clear the override and revert to the system default. */
  @Post('settings/caption-template')
  @Roles('OWNER', 'MANAGER')
  setCaptionTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { template: string | null },
  ) {
    return this.social.setCaptionTemplate(user.branchId, dto.template ?? null);
  }

  @Post('connect')
  @Roles('OWNER')
  connect(@CurrentUser() user: JwtPayload, @Body() dto: { pageId: string; pageAccessToken: string }) {
    if (!dto.pageId?.trim() || !dto.pageAccessToken?.trim()) {
      throw new BadRequestException('pageId and pageAccessToken are required');
    }
    return this.social.connectPage(user.branchId, dto);
  }

  @Post('disconnect')
  @Roles('OWNER')
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.social.disconnectPage(user.branchId);
  }

  @Get('scheduled')
  @Roles('OWNER', 'MANAGER')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.social.list(user.branchId, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('scheduled/:id')
  @Roles('OWNER', 'MANAGER')
  reschedule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { scheduledAt: string },
  ) {
    if (!dto.scheduledAt) throw new BadRequestException('scheduledAt is required');
    return this.social.reschedule(user.branchId, id, new Date(dto.scheduledAt));
  }

  @Post('scheduled/:id/post-now')
  @Roles('OWNER', 'MANAGER')
  postNow(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.social.postNow(user.branchId, id);
  }

  @Delete('scheduled/:id')
  @Roles('OWNER', 'MANAGER')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.social.cancel(user.branchId, id);
  }

  /** Returns the rendered image bytes — used by the admin queue panel
   *  for thumbnails. JPEG, cached aggressively. */
  @Get('scheduled/:id/preview')
  @Roles('OWNER', 'MANAGER')
  async preview(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buf = await this.social.getImageBytes(user.branchId, id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }
}

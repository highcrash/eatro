import { Controller, Get, Patch, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * WhatsApp Cloud API admin surface — configures the per-branch
 * credentials used by `PurchasingService.sendWhatsApp` to deliver
 * Purchase Order PDFs to suppliers.
 *
 *   GET    /whatsapp/settings   — current config (token presence flag only)
 *   PATCH  /whatsapp/settings   — update toggle / creds / template
 *   POST   /whatsapp/test       — ping Meta `/{phone-id}` with the saved (or
 *                                  freshly entered) credentials
 *
 * Mirrors `tipsoi.controller.ts` for symmetry — same write-only token
 * pattern, same upsert-on-PATCH shape.
 */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsApp: WhatsAppService,
  ) {}

  @Get('settings')
  @Roles('OWNER', 'MANAGER')
  async getSettings(@CurrentUser() user: JwtPayload) {
    const settings = await this.prisma.branchSetting.upsert({
      where: { branchId: user.branchId },
      create: { branchId: user.branchId },
      update: {},
    });
    return {
      whatsappEnabled: settings.whatsappEnabled,
      whatsappPhoneNumberId: settings.whatsappPhoneNumberId ?? '',
      whatsappWabaId: settings.whatsappWabaId ?? '',
      // Token is write-only over the wire — only its presence flag is
      // returned. Matches tipsoi/sms convention.
      whatsappAccessTokenSet: !!settings.whatsappAccessToken,
      whatsappPoTemplate: settings.whatsappPoTemplate,
      whatsappPoTemplateLang: settings.whatsappPoTemplateLang,
    };
  }

  @Patch('settings')
  @Roles('OWNER')
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      whatsappEnabled?: boolean;
      whatsappPhoneNumberId?: string;
      whatsappWabaId?: string;
      whatsappAccessToken?: string | null;
      whatsappPoTemplate?: string;
      whatsappPoTemplateLang?: string;
    },
  ) {
    const data: Record<string, unknown> = {};
    if (dto.whatsappEnabled !== undefined) data.whatsappEnabled = dto.whatsappEnabled;
    if (dto.whatsappPhoneNumberId !== undefined) {
      data.whatsappPhoneNumberId = dto.whatsappPhoneNumberId.trim() || null;
    }
    if (dto.whatsappWabaId !== undefined) {
      data.whatsappWabaId = dto.whatsappWabaId.trim() || null;
    }
    if (dto.whatsappAccessToken !== undefined) {
      // Empty / null = clear the saved token. Non-empty = save it.
      // Undefined = leave the existing value alone.
      data.whatsappAccessToken = dto.whatsappAccessToken && dto.whatsappAccessToken.trim()
        ? dto.whatsappAccessToken.trim()
        : null;
    }
    if (dto.whatsappPoTemplate !== undefined && dto.whatsappPoTemplate.trim()) {
      data.whatsappPoTemplate = dto.whatsappPoTemplate.trim();
    }
    if (dto.whatsappPoTemplateLang !== undefined && dto.whatsappPoTemplateLang.trim()) {
      data.whatsappPoTemplateLang = dto.whatsappPoTemplateLang.trim();
    }

    await this.prisma.branchSetting.upsert({
      where: { branchId: user.branchId },
      create: { branchId: user.branchId, ...data },
      update: data,
    });
    return this.getSettings(user);
  }

  /**
   * Smoke-test the credentials by hitting Meta `/{phone-id}` with a
   * GET. If `accessToken` is omitted, falls back to the saved token —
   * the UI passes the in-form token when the admin is mid-edit.
   */
  @Post('test')
  @Roles('OWNER', 'MANAGER')
  async test(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { phoneNumberId?: string; accessToken?: string },
  ) {
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId: user.branchId } });
    const phoneNumberId = dto.phoneNumberId?.trim() || settings?.whatsappPhoneNumberId?.trim();
    const accessToken = dto.accessToken?.trim() || settings?.whatsappAccessToken?.trim();
    if (!phoneNumberId) throw new BadRequestException('phoneNumberId required (set it in Settings or pass in the test body).');
    if (!accessToken) throw new BadRequestException('accessToken required.');
    const res = await this.whatsApp.pingPhoneNumber({ phoneNumberId, accessToken });
    return { ok: true, displayPhoneNumber: res.displayPhoneNumber, verifiedName: res.verifiedName ?? null };
  }
}

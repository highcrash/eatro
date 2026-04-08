import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, Theme } from '@restora/types';
import { BrandingService } from './branding.service';

// ─── Public read (no auth) — used by POS/Web on boot ─────────────────────────

@Controller('public/branding')
export class BrandingPublicController {
  constructor(private readonly svc: BrandingService) {}

  @Get(':branchId')
  get(@Param('branchId') branchId: string) {
    return this.svc.getBranding(branchId);
  }
}

// ─── Authenticated read/write (admin Settings) ───────────────────────────────

@Controller('branding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BrandingController {
  constructor(private readonly svc: BrandingService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  getMine(@CurrentUser() user: JwtPayload) {
    return this.svc.getBrandingForUser(user.branchId);
  }

  @Patch()
  @Roles('OWNER')
  update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      name?: string;
      address?: string;
      phone?: string;
      email?: string | null;
      logoUrl?: string | null;
      posLogoUrl?: string | null;
      websiteTagline?: string | null;
      billHeaderText?: string | null;
      billFooterText?: string | null;
      facebookUrl?: string | null;
      instagramUrl?: string | null;
    },
  ) {
    return this.svc.updateBranding(user.branchId, dto);
  }

  @Patch('theme')
  @Roles('OWNER')
  setTheme(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { posTheme?: string; websiteTheme?: string },
  ) {
    return this.svc.updateThemeSelection(user.branchId, dto);
  }

  @Post('custom-themes')
  @Roles('OWNER')
  upsertCustomTheme(@CurrentUser() user: JwtPayload, @Body() theme: Theme) {
    return this.svc.upsertCustomTheme(user.branchId, theme);
  }

  @Delete('custom-themes/:slug')
  @Roles('OWNER')
  deleteCustomTheme(@CurrentUser() user: JwtPayload, @Param('slug') slug: string) {
    return this.svc.deleteCustomTheme(user.branchId, slug);
  }
}

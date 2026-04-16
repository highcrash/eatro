import { Injectable, NotFoundException } from '@nestjs/common';
import type { Branding, Theme } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { BUILT_IN_THEMES, parseCustomThemes } from './theme-catalogue';

/**
 * Reads/updates branch branding (name, logo, contacts, bill text)
 * and theme selection (posTheme/websiteTheme).
 */
@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate everything needed by POS, Web, Admin to render branding + theme.
   * Public — no auth, used by POS/web on boot to apply theme.
   */
  async getBranding(branchId: string): Promise<Branding> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    // Ensure a settings row exists
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) {
      settings = await this.prisma.branchSetting.create({ data: { branchId } });
    }

    const customThemes = parseCustomThemes(settings.customThemes);
    const themes: Theme[] = [...BUILT_IN_THEMES, ...customThemes];

    return {
      branchId: branch.id,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      logoUrl: branch.logoUrl,
      posLogoUrl: branch.posLogoUrl,
      websiteTagline: branch.websiteTagline,
      billHeaderText: branch.billHeaderText,
      billFooterText: branch.billFooterText,
      bin: branch.bin,
      mushakVersion: branch.mushakVersion,
      wifiPass: branch.wifiPass,
      billLogoWidthPct: (branch as unknown as { billLogoWidthPct?: number }).billLogoWidthPct ?? 80,
      taxRate: Number(branch.taxRate),
      vatEnabled: branch.vatEnabled,
      serviceChargeEnabled: branch.serviceChargeEnabled,
      serviceChargeRate: Number(branch.serviceChargeRate),
      facebookUrl: branch.facebookUrl,
      instagramUrl: branch.instagramUrl,
      posTheme: settings.posTheme,
      websiteTheme: settings.websiteTheme,
      themes,
    };
  }

  /** Returns the active branchId for the authenticated user. Convenience for /branding. */
  async getBrandingForUser(branchId: string): Promise<Branding> {
    return this.getBranding(branchId);
  }

  async updateBranding(
    branchId: string,
    dto: {
      name?: string;
      address?: string;
      phone?: string;
      email?: string | null;
      logoUrl?: string | null;
      posLogoUrl?: string | null;
      websiteTagline?: string | null;
      billHeaderText?: string | null;
      billFooterText?: string | null;
      bin?: string | null;
      mushakVersion?: string | null;
      wifiPass?: string | null;
      billLogoWidthPct?: number;
      facebookUrl?: string | null;
      instagramUrl?: string | null;
    },
  ): Promise<Branding> {
    await this.prisma.branch.update({
      where: { id: branchId },
      data: dto,
    });
    return this.getBranding(branchId);
  }

  async updateThemeSelection(
    branchId: string,
    dto: { posTheme?: string; websiteTheme?: string },
  ): Promise<Branding> {
    // Ensure settings row exists
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) settings = await this.prisma.branchSetting.create({ data: { branchId } });

    await this.prisma.branchSetting.update({
      where: { branchId },
      data: dto,
    });
    return this.getBranding(branchId);
  }

  async upsertCustomTheme(branchId: string, theme: Theme): Promise<Branding> {
    let settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) settings = await this.prisma.branchSetting.create({ data: { branchId } });

    const existing = parseCustomThemes(settings.customThemes);
    // Replace if slug exists, otherwise append
    const next = [...existing.filter((t) => t.slug !== theme.slug), { ...theme, builtIn: false }];

    await this.prisma.branchSetting.update({
      where: { branchId },
      data: { customThemes: JSON.stringify(next) },
    });
    return this.getBranding(branchId);
  }

  async deleteCustomTheme(branchId: string, slug: string): Promise<Branding> {
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) return this.getBranding(branchId);

    const existing = parseCustomThemes(settings.customThemes);
    const next = existing.filter((t) => t.slug !== slug);

    // If a deleted theme was active, fall back to sunrise
    const data: { customThemes: string; posTheme?: string; websiteTheme?: string } = {
      customThemes: JSON.stringify(next),
    };
    if (settings.posTheme === slug) data.posTheme = 'sunrise';
    if (settings.websiteTheme === slug) data.websiteTheme = 'sunrise';

    await this.prisma.branchSetting.update({ where: { branchId }, data });
    return this.getBranding(branchId);
  }
}

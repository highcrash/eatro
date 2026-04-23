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

    const b = branch as unknown as Record<string, unknown>;
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
      nbrEnabled: (b.nbrEnabled as boolean | undefined) ?? false,
      branchCode: (b.branchCode as string | null) ?? null,
      sellerLegalName: (b.sellerLegalName as string | null) ?? null,
      sellerTradingName: (b.sellerTradingName as string | null) ?? null,
      wifiPass: branch.wifiPass,
      wifiSsid: (b.wifiSsid as string | null) ?? null,
      qrGateEnabled: (b.qrGateEnabled as boolean | undefined) ?? false,
      qrAllowedIps: (b.qrAllowedIps as string | null) ?? null,
      qrGateMessage: (b.qrGateMessage as string | null) ?? null,
      billLogoWidthPct: (b.billLogoWidthPct as number | undefined) ?? 80,
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

  /**
   * Public-safe subset of branding, for the unauthenticated /public/branding
   * endpoint consumed by the customer website. Deliberately omits:
   *   - wifiPass, wifiSsid   (internal Wi-Fi creds; Wi-Fi is surfaced only
   *     via the QR gate endpoint to guests on-network)
   *   - qrGateEnabled, qrAllowedIps, qrGateMessage  (reveals network setup)
   *   - billHeaderText, billFooterText  (internal bill strings)
   *   - bin, mushakVersion  (tax identifiers, not for public consumption)
   *   - billLogoWidthPct  (printer-only setting)
   *   - serviceChargeRate  (internal pricing policy)
   *
   * The website needs just enough to render: name/contact, logo, tagline,
   * social URLs, and the theme catalogue.
   */
  async getPublicBranding(branchId: string): Promise<Partial<Branding>> {
    const full = await this.getBranding(branchId);
    return {
      branchId: full.branchId,
      name: full.name,
      address: full.address,
      phone: full.phone,
      email: full.email,
      logoUrl: full.logoUrl,
      posLogoUrl: full.posLogoUrl,
      websiteTagline: full.websiteTagline,
      facebookUrl: full.facebookUrl,
      instagramUrl: full.instagramUrl,
      posTheme: full.posTheme,
      websiteTheme: full.websiteTheme,
      themes: full.themes,
      // VAT inclusion flag is fine to expose — menu prices can be displayed
      // with or without VAT, and the website needs to know which.
      vatEnabled: full.vatEnabled,
      taxRate: full.taxRate,
    };
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
      wifiSsid?: string | null;
      qrGateEnabled?: boolean;
      qrAllowedIps?: string | null;
      qrGateMessage?: string | null;
      billLogoWidthPct?: number;
      facebookUrl?: string | null;
      instagramUrl?: string | null;
    },
  ): Promise<Branding> {
    // Split the write: Prisma for fields that exist in the generated
    // client, raw SQL for fields that may not yet (qr gate + wifi SSID,
    // added in migration 20260417100000). This means the endpoint keeps
    // working even if `prisma generate` hasn't been run locally after
    // pulling the migration — otherwise a stale client throws "Unknown
    // argument qrGateEnabled" and the admin's toggle silently fails.
    const { qrGateEnabled, qrAllowedIps, wifiSsid, qrGateMessage, ...rest } = dto;

    if (Object.keys(rest).length > 0) {
      await this.prisma.branch.update({
        where: { id: branchId },
        data: rest as any,
      });
    }

    // Raw SQL for the newly added columns — Postgres validates the columns
    // exist, so this surfaces missing-migration errors instead of silent
    // field drops.
    if (qrGateEnabled !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "branches" SET "qrGateEnabled" = ${qrGateEnabled}
        WHERE "id" = ${branchId}
      `;
    }
    if (qrAllowedIps !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "branches" SET "qrAllowedIps" = ${qrAllowedIps}
        WHERE "id" = ${branchId}
      `;
    }
    if (wifiSsid !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "branches" SET "wifiSsid" = ${wifiSsid}
        WHERE "id" = ${branchId}
      `;
    }
    if (qrGateMessage !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "branches" SET "qrGateMessage" = ${qrGateMessage}
        WHERE "id" = ${branchId}
      `;
    }

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

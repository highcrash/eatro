import { Injectable, NotFoundException } from '@nestjs/common';

import { ExpenseService } from '../expense/expense.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { MarketingService } from '../marketing/marketing.service';
import { MenuService } from '../menu/menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';

/// Facade over existing Restora services for the external API surface.
/// Never reimplements aggregation logic — only shapes the response into
/// the public { data, meta } envelope. Hold all I/O here; controllers
/// stay thin.
@Injectable()
export class ExternalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly menu: MenuService,
    private readonly marketing: MarketingService,
    private readonly loyalty: LoyaltyService,
    private readonly expenses: ExpenseService,
  ) {}

  getMenu(branchId: string) {
    return this.menu.findAll(branchId);
  }

  segmentCustomers(branchId: string, filter: {
    minSpent?: number;
    minVisits?: number;
    maxLastVisitDays?: number;
    minLoyaltyPoints?: number;
  }) {
    return this.marketing.segmentCustomers(branchId, filter);
  }

  async getCustomersOverview(branchId: string) {
    const [total, active30, active90, withPhone, totals] = await Promise.all([
      this.prisma.customer.count({ where: { branchId, isActive: true } }),
      this.prisma.customer.count({
        where: {
          branchId,
          isActive: true,
          lastVisit: { gte: new Date(Date.now() - 30 * 86_400_000) },
        },
      }),
      this.prisma.customer.count({
        where: {
          branchId,
          isActive: true,
          lastVisit: { gte: new Date(Date.now() - 90 * 86_400_000) },
        },
      }),
      this.prisma.customer.count({
        where: { branchId, isActive: true, phone: { not: '' } },
      }),
      this.prisma.customer.aggregate({
        where: { branchId, isActive: true },
        _sum: { totalSpent: true, totalOrders: true },
        _avg: { totalSpent: true, totalOrders: true },
      }),
    ]);
    return {
      total,
      activeLast30Days: active30,
      activeLast90Days: active90,
      withPhone,
      lifetimeSpend: Number(totals._sum.totalSpent ?? 0),
      lifetimeOrders: totals._sum.totalOrders ?? 0,
      avgSpendPerCustomer: Number(totals._avg.totalSpent ?? 0),
      avgOrdersPerCustomer: Number(totals._avg.totalOrders ?? 0),
    };
  }

  async getLoyaltySummary(branchId: string) {
    const [holders, balanceAgg, expiringSoon, settings] = await Promise.all([
      this.prisma.customer.count({
        where: { branchId, isActive: true, loyaltyPoints: { gt: 0 } },
      }),
      this.prisma.customer.aggregate({
        where: { branchId, isActive: true, loyaltyPoints: { gt: 0 } },
        _sum: { loyaltyPoints: true },
        _avg: { loyaltyPoints: true },
      }),
      this.prisma.customer.count({
        where: {
          branchId,
          isActive: true,
          loyaltyPoints: { gt: 0 },
          loyaltyExpiresAt: { lt: new Date(Date.now() + 30 * 86_400_000) },
        },
      }),
      this.loyalty.getSettings(branchId),
    ]);
    return {
      holders,
      totalPointsOutstanding: balanceAgg._sum.loyaltyPoints ?? 0,
      avgPointsPerHolder: Number(balanceAgg._avg.loyaltyPoints ?? 0),
      pointsExpiringNext30Days: expiringSoon,
      settings,
    };
  }

  listCampaigns(branchId: string) {
    return this.marketing.listCampaigns(branchId);
  }

  listExpenses(branchId: string, from?: string, to?: string, category?: string) {
    return this.expenses.findAll(branchId, { from, to, category });
  }

  async getReviewSummary(branchId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { branchId, isHidden: false },
      select: {
        foodScore: true,
        serviceScore: true,
        atmosphereScore: true,
        priceScore: true,
        createdAt: true,
      },
    });
    if (reviews.length === 0) {
      return {
        count: 0,
        averages: { food: 0, service: 0, atmosphere: 0, price: 0, overall: 0 },
        lastReviewAt: null,
      };
    }
    const sum = reviews.reduce(
      (acc, r) => ({
        food: acc.food + r.foodScore,
        service: acc.service + r.serviceScore,
        atmosphere: acc.atmosphere + r.atmosphereScore,
        price: acc.price + r.priceScore,
      }),
      { food: 0, service: 0, atmosphere: 0, price: 0 },
    );
    const n = reviews.length;
    const averages = {
      food: sum.food / n,
      service: sum.service / n,
      atmosphere: sum.atmosphere / n,
      price: sum.price / n,
      overall:
        (sum.food + sum.service + sum.atmosphere + sum.price) / (n * 4),
    };
    const lastReviewAt = reviews
      .map((r) => r.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0]
      .toISOString();
    return { count: n, averages, lastReviewAt };
  }

  getDailySales(branchId: string, days: number) {
    return this.reports.getDailySales(branchId, days);
  }

  getSalesSummary(branchId: string, period: string) {
    return this.reports.getSalesSummary(branchId, period);
  }

  getSalesDetail(branchId: string, from?: string, to?: string) {
    return this.reports.getSalesDetail(branchId, from, to);
  }

  getTopItems(branchId: string, period: string, limit: number) {
    return this.reports.getTopItems(branchId, period, limit);
  }

  getRevenueByCategory(branchId: string, period: string) {
    return this.reports.getRevenueByCategory(branchId, period);
  }

  getPerformance(branchId: string, from?: string, to?: string) {
    return this.reports.getPerformanceReport(branchId, from, to);
  }

  getStock(branchId: string) {
    return this.reports.getStockReport(branchId);
  }

  async getBusinessProfile(branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        currency: true,
        timezone: true,
        taxRate: true,
        vatEnabled: true,
        serviceChargeEnabled: true,
        serviceChargeRate: true,
        logoUrl: true,
        websiteTagline: true,
        bin: true,
        nbrEnabled: true,
        sellerLegalName: true,
        sellerTradingName: true,
        facebookUrl: true,
        instagramUrl: true,
        createdAt: true,
      },
    });
    if (!branch) throw new NotFoundException('Business not found');

    return {
      id: branch.id,
      name: branch.name,
      legalName: branch.sellerLegalName ?? branch.name,
      tradingName: branch.sellerTradingName ?? branch.name,
      contact: {
        address: branch.address,
        phone: branch.phone,
        email: branch.email ?? null,
      },
      branding: {
        logoUrl: branch.logoUrl ?? null,
        tagline: branch.websiteTagline ?? null,
      },
      social: {
        facebookUrl: branch.facebookUrl ?? null,
        instagramUrl: branch.instagramUrl ?? null,
      },
      tax: {
        currency: branch.currency,
        rate: Number(branch.taxRate),
        vatEnabled: branch.vatEnabled,
        serviceChargeEnabled: branch.serviceChargeEnabled,
        serviceChargeRate: Number(branch.serviceChargeRate),
        bin: branch.bin ?? null,
        nbrEnabled: branch.nbrEnabled,
      },
      timezone: branch.timezone,
      currency: branch.currency,
      createdAt: branch.createdAt.toISOString(),
    };
  }

  /// Resolve currency + timezone for the envelope meta. Cheap; one-row
  /// lookup. Cached implicitly by Prisma's per-request connection.
  async getBranchMetaContext(branchId: string): Promise<{ currency: string; timezone: string }> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { currency: true, timezone: true },
    });
    return {
      currency: branch?.currency ?? 'BDT',
      timezone: branch?.timezone ?? 'Asia/Dhaka',
    };
  }
}

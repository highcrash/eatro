import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma, DiscountType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SmsService } from '../sms/sms.service';
import type { JwtPayload } from '@restora/types';

interface SegmentFilter {
  minSpent?: number;
  minVisits?: number;
  maxLastVisitDays?: number;
  minLoyaltyPoints?: number;
}

interface CreateCampaignDto extends SegmentFilter {
  name: string;
  couponType: DiscountType;
  couponValue: number;
  validityDays: number;
  smsTemplate: string;
}

interface BlastDto extends SegmentFilter {
  smsTemplate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly sms: SmsService,
  ) {}

  /**
   * Resolve the segmentation filter into a customer list. Used by
   * both the campaign-preview UI and the loyalty-blast endpoint —
   * one source of truth for "who matches these criteria right now".
   * Filters compose with AND. Customers without a phone are dropped
   * (no SMS target = no point in including them in a blast).
   */
  async segmentCustomers(branchId: string, filter: SegmentFilter) {
    const where: Prisma.CustomerWhereInput = {
      branchId,
      isActive: true,
      phone: { not: '' },
    };
    if (filter.minSpent != null && filter.minSpent > 0) {
      where.totalSpent = { gte: filter.minSpent };
    }
    if (filter.minVisits != null && filter.minVisits > 0) {
      where.totalOrders = { gte: filter.minVisits };
    }
    if (filter.maxLastVisitDays != null && filter.maxLastVisitDays > 0) {
      where.lastVisit = { gte: new Date(Date.now() - filter.maxLastVisitDays * DAY_MS) };
    }
    if (filter.minLoyaltyPoints != null && filter.minLoyaltyPoints > 0) {
      where.loyaltyPoints = { gte: filter.minLoyaltyPoints };
    }
    return this.prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, phone: true,
        totalSpent: true, totalOrders: true, lastVisit: true,
        loyaltyPoints: true,
      },
      orderBy: { totalSpent: 'desc' },
      take: 1000,
    });
  }

  /**
   * STEP 1 of the campaign two-step flow. Resolves the filter,
   * generates a unique single-use Coupon per recipient, creates the
   * CouponCampaign in DRAFT status. NO SMS sent.
   */
  async createCampaign(branchId: string, actor: JwtPayload, dto: CreateCampaignDto) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Campaign name is required');
    }
    if (!dto.smsTemplate || dto.smsTemplate.trim().length === 0) {
      throw new BadRequestException('SMS template is required');
    }
    if (!Number.isFinite(dto.couponValue) || dto.couponValue <= 0) {
      throw new BadRequestException('Coupon value must be > 0');
    }
    if (!Number.isInteger(dto.validityDays) || dto.validityDays < 1) {
      throw new BadRequestException('validityDays must be ≥ 1');
    }

    const recipients = await this.segmentCustomers(branchId, dto);
    if (recipients.length === 0) {
      throw new BadRequestException('No customers match this filter');
    }

    const expiresAt = new Date(Date.now() + dto.validityDays * DAY_MS);

    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.couponCampaign.create({
        data: {
          branchId,
          name: dto.name.trim(),
          status: 'DRAFT',
          filterSummary: this.summariseFilter(dto),
          couponType: dto.couponType,
          couponValue: dto.couponValue,
          validityDays: dto.validityDays,
          smsTemplate: dto.smsTemplate,
          recipientCount: recipients.length,
          createdById: actor.sub,
        },
      });

      // One unique code per recipient. We use 8 random hex chars
      // uppercased for readability. Collision retry walks up the
      // tail until insert succeeds (collisions are vanishingly rare
      // at 16^8 ≈ 4B possible codes per branch).
      for (const customer of recipients) {
        await this.createUniqueCouponForCustomer(tx, {
          branchId,
          customerId: customer.id,
          campaignTag: campaign.id,
          name: campaign.name,
          type: dto.couponType,
          value: dto.couponValue,
          expiresAt,
          customerNameForCode: customer.name,
        });
      }

      void this.activityLog.log({
        branchId,
        actor,
        category: 'CUSTOMER',
        action: 'CREATE',
        entityType: 'coupon-campaign',
        entityId: campaign.id,
        entityName: campaign.name,
        summary: `Generated ${recipients.length} unique codes`,
        after: {
          recipientCount: recipients.length,
          couponType: dto.couponType,
          couponValue: dto.couponValue,
          validityDays: dto.validityDays,
        },
      });

      return campaign;
    });
  }

  /**
   * STEP 2 — bulk-dispatch the SMS for a DRAFT campaign. Iterates
   * the campaign's coupons, renders the template per recipient,
   * sends through SmsService, tracks success/failure counts, marks
   * the campaign SENT at the end.
   */
  async sendCampaign(branchId: string, actor: JwtPayload, id: string) {
    const campaign = await this.prisma.couponCampaign.findFirst({
      where: { id, branchId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(`Campaign is already ${campaign.status} — cannot resend`);
    }

    const coupons = await this.prisma.coupon.findMany({
      where: { branchId, campaignTag: id },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    });

    await this.prisma.couponCampaign.update({
      where: { id },
      data: { status: 'SENDING' },
    });

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });

    let sent = 0;
    let failed = 0;
    for (const coupon of coupons) {
      const phone = coupon.customer?.phone;
      if (!phone) {
        failed += 1;
        continue;
      }
      const expiresAtFormatted = coupon.expiresAt
        ? coupon.expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'no expiry';
      const valueFormatted = coupon.type === 'PERCENTAGE'
        ? `${coupon.value.toNumber()}%`
        : `৳${coupon.value.toNumber()}`;
      const body = this.sms.renderTemplate(campaign.smsTemplate, {
        name: coupon.customer?.name,
        phone,
        brand: branch?.name,
        couponCode: coupon.code,
        couponValue: valueFormatted,
        couponExpires: expiresAtFormatted,
      });
      const result = await this.sms.sendAndLog(branchId, phone, body, {
        kind: 'CAMPAIGN',
        customerId: coupon.customerId,
        campaignId: id,
      });
      if (result.ok) sent += 1;
      else failed += 1;
    }

    const updated = await this.prisma.couponCampaign.update({
      where: { id },
      data: {
        status: 'SENT',
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date(),
      },
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'CUSTOMER',
      action: 'UPDATE',
      entityType: 'coupon-campaign',
      entityId: id,
      entityName: campaign.name,
      summary: `Dispatched: ${sent} sent, ${failed} failed`,
      after: { status: 'SENT', sentCount: sent, failedCount: failed },
    });

    return updated;
  }

  /**
   * One-shot loyalty SMS blast — segments + sends in a single call.
   * Used for the "X customers above N points, push them an offer"
   * use case. NOT a campaign; doesn't generate coupon codes.
   */
  async loyaltyBlast(branchId: string, actor: JwtPayload, dto: BlastDto) {
    if (!dto.smsTemplate || dto.smsTemplate.trim().length === 0) {
      throw new BadRequestException('SMS template is required');
    }
    const recipients = await this.segmentCustomers(branchId, dto);
    if (recipients.length === 0) {
      throw new BadRequestException('No customers match this filter');
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });

    let sent = 0;
    let failed = 0;
    for (const c of recipients) {
      if (!c.phone) {
        failed += 1;
        continue;
      }
      const body = this.sms.renderTemplate(dto.smsTemplate, {
        name: c.name,
        phone: c.phone,
        brand: branch?.name,
        pointsBalance: c.loyaltyPoints,
      });
      const result = await this.sms.sendAndLog(branchId, c.phone, body, {
        kind: 'CAMPAIGN',
        customerId: c.id,
      });
      if (result.ok) sent += 1;
      else failed += 1;
    }

    void this.activityLog.log({
      branchId,
      actor,
      category: 'CUSTOMER',
      action: 'CREATE',
      entityType: 'loyalty-blast',
      entityId: `blast-${Date.now()}`,
      entityName: 'Loyalty milestone SMS',
      summary: `Sent to ${sent} (${failed} failed) of ${recipients.length} matched`,
      after: { filter: dto, sent, failed, total: recipients.length },
    });

    return { recipientCount: recipients.length, sent, failed };
  }

  async listCampaigns(branchId: string) {
    return this.prisma.couponCampaign.findMany({
      where: { branchId },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getCampaign(branchId: string, id: string) {
    const campaign = await this.prisma.couponCampaign.findFirst({
      where: { id, branchId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const coupons = await this.prisma.coupon.findMany({
      where: { branchId, campaignTag: id },
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { ...campaign, coupons };
  }

  /**
   * Deletes a DRAFT campaign + its un-sent coupons. SENT campaigns
   * stay forever (audit + customers may still hold un-redeemed
   * codes). Archive-only via a future flag if needed.
   */
  async removeCampaign(branchId: string, actor: JwtPayload, id: string) {
    const campaign = await this.prisma.couponCampaign.findFirst({
      where: { id, branchId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot delete a ${campaign.status} campaign`);
    }
    await this.prisma.$transaction([
      this.prisma.coupon.deleteMany({ where: { branchId, campaignTag: id } }),
      this.prisma.couponCampaign.delete({ where: { id } }),
    ]);
    void this.activityLog.log({
      branchId,
      actor,
      category: 'CUSTOMER',
      action: 'DELETE',
      entityType: 'coupon-campaign',
      entityId: id,
      entityName: campaign.name,
      before: { id, name: campaign.name, status: 'DRAFT' },
    });
    return { ok: true };
  }

  /**
   * Generate one unique coupon row, retrying on collisions. Used by
   * createCampaign + (separately) the first-visit welcome path
   * called from OrderService.
   */
  async createUniqueCouponForCustomer(
    tx: Prisma.TransactionClient,
    input: {
      branchId: string;
      customerId: string;
      campaignTag: string; // CouponCampaign.id OR "first-visit"
      name: string;
      type: DiscountType;
      value: number;
      expiresAt: Date;
      customerNameForCode?: string;
    },
  ): Promise<{ id: string; code: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCouponCode(input.customerNameForCode);
      try {
        const created = await tx.coupon.create({
          data: {
            branchId: input.branchId,
            customerId: input.customerId,
            campaignTag: input.campaignTag,
            code,
            name: input.name,
            type: input.type,
            value: input.value,
            scope: 'ALL_ITEMS',
            maxUses: 1,
            expiresAt: input.expiresAt,
            isActive: true,
          },
        });
        return { id: created.id, code: created.code };
      } catch (err) {
        // Unique constraint on (branchId, code). Only retry on that
        // specific case; everything else escalates.
        if (!/unique/i.test((err as Error).message)) throw err;
      }
    }
    throw new Error('Could not generate a unique coupon code after 5 attempts');
  }

  private summariseFilter(filter: SegmentFilter): string {
    const parts: string[] = [];
    if (filter.minSpent) parts.push(`spent ≥ ৳${filter.minSpent}`);
    if (filter.minVisits) parts.push(`visits ≥ ${filter.minVisits}`);
    if (filter.maxLastVisitDays) parts.push(`visited last ${filter.maxLastVisitDays}d`);
    if (filter.minLoyaltyPoints) parts.push(`points ≥ ${filter.minLoyaltyPoints}`);
    return parts.length > 0 ? parts.join(', ') : 'all customers';
  }
}

/**
 * 8-char uppercase coupon code. Optionally prefixed with the first
 * 3 letters of the customer's name for human readability — admins
 * scanning the campaign preview can see "AHM-XXXXXXXX" and know
 * which customer's code it is at a glance. Falls back to plain
 * random when the name is empty / non-alphabetic.
 */
function generateCouponCode(customerName?: string): string {
  const random = randomBytes(4).toString('hex').toUpperCase();
  if (!customerName) return random;
  const cleaned = customerName.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (cleaned.length === 0) return random;
  return `${cleaned.slice(0, 3)}-${random}`;
}

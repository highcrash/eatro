import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload } from '@restora/types';

/**
 * Loyalty points engine.
 *
 *   - `awardForOrder(orderId)` is the hook called by OrderService right
 *     after a payment commits. Credits points based on the branch's
 *     `loyaltyTakaPerPoint` rate, resets the customer's rolling expiry,
 *     writes an EARNED ledger row. Idempotent: a duplicate call for
 *     the same orderId is a no-op (checks the ledger first).
 *   - `redeemForOrder(orderId, customerId, points)` is invoked by the
 *     QR apply-loyalty endpoint. Validates against the customer's
 *     balance + the order's outstanding total, decrements points,
 *     bumps the order's discountAmount + recomputes totals.
 *   - `runExpirySweep()` is the daily cron handler. Walks customers
 *     whose `loyaltyExpiresAt` has passed and zeros their balance with
 *     an EXPIRED ledger row.
 *   - `adjust(...)` is the admin manual-nudge endpoint.
 *
 * The Customer.loyaltyPoints column is materialised so reads stay
 * cheap; the LoyaltyTransaction ledger is the immutable source of
 * truth and can rebuild the balance via `SUM(points)` if anyone ever
 * suspects drift.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Returns the per-branch loyalty config. Hot path — invoked on every
   * paid order, every QR redemption, every payment SMS render.
   */
  private async config(branchId: string) {
    const s = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    return {
      enabled: s?.loyaltyEnabled ?? false,
      takaPerPoint: Math.max(1, s?.loyaltyTakaPerPoint ?? 100),
      takaPerPointRedeem: Math.max(1, s?.loyaltyTakaPerPointRedeem ?? 1),
      validityDays: Math.max(0, s?.loyaltyValidityDays ?? 180),
    };
  }

  /**
   * Credit points for a paid order. Caller passes the orderId; this
   * method re-reads the order to compute the amount and validate that
   * a real customer is attached. Wrapped in a transaction so the
   * ledger row + balance bump + expiry reset commit atomically.
   *
   * Returns `{ pointsEarned, newBalance, newExpiresAt }` so the
   * payment-SMS renderer can substitute them into the template
   * without a second query.
   */
  async awardForOrder(orderId: string): Promise<{
    pointsEarned: number;
    newBalance: number;
    newExpiresAt: Date | null;
  } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, branchId: true, customerId: true, totalAmount: true,
      },
    });
    if (!order || !order.customerId) return null;

    const cfg = await this.config(order.branchId);
    if (!cfg.enabled) return null;

    // Idempotency: already awarded for this order? Bail.
    const existing = await this.prisma.loyaltyTransaction.findFirst({
      where: { orderId, type: 'EARNED' },
      select: { id: true },
    });
    if (existing) return null;

    // totalAmount is stored in PAISA project-wide (see
    // packages/utils/src/currency.ts). Convert to taka for the
    // points calculation since takaPerPoint is configured in taka.
    const totalTaka = order.totalAmount.toNumber() / 100;
    const points = Math.floor(totalTaka / cfg.takaPerPoint);
    if (points <= 0) {
      // Even when the order didn't earn enough taka for a single point,
      // bump the customer's expiry so an active visitor's existing
      // balance doesn't lapse.
      const expiresAt = cfg.validityDays > 0
        ? new Date(Date.now() + cfg.validityDays * DAY_MS)
        : null;
      const customer = await this.prisma.customer.update({
        where: { id: order.customerId },
        data: { loyaltyExpiresAt: expiresAt },
        select: { loyaltyPoints: true, loyaltyExpiresAt: true },
      });
      return {
        pointsEarned: 0,
        newBalance: customer.loyaltyPoints,
        newExpiresAt: customer.loyaltyExpiresAt,
      };
    }

    const expiresAt = cfg.validityDays > 0
      ? new Date(Date.now() + cfg.validityDays * DAY_MS)
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.create({
        data: {
          branchId: order.branchId,
          customerId: order.customerId!,
          orderId: order.id,
          points,
          type: 'EARNED',
          description: `${points} pt @ ৳${cfg.takaPerPoint}/pt on order total ৳${totalTaka.toFixed(2)}`,
        },
      });
      return tx.customer.update({
        where: { id: order.customerId! },
        data: {
          loyaltyPoints: { increment: points },
          loyaltyExpiresAt: expiresAt,
        },
        select: { loyaltyPoints: true, loyaltyExpiresAt: true },
      });
    });

    return {
      pointsEarned: points,
      newBalance: result.loyaltyPoints,
      newExpiresAt: result.loyaltyExpiresAt,
    };
  }

  /**
   * Apply N points to reduce the bill on a QR order. Returns the
   * updated order so the caller can re-fetch totals. Throws on any
   * validation failure (insufficient balance, points > order capacity,
   * order already paid, etc.).
   */
  async redeemForOrder(branchId: string, orderId: string, customerId: string, points: number) {
    if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
      throw new BadRequestException('points must be a positive integer');
    }
    const cfg = await this.config(branchId);
    if (!cfg.enabled) {
      throw new BadRequestException('Loyalty programme is disabled for this branch');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId, deletedAt: null },
      select: {
        id: true, branchId: true, customerId: true, status: true,
        subtotal: true, discountAmount: true, taxAmount: true,
        serviceChargeAmount: true, roundAdjustment: true, totalAmount: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'PAID' || order.status === 'VOID' || order.status === 'REFUNDED') {
      throw new BadRequestException(`Cannot redeem points on a ${order.status} order`);
    }
    if (order.customerId !== customerId) {
      throw new BadRequestException('Order is not attached to this customer');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, branchId, isActive: true },
      select: { id: true, loyaltyPoints: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.loyaltyPoints < points) {
      throw new BadRequestException(
        `Insufficient balance — customer has ${customer.loyaltyPoints} points, requested ${points}`,
      );
    }

    // Order amounts are in PAISA (smallest unit, see
    // packages/utils/src/currency.ts). Convert to taka for the
    // user-facing math, then back to paisa for the database write.
    const orderTotalTaka = order.totalAmount.toNumber() / 100;
    const maxPoints = Math.floor(orderTotalTaka / cfg.takaPerPointRedeem);
    if (points > maxPoints) {
      throw new BadRequestException(
        `Cannot redeem more than ${maxPoints} points on this order (capped at total ÷ ৳${cfg.takaPerPointRedeem})`,
      );
    }

    const discountTaka = points * cfg.takaPerPointRedeem;
    const discountPaisa = discountTaka * 100;
    const newDiscountPaisa = order.discountAmount.toNumber() + discountPaisa;
    const newTotalPaisa = Math.max(0, order.totalAmount.toNumber() - discountPaisa);

    return this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.create({
        data: {
          branchId,
          customerId,
          orderId: order.id,
          points: -points,
          type: 'REDEEMED',
          description: `Redeemed ${points} pt = ৳${discountTaka} off order`,
        },
      });
      await tx.customer.update({
        where: { id: customerId },
        data: { loyaltyPoints: { decrement: points } },
      });
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          discountAmount: newDiscountPaisa,
          totalAmount: newTotalPaisa,
        },
        include: { items: true, payments: true, customer: { select: { id: true, name: true, phone: true } } },
      });
      return {
        order: updated,
        pointsRedeemed: points,
        discountAmount: discountTaka,
      };
    });
  }

  /**
   * Daily cron handler. Zeros every customer balance whose expiry has
   * passed, writing an EXPIRED ledger row equal to the negation of the
   * old balance. Idempotent — a same-day re-run finds nothing.
   */
  async runExpirySweep(now = new Date()): Promise<{ expired: number }> {
    const targets = await this.prisma.customer.findMany({
      where: {
        loyaltyPoints: { gt: 0 },
        loyaltyExpiresAt: { lt: now },
        isActive: true,
      },
      select: { id: true, branchId: true, loyaltyPoints: true },
    });
    if (targets.length === 0) return { expired: 0 };

    let expired = 0;
    for (const c of targets) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.loyaltyTransaction.create({
            data: {
              branchId: c.branchId,
              customerId: c.id,
              points: -c.loyaltyPoints,
              type: 'EXPIRED',
              description: `Auto-expired ${c.loyaltyPoints} pt on rolling-validity sweep`,
            },
          });
          await tx.customer.update({
            where: { id: c.id },
            data: { loyaltyPoints: 0, loyaltyExpiresAt: null },
          });
        });
        expired += 1;
      } catch (err) {
        this.logger.warn(`Loyalty expiry failed for customer ${c.id}: ${(err as Error).message}`);
      }
    }
    return { expired };
  }

  /**
   * Admin manual nudge. Positive `points` credits, negative debits.
   * Reason is mandatory so the audit row + ledger description carry
   * context.
   */
  async adjust(
    branchId: string,
    actor: JwtPayload,
    dto: { customerId: string; points: number; reason: string },
  ) {
    if (!dto.customerId || !Number.isFinite(dto.points) || dto.points === 0) {
      throw new BadRequestException('customerId + non-zero points required');
    }
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason is required for manual adjustment');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, branchId, isActive: true },
      select: { id: true, name: true, loyaltyPoints: true },
    });
    if (!customer) throw new NotFoundException('Customer not found in this branch');

    const beforeBalance = customer.loyaltyPoints;
    const cfg = await this.config(branchId);
    const expiresAt = cfg.validityDays > 0
      ? new Date(Date.now() + cfg.validityDays * DAY_MS)
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.create({
        data: {
          branchId,
          customerId: dto.customerId,
          points: dto.points,
          type: 'ADJUSTMENT',
          description: dto.reason.trim(),
        },
      });
      return tx.customer.update({
        where: { id: dto.customerId },
        data: {
          loyaltyPoints: { increment: dto.points },
          // Only refresh expiry on a credit; debits keep the existing
          // expiry so the customer doesn't get a free extension on a
          // negative adjustment.
          ...(dto.points > 0 && expiresAt ? { loyaltyExpiresAt: expiresAt } : {}),
        },
        select: { loyaltyPoints: true, loyaltyExpiresAt: true },
      });
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'CUSTOMER',
      action: 'UPDATE',
      entityType: 'loyalty-balance',
      entityId: dto.customerId,
      entityName: customer.name,
      summary: `${dto.points > 0 ? '+' : ''}${dto.points} pt · ${dto.reason}`,
      before: { balance: beforeBalance },
      after: { balance: result.loyaltyPoints, reason: dto.reason },
    });

    return {
      customerId: dto.customerId,
      balance: result.loyaltyPoints,
      expiresAt: result.loyaltyExpiresAt,
    };
  }

  async listCustomers(branchId: string, opts: { minBalance?: number; expiringBefore?: string } = {}) {
    const where: Prisma.CustomerWhereInput = {
      branchId,
      isActive: true,
      loyaltyPoints: { gt: opts.minBalance ?? 0 },
    };
    if (opts.expiringBefore) {
      where.loyaltyExpiresAt = { lt: new Date(opts.expiringBefore) };
    }
    return this.prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, phone: true,
        loyaltyPoints: true, loyaltyExpiresAt: true,
        totalSpent: true, totalOrders: true, lastVisit: true,
      },
      orderBy: { loyaltyPoints: 'desc' },
      take: 500,
    });
  }

  /**
   * Read the per-branch loyalty + first-visit-coupon settings for
   * the admin Marketing tab. Auto-creates the row on first read so
   * the admin sees the documented defaults instead of a 404.
   */
  async getSettings(branchId: string) {
    let s = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!s) {
      s = await this.prisma.branchSetting.create({ data: { branchId } });
    }
    return {
      loyaltyEnabled: s.loyaltyEnabled,
      loyaltyTakaPerPoint: s.loyaltyTakaPerPoint,
      loyaltyTakaPerPointRedeem: s.loyaltyTakaPerPointRedeem,
      loyaltyValidityDays: s.loyaltyValidityDays,
      firstVisitCouponEnabled: s.firstVisitCouponEnabled,
      firstVisitCouponType: s.firstVisitCouponType,
      firstVisitCouponValue: s.firstVisitCouponValue.toNumber(),
      firstVisitCouponValidityDays: s.firstVisitCouponValidityDays,
    };
  }

  async updateSettings(branchId: string, dto: {
    loyaltyEnabled?: boolean;
    loyaltyTakaPerPoint?: number;
    loyaltyTakaPerPointRedeem?: number;
    loyaltyValidityDays?: number;
    firstVisitCouponEnabled?: boolean;
    firstVisitCouponType?: 'PERCENTAGE' | 'FLAT';
    firstVisitCouponValue?: number;
    firstVisitCouponValidityDays?: number;
  }) {
    await this.getSettings(branchId);
    const updated = await this.prisma.branchSetting.update({
      where: { branchId },
      data: {
        ...(dto.loyaltyEnabled != null ? { loyaltyEnabled: dto.loyaltyEnabled } : {}),
        ...(dto.loyaltyTakaPerPoint != null ? { loyaltyTakaPerPoint: Math.max(1, Math.floor(dto.loyaltyTakaPerPoint)) } : {}),
        ...(dto.loyaltyTakaPerPointRedeem != null ? { loyaltyTakaPerPointRedeem: Math.max(1, Math.floor(dto.loyaltyTakaPerPointRedeem)) } : {}),
        ...(dto.loyaltyValidityDays != null ? { loyaltyValidityDays: Math.max(0, Math.floor(dto.loyaltyValidityDays)) } : {}),
        ...(dto.firstVisitCouponEnabled != null ? { firstVisitCouponEnabled: dto.firstVisitCouponEnabled } : {}),
        ...(dto.firstVisitCouponType != null ? { firstVisitCouponType: dto.firstVisitCouponType } : {}),
        ...(dto.firstVisitCouponValue != null ? { firstVisitCouponValue: dto.firstVisitCouponValue } : {}),
        ...(dto.firstVisitCouponValidityDays != null ? { firstVisitCouponValidityDays: Math.max(1, Math.floor(dto.firstVisitCouponValidityDays)) } : {}),
      },
    });
    return {
      loyaltyEnabled: updated.loyaltyEnabled,
      loyaltyTakaPerPoint: updated.loyaltyTakaPerPoint,
      loyaltyTakaPerPointRedeem: updated.loyaltyTakaPerPointRedeem,
      loyaltyValidityDays: updated.loyaltyValidityDays,
      firstVisitCouponEnabled: updated.firstVisitCouponEnabled,
      firstVisitCouponType: updated.firstVisitCouponType,
      firstVisitCouponValue: updated.firstVisitCouponValue.toNumber(),
      firstVisitCouponValidityDays: updated.firstVisitCouponValidityDays,
    };
  }

  async listTransactions(branchId: string, customerId: string) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { branchId, customerId },
      include: {
        order: { select: { id: true, orderNumber: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

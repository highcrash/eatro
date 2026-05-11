import { Injectable, BadRequestException } from '@nestjs/common';
import type { LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload } from '@restora/types';

/**
 * Tracks each staff member's running leave balance per type. Two
 * accrual paths:
 *
 *   1. Monthly cron — credits `LeaveRuleEntry.accrualPerMonth` on the
 *      1st of every month. Idempotent via `lastAccrualAt`: a second
 *      run within the same calendar month is a no-op.
 *   2. Annual cron — credits `LeaveRuleEntry.annualGrant` once on
 *      Jan 1. Idempotent via `lastAnnualGrantAt`.
 *
 * Manual `accrueNow()` runs both paths at once — useful for the
 * "first run" after assigning a rule to a freshly hired staff member,
 * and for admin testing.
 *
 * `adjust()` lets the admin nudge a balance up or down by hand with a
 * recorded reason; the change is logged via ActivityLog so the audit
 * trail catches any "gave Ali 5 extra days because he covered Eid"
 * decisions.
 */
@Injectable()
export class LeaveBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async listForBranch(branchId: string, staffId?: string) {
    return this.prisma.leaveBalance.findMany({
      where: {
        branchId,
        ...(staffId ? { staffId } : {}),
      },
      include: {
        staff: { select: { id: true, name: true, role: true, leaveRuleId: true } },
      },
      orderBy: [{ staff: { name: 'asc' } }, { leaveType: 'asc' }],
    });
  }

  /**
   * Admin manual adjustment. Positive `delta` credits, negative
   * debits. The reason is mandatory so the audit row has context.
   */
  async adjust(
    branchId: string,
    actor: JwtPayload,
    dto: { staffId: string; leaveType: LeaveType; delta: number; reason: string },
  ) {
    if (!dto.staffId || !dto.leaveType || !Number.isFinite(dto.delta)) {
      throw new BadRequestException('staffId, leaveType, and delta are required');
    }
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason is required for manual adjustment');
    }
    const staff = await this.prisma.staff.findFirst({
      where: { id: dto.staffId, branchId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!staff) throw new BadRequestException('Staff not found in this branch');

    const before = await this.prisma.leaveBalance.findUnique({
      where: { staffId_leaveType: { staffId: dto.staffId, leaveType: dto.leaveType } },
    });
    const beforeBalance = before?.balance.toNumber() ?? 0;
    const afterBalance = beforeBalance + dto.delta;

    const updated = await this.prisma.leaveBalance.upsert({
      where: { staffId_leaveType: { staffId: dto.staffId, leaveType: dto.leaveType } },
      create: {
        branchId,
        staffId: dto.staffId,
        leaveType: dto.leaveType,
        balance: afterBalance,
      },
      update: { balance: afterBalance },
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'UPDATE',
      entityType: 'leave-balance',
      entityId: updated.id,
      entityName: `${staff.name} — ${dto.leaveType}`,
      summary: `${dto.delta > 0 ? '+' : ''}${dto.delta} days · ${dto.reason}`,
      before: { balance: beforeBalance },
      after: { balance: afterBalance, reason: dto.reason },
    });

    return {
      staffId: dto.staffId,
      leaveType: dto.leaveType,
      balance: afterBalance,
    };
  }

  /**
   * Run both accrual paths immediately — used by the manual trigger
   * endpoint, the scheduler, and the "first run" after a rule is
   * assigned to a new staff member. Idempotent: a second invocation
   * inside the same month / year is a no-op for already-credited rows.
   */
  async accrueAll() {
    const now = new Date();
    const monthlyCredited = await this.runMonthlyAccrual(now);
    const annualCredited = await this.runAnnualGrant(now);
    return {
      runAt: now.toISOString(),
      monthlyCredited,
      annualCredited,
    };
  }

  /**
   * Monthly accrual. For every active staff with a leaveRuleId, walks
   * the rule's entries and credits `accrualPerMonth` to each leave
   * type — but only if the existing balance row's `lastAccrualAt` is
   * NULL or falls in a previous calendar month. Honours `balanceCap`.
   */
  async runMonthlyAccrual(now = new Date()) {
    const periodMarker = monthMarker(now);
    let credited = 0;

    const staffWithRules = await this.prisma.staff.findMany({
      where: { isActive: true, deletedAt: null, leaveRuleId: { not: null } },
      select: {
        id: true,
        branchId: true,
        leaveRuleId: true,
      },
    });

    for (const s of staffWithRules) {
      if (!s.leaveRuleId) continue;
      const rule = await this.prisma.leaveRule.findFirst({
        where: { id: s.leaveRuleId, deletedAt: null },
        include: { entries: true },
      });
      if (!rule) continue;

      for (const e of rule.entries) {
        if (e.accrualPerMonth.toNumber() <= 0) continue;
        const ok = await this.creditMonthly(
          s.branchId,
          s.id,
          e.leaveType,
          e.accrualPerMonth.toNumber(),
          e.balanceCap,
          periodMarker,
          now,
        );
        if (ok) credited += 1;
      }
    }
    return credited;
  }

  /**
   * Annual upfront grant — credits `LeaveRuleEntry.annualGrant` per
   * leave type once per calendar year (the cron runs on Jan 1, but
   * manual triggers can fire any day; the year-marker check makes
   * out-of-band runs safe).
   */
  async runAnnualGrant(now = new Date()) {
    const yearMarker = now.getFullYear();
    let credited = 0;

    const staffWithRules = await this.prisma.staff.findMany({
      where: { isActive: true, deletedAt: null, leaveRuleId: { not: null } },
      select: {
        id: true,
        branchId: true,
        leaveRuleId: true,
      },
    });

    for (const s of staffWithRules) {
      if (!s.leaveRuleId) continue;
      const rule = await this.prisma.leaveRule.findFirst({
        where: { id: s.leaveRuleId, deletedAt: null },
        include: { entries: true },
      });
      if (!rule) continue;

      for (const e of rule.entries) {
        if (e.annualGrant <= 0) continue;
        const ok = await this.creditAnnual(
          s.branchId,
          s.id,
          e.leaveType,
          e.annualGrant,
          e.balanceCap,
          yearMarker,
          now,
        );
        if (ok) credited += 1;
      }
    }
    return credited;
  }

  private async creditMonthly(
    branchId: string,
    staffId: string,
    leaveType: LeaveType,
    amount: number,
    cap: number | null,
    periodMarker: number,
    now: Date,
  ): Promise<boolean> {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { staffId_leaveType: { staffId, leaveType } },
    });
    if (existing?.lastAccrualAt && monthMarker(existing.lastAccrualAt) === periodMarker) {
      return false; // already accrued this month
    }
    const currentBalance = existing?.balance.toNumber() ?? 0;
    const proposed = currentBalance + amount;
    const capped = cap != null && proposed > cap ? cap : proposed;

    await this.prisma.leaveBalance.upsert({
      where: { staffId_leaveType: { staffId, leaveType } },
      create: {
        branchId,
        staffId,
        leaveType,
        balance: capped,
        lastAccrualAt: now,
      },
      update: { balance: capped, lastAccrualAt: now },
    });
    return true;
  }

  private async creditAnnual(
    branchId: string,
    staffId: string,
    leaveType: LeaveType,
    amount: number,
    cap: number | null,
    yearMarker: number,
    now: Date,
  ): Promise<boolean> {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { staffId_leaveType: { staffId, leaveType } },
    });
    if (existing?.lastAnnualGrantAt && existing.lastAnnualGrantAt.getFullYear() === yearMarker) {
      return false; // already granted this year
    }
    const currentBalance = existing?.balance.toNumber() ?? 0;
    const proposed = currentBalance + amount;
    const capped = cap != null && proposed > cap ? cap : proposed;

    await this.prisma.leaveBalance.upsert({
      where: { staffId_leaveType: { staffId, leaveType } },
      create: {
        branchId,
        staffId,
        leaveType,
        balance: capped,
        lastAnnualGrantAt: now,
      },
      update: { balance: capped, lastAnnualGrantAt: now },
    });
    return true;
  }

  /**
   * Soft-debit used by `LeaveService.approve`. Decrements the balance
   * for the requested type by `days`. Returns the post-debit balance
   * so the caller can attach a warning when it goes negative — the
   * service intentionally does NOT throw on insufficient balance per
   * the soft-warn product decision.
   */
  async debitForLeave(
    branchId: string,
    staffId: string,
    leaveType: LeaveType,
    days: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const existing = await client.leaveBalance.findUnique({
      where: { staffId_leaveType: { staffId, leaveType } },
    });
    const currentBalance = existing?.balance.toNumber() ?? 0;
    const newBalance = currentBalance - days;
    await client.leaveBalance.upsert({
      where: { staffId_leaveType: { staffId, leaveType } },
      create: { branchId, staffId, leaveType, balance: newBalance },
      update: { balance: newBalance },
    });
    return newBalance;
  }
}

function monthMarker(d: Date): number {
  return d.getFullYear() * 100 + d.getMonth(); // 0-indexed month is fine for compare
}

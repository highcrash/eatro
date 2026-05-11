import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { LeaveType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload } from '@restora/types';

interface EntryInput {
  leaveType: LeaveType;
  accrualPerMonth?: number;
  annualGrant?: number;
  balanceCap?: number | null;
}

interface UpsertInput {
  name: string;
  notes?: string | null;
  entries: EntryInput[];
}

@Injectable()
export class LeaveRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async findAll(branchId: string) {
    const rows = await this.prisma.leaveRule.findMany({
      where: { branchId, deletedAt: null },
      include: {
        entries: true,
        _count: { select: { staff: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes,
      entries: r.entries.map((e) => ({
        id: e.id,
        leaveType: e.leaveType,
        accrualPerMonth: e.accrualPerMonth.toNumber(),
        annualGrant: e.annualGrant,
        balanceCap: e.balanceCap,
      })),
      assignedStaffCount: r._count.staff,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findOne(branchId: string, id: string) {
    const row = await this.prisma.leaveRule.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        entries: true,
        staff: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Leave rule not found');
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
      entries: row.entries.map((e) => ({
        id: e.id,
        leaveType: e.leaveType,
        accrualPerMonth: e.accrualPerMonth.toNumber(),
        annualGrant: e.annualGrant,
        balanceCap: e.balanceCap,
      })),
      assignedStaff: row.staff,
    };
  }

  async create(branchId: string, actor: JwtPayload, dto: UpsertInput) {
    this.validate(dto);
    const created = await this.prisma.leaveRule.create({
      data: {
        branchId,
        name: dto.name,
        notes: dto.notes ?? null,
        entries: {
          create: dto.entries.map((e) => ({
            leaveType: e.leaveType,
            accrualPerMonth: e.accrualPerMonth ?? 0,
            annualGrant: e.annualGrant ?? 0,
            balanceCap: e.balanceCap ?? null,
          })),
        },
      },
      include: { entries: true },
    });
    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'CREATE',
      entityType: 'leave-rule',
      entityId: created.id,
      entityName: created.name,
      after: this.snapshot(created),
    });
    return created;
  }

  async update(branchId: string, id: string, actor: JwtPayload, dto: UpsertInput) {
    this.validate(dto);
    const existing = await this.prisma.leaveRule.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { entries: true },
    });
    if (!existing) throw new NotFoundException('Leave rule not found');
    const before = this.snapshot(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.leaveRuleEntry.deleteMany({ where: { ruleId: id } });
      return tx.leaveRule.update({
        where: { id },
        data: {
          name: dto.name,
          notes: dto.notes ?? null,
          entries: {
            create: dto.entries.map((e) => ({
              leaveType: e.leaveType,
              accrualPerMonth: e.accrualPerMonth ?? 0,
              annualGrant: e.annualGrant ?? 0,
              balanceCap: e.balanceCap ?? null,
            })),
          },
        },
        include: { entries: true },
      });
    });
    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'UPDATE',
      entityType: 'leave-rule',
      entityId: updated.id,
      entityName: updated.name,
      before,
      after: this.snapshot(updated),
    });
    return updated;
  }

  async remove(branchId: string, id: string, actor: JwtPayload) {
    const existing = await this.prisma.leaveRule.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { _count: { select: { staff: true } } },
    });
    if (!existing) throw new NotFoundException('Leave rule not found');
    if (existing._count.staff > 0) {
      throw new BadRequestException(
        `Cannot delete — ${existing._count.staff} staff still assigned. Unassign first.`,
      );
    }
    await this.prisma.leaveRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'DELETE',
      entityType: 'leave-rule',
      entityId: id,
      entityName: existing.name,
      before: { id, name: existing.name },
    });
    return { ok: true };
  }

  async assign(branchId: string, ruleId: string, actor: JwtPayload, dto: { staffIds: string[] }) {
    const rule = await this.prisma.leaveRule.findFirst({
      where: { id: ruleId, branchId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('Leave rule not found');

    const ids = Array.from(new Set(dto.staffIds ?? []));
    if (ids.length > 0) {
      const found = await this.prisma.staff.count({
        where: { id: { in: ids }, branchId },
      });
      if (found !== ids.length) {
        throw new BadRequestException('One or more staff are not in this branch');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.staff.updateMany({
        where: {
          branchId,
          leaveRuleId: ruleId,
          ...(ids.length > 0 ? { id: { notIn: ids } } : {}),
        },
        data: { leaveRuleId: null },
      });
      if (ids.length > 0) {
        await tx.staff.updateMany({
          where: { id: { in: ids }, branchId },
          data: { leaveRuleId: ruleId },
        });
      }
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'UPDATE',
      entityType: 'leave-rule',
      entityId: ruleId,
      entityName: rule.name,
      summary: `Assigned to ${ids.length} staff`,
      after: { assignedStaffIds: ids },
    });
    return { ok: true, assigned: ids.length };
  }

  private validate(dto: UpsertInput) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Name is required');
    }
    if (!Array.isArray(dto.entries) || dto.entries.length === 0) {
      throw new BadRequestException('At least one leave-type entry is required');
    }
    const seen = new Set<string>();
    for (const e of dto.entries) {
      if (!e.leaveType) {
        throw new BadRequestException('Entry leaveType is required');
      }
      if (seen.has(e.leaveType)) {
        throw new BadRequestException(`Duplicate entry for leave type ${e.leaveType}`);
      }
      seen.add(e.leaveType);
      const monthly = e.accrualPerMonth ?? 0;
      const annual = e.annualGrant ?? 0;
      if (monthly < 0) {
        throw new BadRequestException('accrualPerMonth must be ≥ 0');
      }
      if (annual < 0) {
        throw new BadRequestException('annualGrant must be ≥ 0');
      }
      if (monthly === 0 && annual === 0) {
        throw new BadRequestException(`Entry for ${e.leaveType} has zero accrual — set monthly or annual`);
      }
      if (e.balanceCap != null && e.balanceCap < 0) {
        throw new BadRequestException('balanceCap must be ≥ 0');
      }
    }
  }

  private snapshot(row: {
    id: string;
    name: string;
    notes: string | null;
    entries: Array<{
      leaveType: string;
      accrualPerMonth: { toNumber(): number };
      annualGrant: number;
      balanceCap: number | null;
    }>;
  }) {
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
      entries: row.entries.map((e) => ({
        leaveType: e.leaveType,
        accrualPerMonth: e.accrualPerMonth.toNumber(),
        annualGrant: e.annualGrant,
        balanceCap: e.balanceCap,
      })),
    };
  }
}

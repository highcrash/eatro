import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload } from '@restora/types';

interface ComponentInput {
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  amount: number;
  sortOrder?: number;
}

interface UpsertInput {
  name: string;
  notes?: string | null;
  latesPerAbsent?: number;
  halfDaysPerAbsent?: number;
  components: ComponentInput[];
}

interface AssignInput {
  staffIds: string[];
}

@Injectable()
export class SalaryStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Lightweight list — includes counts + totals the admin table renders.
   *  Components are NOT hydrated here; the detail endpoint pulls them. */
  async findAll(branchId: string) {
    const rows = await this.prisma.salaryStructure.findMany({
      where: { branchId, deletedAt: null },
      include: {
        components: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { staff: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes,
      latesPerAbsent: r.latesPerAbsent,
      halfDaysPerAbsent: r.halfDaysPerAbsent,
      components: r.components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        amount: c.amount.toNumber(),
        sortOrder: c.sortOrder,
      })),
      assignedStaffCount: r._count.staff,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findOne(branchId: string, id: string) {
    const row = await this.prisma.salaryStructure.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        components: { orderBy: { sortOrder: 'asc' } },
        staff: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Salary structure not found');
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
      latesPerAbsent: row.latesPerAbsent,
      halfDaysPerAbsent: row.halfDaysPerAbsent,
      components: row.components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        amount: c.amount.toNumber(),
        sortOrder: c.sortOrder,
      })),
      assignedStaff: row.staff,
    };
  }

  async create(branchId: string, actor: JwtPayload, dto: UpsertInput) {
    this.validate(dto);
    const created = await this.prisma.salaryStructure.create({
      data: {
        branchId,
        name: dto.name,
        notes: dto.notes ?? null,
        latesPerAbsent: dto.latesPerAbsent ?? 3,
        halfDaysPerAbsent: dto.halfDaysPerAbsent ?? 2,
        components: {
          create: dto.components.map((c, i) => ({
            name: c.name,
            type: c.type,
            amount: c.amount,
            sortOrder: c.sortOrder ?? i,
          })),
        },
      },
      include: { components: true },
    });
    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'CREATE',
      entityType: 'salary-structure',
      entityId: created.id,
      entityName: created.name,
      after: this.snapshot(created),
    });
    return created;
  }

  /** PATCH replaces the component set wholesale. Simpler than per-row
   *  CRUD and totally fine for the row counts involved (tens, not
   *  thousands). The admin UI sends the full list every save. */
  async update(branchId: string, id: string, actor: JwtPayload, dto: UpsertInput) {
    this.validate(dto);
    const existing = await this.prisma.salaryStructure.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { components: true },
    });
    if (!existing) throw new NotFoundException('Salary structure not found');
    const before = this.snapshot(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.salaryComponent.deleteMany({ where: { structureId: id } });
      return tx.salaryStructure.update({
        where: { id },
        data: {
          name: dto.name,
          notes: dto.notes ?? null,
          latesPerAbsent: dto.latesPerAbsent ?? 3,
          halfDaysPerAbsent: dto.halfDaysPerAbsent ?? 2,
          components: {
            create: dto.components.map((c, i) => ({
              name: c.name,
              type: c.type,
              amount: c.amount,
              sortOrder: c.sortOrder ?? i,
            })),
          },
        },
        include: { components: true },
      });
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'UPDATE',
      entityType: 'salary-structure',
      entityId: updated.id,
      entityName: updated.name,
      before,
      after: this.snapshot(updated),
    });
    return updated;
  }

  async remove(branchId: string, id: string, actor: JwtPayload) {
    const existing = await this.prisma.salaryStructure.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { _count: { select: { staff: true } } },
    });
    if (!existing) throw new NotFoundException('Salary structure not found');
    if (existing._count.staff > 0) {
      throw new BadRequestException(
        `Cannot delete — ${existing._count.staff} staff still assigned. Unassign first.`,
      );
    }
    await this.prisma.salaryStructure.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'DELETE',
      entityType: 'salary-structure',
      entityId: id,
      entityName: existing.name,
      before: { id, name: existing.name },
    });
    return { ok: true };
  }

  /** Bulk-assign or bulk-unassign — pass an empty staffIds to clear the
   *  current set, or a populated list to overwrite it. The set is the
   *  full assigned staff after the call; staff in the old set but not
   *  the new one get null'd. */
  async assign(branchId: string, structureId: string, actor: JwtPayload, dto: AssignInput) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id: structureId, branchId, deletedAt: null },
    });
    if (!structure) throw new NotFoundException('Salary structure not found');

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
      // Unassign current set that's NOT in the new list.
      await tx.staff.updateMany({
        where: {
          branchId,
          salaryStructureId: structureId,
          ...(ids.length > 0 ? { id: { notIn: ids } } : {}),
        },
        data: { salaryStructureId: null },
      });
      // Assign new set.
      if (ids.length > 0) {
        await tx.staff.updateMany({
          where: { id: { in: ids }, branchId },
          data: { salaryStructureId: structureId },
        });
      }
    });

    void this.activityLog.log({
      branchId,
      actor,
      category: 'STAFF',
      action: 'UPDATE',
      entityType: 'salary-structure',
      entityId: structureId,
      entityName: structure.name,
      summary: `Assigned to ${ids.length} staff`,
      after: { assignedStaffIds: ids },
    });
    return { ok: true, assigned: ids.length };
  }

  private validate(dto: UpsertInput) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Name is required');
    }
    if (!Array.isArray(dto.components) || dto.components.length === 0) {
      throw new BadRequestException('At least one component is required');
    }
    for (const c of dto.components) {
      if (!c.name || c.name.trim().length === 0) {
        throw new BadRequestException('Component name is required');
      }
      if (c.type !== 'EARNING' && c.type !== 'DEDUCTION') {
        throw new BadRequestException('Component type must be EARNING or DEDUCTION');
      }
      if (!Number.isFinite(c.amount) || c.amount < 0) {
        throw new BadRequestException('Component amount must be a non-negative number');
      }
    }
    if (dto.latesPerAbsent != null && dto.latesPerAbsent < 1) {
      throw new BadRequestException('latesPerAbsent must be ≥ 1');
    }
    if (dto.halfDaysPerAbsent != null && dto.halfDaysPerAbsent < 1) {
      throw new BadRequestException('halfDaysPerAbsent must be ≥ 1');
    }
  }

  private snapshot(row: {
    id: string;
    name: string;
    notes: string | null;
    latesPerAbsent: number;
    halfDaysPerAbsent: number;
    components: Array<{ name: string; type: string; amount: { toNumber(): number }; sortOrder: number }>;
  }) {
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
      latesPerAbsent: row.latesPerAbsent,
      halfDaysPerAbsent: row.halfDaysPerAbsent,
      components: row.components.map((c) => ({
        name: c.name,
        type: c.type,
        amount: c.amount.toNumber(),
        sortOrder: c.sortOrder,
      })),
    };
  }
}

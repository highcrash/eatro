import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { GeneratePayrollDto, ApprovePayrollDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
  ) {}

  private readonly payrollInclude = {
    staff: { select: { id: true, name: true, role: true } },
    approvedBy: { select: { id: true, name: true } },
    payments: { include: { paidBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
  };

  findAll(branchId: string) {
    return this.prisma.payroll.findMany({
      where: { branchId },
      include: this.payrollInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Full payroll history for one staff (no 100-row cap — supports the
   *  per-staff drilldown view). */
  findForStaff(branchId: string, staffId: string) {
    return this.prisma.payroll.findMany({
      where: { branchId, staffId },
      include: this.payrollInclude,
      orderBy: { periodEnd: 'desc' },
      take: 240,
    });
  }

  /** One row per staff with rolled-up payroll stats — powers the
   *  staff-first /payroll list. Active staff are always included;
   *  inactive staff are also included when they still carry an
   *  outstanding APPROVED balance (so deactivation can't hide debts),
   *  or unconditionally when ?includeInactive=true. */
  async getStaffSummary(branchId: string, includeInactive: boolean) {
    const staffWhere = includeInactive
      ? { branchId, deletedAt: null }
      : { branchId, deletedAt: null, isActive: true };
    const staff = await this.prisma.staff.findMany({
      where: staffWhere,
      select: { id: true, name: true, role: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    const allPayrolls = await this.prisma.payroll.findMany({
      where: { branchId },
      select: {
        id: true,
        staffId: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        netPayable: true,
        paidAmount: true,
      },
      orderBy: { periodEnd: 'desc' },
    });

    const allPayments = await this.prisma.payrollPayment.findMany({
      where: { payroll: { branchId } },
      select: { createdAt: true, payroll: { select: { staffId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const lastPaidByStaff = new Map<string, Date>();
    for (const p of allPayments) {
      const sId = p.payroll.staffId;
      if (!lastPaidByStaff.has(sId)) lastPaidByStaff.set(sId, p.createdAt);
    }

    const buildRowForStaff = (s: typeof staff[number]) => {
      const mine = allPayrolls.filter((p) => p.staffId === s.id);
      const latest = mine[0] ?? null;
      let balanceOwed = 0;
      let totalPaid = 0;
      let draftCount = 0;
      for (const p of mine) {
        const net = p.netPayable.toNumber();
        const paid = p.paidAmount.toNumber();
        totalPaid += paid;
        if (p.status === 'APPROVED') balanceOwed += Math.max(0, net - paid);
        if (p.status === 'DRAFT') draftCount += 1;
      }
      return {
        staffId: s.id,
        staff: { id: s.id, name: s.name, role: s.role, isActive: s.isActive },
        latestPayroll: latest
          ? {
              id: latest.id,
              status: latest.status,
              periodStart: latest.periodStart.toISOString(),
              periodEnd: latest.periodEnd.toISOString(),
              netPayable: latest.netPayable.toNumber(),
              paidAmount: latest.paidAmount.toNumber(),
            }
          : null,
        balanceOwed,
        totalPaid,
        payrollCount: mine.length,
        draftCount,
        lastPaidAt: lastPaidByStaff.get(s.id)?.toISOString() ?? null,
      };
    };

    const rows = staff.map(buildRowForStaff);

    // Always surface inactive staff who still carry an unpaid APPROVED
    // balance — deactivating someone shouldn't hide what we owe them.
    if (!includeInactive) {
      const includedIds = new Set(rows.map((r) => r.staffId));
      const extraStaffIds = new Set<string>();
      for (const p of allPayrolls) {
        if (includedIds.has(p.staffId)) continue;
        if (p.status !== 'APPROVED') continue;
        if (p.netPayable.toNumber() - p.paidAmount.toNumber() > 0) {
          extraStaffIds.add(p.staffId);
        }
      }
      if (extraStaffIds.size > 0) {
        const extras = await this.prisma.staff.findMany({
          where: { id: { in: [...extraStaffIds] }, branchId, deletedAt: null },
          select: { id: true, name: true, role: true, isActive: true },
        });
        rows.push(...extras.map(buildRowForStaff));
      }
    }

    return rows.sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  }

  async findOne(id: string, branchId: string) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { id, branchId },
      include: this.payrollInclude,
    });
    if (!payroll) throw new NotFoundException(`Payroll ${id} not found`);
    return payroll;
  }

  /**
   * Resolve the default base salary the admin should see when picking
   * a staff member in the Generate-Payroll dialog. Mirrors the same
   * source of truth that `generate()` uses on submit:
   *   - if a SalaryStructure is assigned → sum of EARNING components
   *     and structure-level deductions (returned for UI hints)
   *   - else → legacy Staff.monthlySalary
   *
   * Amounts are returned in TAKA (Decimal → number) so the UI can
   * render straight into the form input without paisa conversion.
   * Server still receives the same taka figure on submit and converts
   * once at the controller boundary.
   */
  async getPrefillForStaff(branchId: string, staffId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, branchId, deletedAt: null },
      select: {
        id: true, name: true, monthlySalary: true,
        salaryStructure: {
          select: {
            id: true, name: true,
            latesPerAbsent: true, halfDaysPerAbsent: true,
            components: {
              select: { name: true, type: true, amount: true, sortOrder: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!staff) throw new NotFoundException('Staff not found in this branch');

    if (staff.salaryStructure) {
      const earnings = staff.salaryStructure.components
        .filter((c) => c.type === 'EARNING')
        .reduce((s, c) => s + c.amount.toNumber(), 0);
      const deductions = staff.salaryStructure.components
        .filter((c) => c.type === 'DEDUCTION')
        .reduce((s, c) => s + c.amount.toNumber(), 0);
      return {
        baseSalary: earnings,
        source: 'structure' as const,
        structure: {
          id: staff.salaryStructure.id,
          name: staff.salaryStructure.name,
          latesPerAbsent: staff.salaryStructure.latesPerAbsent,
          halfDaysPerAbsent: staff.salaryStructure.halfDaysPerAbsent,
          earnings,
          deductions,
          components: staff.salaryStructure.components.map((c) => ({
            name: c.name, type: c.type, amount: c.amount.toNumber(),
          })),
        },
      };
    }

    return {
      baseSalary: staff.monthlySalary?.toNumber() ?? 0,
      source: 'legacy' as const,
      structure: null,
    };
  }

  async generate(branchId: string, dto: GeneratePayrollDto) {
    const from = new Date(dto.periodStart);
    const to = new Date(dto.periodEnd);

    // Look up the staff's salary structure so the deduction thresholds
    // + component breakdown drive the calculation. NULL = legacy path:
    // hardcoded 3-lates / 2-half-days + admin-typed baseSalary.
    const staff = await this.prisma.staff.findFirst({
      where: { id: dto.staffId, branchId },
      include: {
        salaryStructure: {
          include: { components: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!staff) throw new NotFoundException('Staff not found in this branch');

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: { branchId, staffId: dto.staffId, date: { gte: from, lte: to } },
    });

    // Count each status
    const daysPresent = attendanceRecords.filter((a) => a.status === 'PRESENT').length;
    const daysLate = attendanceRecords.filter((a) => a.status === 'LATE').length;
    const daysHalfDay = attendanceRecords.filter((a) => a.status === 'HALF_DAY').length;
    const daysAbsent = attendanceRecords.filter((a) => a.status === 'ABSENT').length;
    const daysPaidLeave = attendanceRecords.filter((a) =>
      a.status === 'PAID_LEAVE' || a.status === 'SICK_LEAVE' || a.status === 'FESTIVAL_LEAVE'
    ).length;

    const totalDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Threshold + base-salary source — structure-driven when available,
    // legacy hardcoded values + admin-typed baseSalary otherwise.
    const latesPerAbsent = staff.salaryStructure?.latesPerAbsent ?? 3;
    const halfDaysPerAbsent = staff.salaryStructure?.halfDaysPerAbsent ?? 2;

    let baseSalary = dto.baseSalary;
    let structureDeductions = 0;
    let structureSnapshot: unknown = null;
    if (staff.salaryStructure) {
      const earnings = staff.salaryStructure.components
        .filter((c) => c.type === 'EARNING')
        .reduce((s, c) => s + c.amount.toNumber(), 0);
      structureDeductions = staff.salaryStructure.components
        .filter((c) => c.type === 'DEDUCTION')
        .reduce((s, c) => s + c.amount.toNumber(), 0);
      // Use admin-typed baseSalary as override if it differs from
      // structure earnings (e.g. one-off salary review for this run);
      // otherwise pull from the structure.
      if (dto.baseSalary == null || dto.baseSalary === 0) {
        baseSalary = earnings;
      }
      structureSnapshot = {
        id: staff.salaryStructure.id,
        name: staff.salaryStructure.name,
        latesPerAbsent,
        halfDaysPerAbsent,
        components: staff.salaryStructure.components.map((c) => ({
          name: c.name,
          type: c.type,
          amount: c.amount.toNumber(),
        })),
        derivedEarnings: earnings,
        derivedDeductions: structureDeductions,
      };
    }

    const perDaySalary = totalDays > 0 ? baseSalary / totalDays : 0;

    // Deduction math driven by the (possibly per-structure) thresholds:
    //   latePenaltyDays  = floor(daysLate  / latesPerAbsent)
    //   halfDayPenalty   = floor(daysHalfDay / halfDaysPerAbsent)
    //   absentPenalty    = daysAbsent
    const latePenaltyDays = Math.floor(daysLate / Math.max(1, latesPerAbsent));
    const halfDayPenalty = Math.floor(daysHalfDay / Math.max(1, halfDaysPerAbsent));
    const absentPenalty = daysAbsent;
    const totalPenaltyDays = latePenaltyDays + halfDayPenalty + absentPenalty;
    const attendanceDeduction = Math.round(perDaySalary * totalPenaltyDays);

    const adhocDeductions = dto.deductions ?? 0;
    const bonuses = dto.bonuses ?? 0;
    // Total deductions stored on the row = structure-level + attendance
    // + admin-typed ad-hoc. The structure-level slice is captured in
    // the snapshot so the admin UI can render the breakdown later.
    const totalDeductions = structureDeductions + attendanceDeduction + adhocDeductions;
    const netPayable = Math.max(0, baseSalary - totalDeductions + bonuses);

    const thresholdNote = staff.salaryStructure
      ? ` (rule ${latesPerAbsent}L=1A, ${halfDaysPerAbsent}H=1A from "${staff.salaryStructure.name}")`
      : ` (legacy 3L=1A, 2H=1A)`;

    return this.prisma.payroll.create({
      data: {
        branchId,
        staffId: dto.staffId,
        periodStart: from,
        periodEnd: to,
        baseSalary,
        deductions: totalDeductions,
        bonuses,
        netPayable,
        structureSnapshot: structureSnapshot as any,
        notes: dto.notes
          ? dto.notes
          : `${daysPresent}P ${daysLate}L ${daysHalfDay}H ${daysAbsent}A ${daysPaidLeave}Leave | Late: ${latePenaltyDays}d, Half: ${halfDayPenalty}d, Absent: ${absentPenalty}d = ${totalPenaltyDays}d deducted${thresholdNote}`,
        daysPresent: daysPresent + daysLate + daysPaidLeave,
        daysAbsent,
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async approve(id: string, branchId: string, approverId: string, dto: ApprovePayrollDto) {
    const payroll = await this.findOne(id, branchId);
    if (payroll.status !== 'DRAFT') throw new BadRequestException('Only DRAFT payrolls can be approved');

    return this.prisma.payroll.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: approverId,
        approvedAt: new Date(),
        notes: dto.notes ?? payroll.notes,
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string, branchId: string) {
    const payroll = await this.findOne(id, branchId);
    if (payroll.status !== 'DRAFT') throw new BadRequestException('Only DRAFT payrolls can be deleted');
    await this.prisma.payroll.delete({ where: { id } });
    return { success: true };
  }

  async makePayment(id: string, branchId: string, staffId: string, dto: { amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    const payroll = await this.findOne(id, branchId);
    if (payroll.status !== 'APPROVED' && payroll.status !== 'PAID') {
      throw new BadRequestException('Payroll must be APPROVED before making payments');
    }

    const currentPaid = payroll.paidAmount.toNumber();
    const net = payroll.netPayable.toNumber();
    const remaining = net - currentPaid;

    if (dto.amount <= 0) throw new BadRequestException('Payment amount must be positive');
    if (dto.amount > remaining + 1) throw new BadRequestException(`Payment exceeds remaining amount (${remaining})`);

    // Create payment record
    const payment = await this.prisma.payrollPayment.create({
      data: {
        payrollId: id,
        amount: dto.amount,
        paymentMethod: (dto.paymentMethod ?? 'CASH') as any,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        paidById: staffId,
      },
    });

    const newPaidAmount = currentPaid + dto.amount;
    const fullyPaid = newPaidAmount >= net - 1; // allow 1 paisa rounding

    // Update payroll
    const updated = await this.prisma.payroll.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        ...(fullyPaid ? { status: 'PAID', paidAt: new Date() } : {}),
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
        payments: { include: { paidBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });

    // Auto-create SALARY expense for this payment.
    // `reference` carries a typed back-pointer so deleting the expense
    // can find + reverse the matching PayrollPayment (decrement
    // Payroll.paidAmount, flip PAID → APPROVED if no longer fully paid,
    // delete the PayrollPayment row). Without this back-pointer the
    // expense delete left the payroll showing "paid" forever.
    const method = dto.paymentMethod ?? 'CASH';
    await this.prisma.expense.create({
      data: {
        branchId,
        category: 'SALARY',
        description: `Salary ${fullyPaid ? 'paid' : 'partial'} — ${updated.staff?.name}${dto.notes ? ` (${dto.notes})` : ''}`,
        amount: dto.amount,
        paymentMethod: method,
        reference: `PAYROLL_PAYMENT:${payment.id}`,
        date: new Date(),
        recordedById: staffId,
        approvedById: staffId,
        approvedAt: new Date(),
      },
    });

    // Update linked account balance
    void this.accountService.updateAccountForPayment(branchId, method, dto.amount, 'EXPENSE', `Salary — ${updated.staff?.name}`);

    return updated;
  }

  async getPayments(payrollId: string, branchId: string) {
    await this.findOne(payrollId, branchId); // verify access
    return this.prisma.payrollPayment.findMany({
      where: { payrollId },
      include: { paidBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Undo a single PayrollPayment (called when admin deletes the
   *  SALARY-category Expense that mirrored it). Decrements
   *  Payroll.paidAmount, flips status from PAID → APPROVED when the
   *  payroll is no longer fully paid, and deletes the PayrollPayment
   *  row so the payment history + paidAmount stay in sync.
   *
   *  Silent no-op when the PayrollPayment doesn't exist (race with
   *  manual cleanup, expense from a different branch's payroll, etc.)
   *  so an expense delete never throws because of a stale back-pointer.
   *  Branch-scoped lookup is enforced through Payroll → branchId. */
  async reverseSalaryPaymentForDeletedExpense(branchId: string, payrollPaymentId: string) {
    const payment = await this.prisma.payrollPayment.findUnique({
      where: { id: payrollPaymentId },
      include: { payroll: { select: { id: true, branchId: true, paidAmount: true, netPayable: true, status: true } } },
    });
    if (!payment || payment.payroll.branchId !== branchId) return;

    const decrementBy = payment.amount.toNumber();
    const currentPaid = payment.payroll.paidAmount.toNumber();
    const newPaid = Math.max(0, currentPaid - decrementBy);
    const net = payment.payroll.netPayable.toNumber();
    const stillFullyPaid = newPaid >= net - 1;

    await this.prisma.$transaction([
      this.prisma.payroll.update({
        where: { id: payment.payrollId },
        data: {
          paidAmount: newPaid,
          // If this reversal drops us below the "fully paid" threshold,
          // flip the status back to APPROVED so the payroll list shows
          // it as outstanding again. Leave APPROVED rows alone — they
          // were never marked PAID to begin with.
          ...(payment.payroll.status === 'PAID' && !stillFullyPaid
            ? { status: 'APPROVED', paidAt: null }
            : {}),
        },
      }),
      // Hard-delete the PayrollPayment so the payment history table on
      // the payroll detail doesn't keep showing the reversed entry. The
      // ActivityLog row for the expense delete is the audit trail.
      this.prisma.payrollPayment.delete({ where: { id: payrollPaymentId } }),
    ]);
  }
}

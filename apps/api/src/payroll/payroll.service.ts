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

  async findOne(id: string, branchId: string) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { id, branchId },
      include: this.payrollInclude,
    });
    if (!payroll) throw new NotFoundException(`Payroll ${id} not found`);
    return payroll;
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
    await this.prisma.payrollPayment.create({
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

    // Auto-create SALARY expense for this payment
    const method = dto.paymentMethod ?? 'CASH';
    await this.prisma.expense.create({
      data: {
        branchId,
        category: 'SALARY',
        description: `Salary ${fullyPaid ? 'paid' : 'partial'} — ${updated.staff?.name}${dto.notes ? ` (${dto.notes})` : ''}`,
        amount: dto.amount,
        paymentMethod: method,
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
}

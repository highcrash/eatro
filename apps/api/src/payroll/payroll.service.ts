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
    const perDaySalary = totalDays > 0 ? dto.baseSalary / totalDays : 0;

    // Deduction logic:
    // - LATE: every 3 late days = 1 day salary deducted (floor division)
    // - HALF_DAY: each = 0.5 day salary deducted
    // - ABSENT: each = 1 day salary deducted
    // - PRESENT, PAID_LEAVE, SICK_LEAVE, FESTIVAL_LEAVE: no deduction
    const latePenaltyDays = Math.floor(daysLate / 3);
    const halfDayPenalty = daysHalfDay * 0.5;
    const absentPenalty = daysAbsent;
    const totalPenaltyDays = latePenaltyDays + halfDayPenalty + absentPenalty;
    const attendanceDeduction = Math.round(perDaySalary * totalPenaltyDays);

    const deductions = (dto.deductions ?? 0) + attendanceDeduction;
    const bonuses = dto.bonuses ?? 0;
    const netPayable = Math.max(0, dto.baseSalary - attendanceDeduction - (dto.deductions ?? 0) + bonuses);

    return this.prisma.payroll.create({
      data: {
        branchId,
        staffId: dto.staffId,
        periodStart: from,
        periodEnd: to,
        baseSalary: dto.baseSalary,
        deductions,
        bonuses,
        netPayable,
        notes: dto.notes
          ? dto.notes
          : `${daysPresent}P ${daysLate}L ${daysHalfDay}H ${daysAbsent}A ${daysPaidLeave}Leave | Late penalty: ${latePenaltyDays}d, Half-day: ${halfDayPenalty}d, Absent: ${absentPenalty}d = ${totalPenaltyDays} days deducted`,
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

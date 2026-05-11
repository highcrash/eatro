import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateLeaveDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveBalanceService } from '../leave-balance/leave-balance.service';

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalance: LeaveBalanceService,
  ) {}

  findAll(branchId: string, staffId?: string) {
    return this.prisma.leaveApplication.findMany({
      where: { branchId, ...(staffId ? { staffId } : {}) },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  create(branchId: string, dto: CreateLeaveDto) {
    return this.prisma.leaveApplication.create({
      data: {
        branchId,
        staffId: dto.staffId,
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason ?? null,
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Approve a leave application. Decrements the staff's LeaveBalance
   * for the requested type by the inclusive day count. Allows the
   * balance to go negative — per the soft-warn product decision the
   * server returns a `balanceWarning` for the admin UI to render but
   * doesn't block the approval. UNPAID type skips the balance touch
   * entirely (it doesn't draw from any quota).
   */
  async approve(id: string, branchId: string, reviewerId: string) {
    const leave = await this.prisma.leaveApplication.findFirst({ where: { id, branchId } });
    if (!leave) throw new NotFoundException();
    if (leave.status !== 'PENDING') throw new BadRequestException('Only PENDING applications can be reviewed');

    const days = inclusiveDayCount(leave.startDate, leave.endDate);
    let balanceAfter: number | null = null;
    let balanceWarning: string | null = null;

    if (leave.type !== 'UNPAID') {
      balanceAfter = await this.leaveBalance.debitForLeave(
        branchId,
        leave.staffId,
        leave.type,
        days,
      );
      if (balanceAfter < 0) {
        balanceWarning = `Approved with ${Math.abs(balanceAfter).toFixed(2)} day(s) over the staff's ${leave.type} balance.`;
      }
    }

    const updated = await this.prisma.leaveApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date() },
      include: { staff: { select: { id: true, name: true, role: true } }, reviewedBy: { select: { id: true, name: true } } },
    });
    return { ...updated, balanceAfter, balanceWarning, requestedDays: days };
  }

  async reject(id: string, branchId: string, reviewerId: string) {
    const leave = await this.prisma.leaveApplication.findFirst({ where: { id, branchId } });
    if (!leave) throw new NotFoundException();
    if (leave.status !== 'PENDING') throw new BadRequestException('Only PENDING applications can be reviewed');
    return this.prisma.leaveApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date() },
      include: { staff: { select: { id: true, name: true, role: true } }, reviewedBy: { select: { id: true, name: true } } },
    });
  }
}

/**
 * Inclusive day count between two dates (both endpoints count). A
 * one-day leave on the same date returns 1, not 0.
 */
function inclusiveDayCount(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

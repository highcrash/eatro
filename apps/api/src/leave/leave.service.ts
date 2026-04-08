import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateLeaveDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

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

  async approve(id: string, branchId: string, reviewerId: string) {
    const leave = await this.prisma.leaveApplication.findFirst({ where: { id, branchId } });
    if (!leave) throw new NotFoundException();
    if (leave.status !== 'PENDING') throw new BadRequestException('Only PENDING applications can be reviewed');
    return this.prisma.leaveApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date() },
      include: { staff: { select: { id: true, name: true, role: true } }, reviewedBy: { select: { id: true, name: true } } },
    });
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

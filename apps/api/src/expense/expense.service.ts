import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateExpenseDto, UpdateExpenseDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
  ) {}

  findAll(branchId: string, filters?: { from?: string; to?: string; category?: string }) {
    return this.prisma.expense.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(filters?.from && filters?.to ? { date: { gte: new Date(filters.from), lte: new Date(filters.to) } } : {}),
        ...(filters?.category ? { category: filters.category as any } : {}),
      },
      include: {
        recordedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });
  }

  async findOne(id: string, branchId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        recordedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new NotFoundException(`Expense ${id} not found`);
    return expense;
  }

  async create(branchId: string, staffId: string, dto: CreateExpenseDto) {
    const expense = await this.prisma.expense.create({
      data: {
        branchId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: dto.category as any,
        description: dto.description,
        amount: dto.amount,
        paymentMethod: (dto.paymentMethod ?? 'CASH') as any,
        reference: dto.reference ?? null,
        date: new Date(dto.date),
        notes: dto.notes ?? null,
        recordedById: staffId,
      },
      include: {
        recordedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    // Update linked account balance (best-effort)
    const method = dto.paymentMethod ?? 'CASH';
    void this.accountService.updateAccountForPayment(
      branchId,
      method,
      typeof dto.amount === 'number' ? dto.amount : Number(dto.amount),
      'EXPENSE',
      `Expense: ${dto.description}`,
    );

    return expense;
  }

  async update(id: string, branchId: string, dto: UpdateExpenseDto) {
    await this.findOne(id, branchId);
    return this.prisma.expense.update({
      where: { id },
      data: {
        // Cast through any so STAFF_FOOD compiles before prisma generate runs.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.category ? { category: dto.category as any } : {}),
        ...(dto.description ? { description: dto.description } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.paymentMethod ? { paymentMethod: dto.paymentMethod as any } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.date ? { date: new Date(dto.date) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: {
        recordedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async approve(id: string, branchId: string, approverId: string) {
    const expense = await this.findOne(id, branchId);
    if (expense.approvedAt) throw new BadRequestException('Expense already approved');
    return this.prisma.expense.update({
      where: { id },
      data: { approvedById: approverId, approvedAt: new Date() },
      include: {
        recordedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getSummary(branchId: string, from: string, to: string) {
    const expenses = await this.prisma.expense.findMany({
      where: {
        branchId,
        deletedAt: null,
        date: { gte: new Date(from), lte: new Date(to) },
      },
    });

    const byCategory: Record<string, number> = {};
    const byPaymentMethod: Record<string, number> = {};
    let total = 0;

    for (const e of expenses) {
      const amt = e.amount.toNumber();
      total += amt;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + amt;
      byPaymentMethod[e.paymentMethod] = (byPaymentMethod[e.paymentMethod] ?? 0) + amt;
    }

    return { total, count: expenses.length, byCategory, byPaymentMethod, from, to };
  }
}

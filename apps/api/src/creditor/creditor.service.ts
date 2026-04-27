import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type {
  CreateCreditorDto,
  UpdateCreditorDto,
  RecordCreditorBillDto,
  MakeCreditorPaymentDto,
  RecordCreditorAdjustmentDto,
} from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';

@Injectable()
export class CreditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
  ) {}

  async findAll(branchId: string) {
    return this.prisma.creditor.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const c = await this.prisma.creditor.findFirst({
      where: { id, branchId, deletedAt: null },
    });
    if (!c) throw new NotFoundException(`Creditor ${id} not found`);
    return c;
  }

  create(branchId: string, dto: CreateCreditorDto) {
    const { openingBalance, defaultExpenseCategory, category, ...rest } = dto;
    const ob = openingBalance ? Math.round(openingBalance) : 0;
    return this.prisma.creditor.create({
      data: {
        branchId,
        ...rest,
        category: (category ?? 'OTHER') as any,
        defaultExpenseCategory: (defaultExpenseCategory ?? 'MISCELLANEOUS') as any,
        openingBalance: ob,
        totalDue: ob,
      },
    });
  }

  async update(id: string, branchId: string, dto: UpdateCreditorDto) {
    await this.findOne(id, branchId);
    // Defence-in-depth: openingBalance can never be patched here. To
    // correct a wrong opening balance, admins must use a Ledger
    // Adjustment so the change is auditable. Same shape as Suppliers.
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.contactName !== undefined) data.contactName = dto.contactName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.defaultExpenseCategory !== undefined) data.defaultExpenseCategory = dto.defaultExpenseCategory;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (Object.keys(data).length === 0) return this.findOne(id, branchId);
    return this.prisma.creditor.update({ where: { id }, data });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.creditor.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async getCreditorLedger(id: string, branchId: string) {
    const creditor = await this.findOne(id, branchId);

    const bills = await this.prisma.creditorBill.findMany({
      where: { branchId, creditorId: id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const payments = await this.prisma.creditorPayment.findMany({
      where: { branchId, creditorId: id },
      include: { paidBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const adjustments = await this.prisma.creditorAdjustment.findMany({
      where: { branchId, creditorId: id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const openingBalance = creditor.openingBalance.toNumber();
    const totalBilled = bills.reduce((s, b) => s + b.amount.toNumber(), 0);
    const totalPaid = payments.reduce((s, p) => s + p.amount.toNumber(), 0);
    const totalAdjustments = adjustments.reduce((s, a) => s + a.amount.toNumber(), 0);

    return {
      creditor,
      openingBalance,
      totalBilled,
      totalPaid,
      totalAdjustments,
      balance: openingBalance + totalBilled - totalPaid + totalAdjustments,
      bills: bills.map((b) => ({
        id: b.id,
        branchId: b.branchId,
        creditorId: b.creditorId,
        description: b.description,
        amount: b.amount.toNumber(),
        billDate: b.billDate,
        dueDate: b.dueDate,
        notes: b.notes,
        recordedById: b.recordedById,
        createdAt: b.createdAt,
        recordedBy: b.recordedBy,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        branchId: p.branchId,
        creditorId: p.creditorId,
        amount: p.amount.toNumber(),
        paymentMethod: p.paymentMethod,
        reference: p.reference,
        notes: p.notes,
        paidById: p.paidById,
        createdAt: p.createdAt,
        paidBy: p.paidBy,
      })),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        amount: a.amount.toNumber(),
        reason: a.reason,
        createdAt: a.createdAt,
        recordedBy: a.recordedBy,
      })),
    };
  }

  /**
   * Record a new bill against a creditor (e.g. April electricity, March
   * rent, May EMI). Increments Creditor.totalDue. Pure ledger-only —
   * NOT an Expense yet (expense fires when payment is recorded so the
   * cash account hit is the source-of-truth event).
   */
  async recordBill(
    branchId: string,
    creditorId: string,
    staffId: string,
    dto: RecordCreditorBillDto,
  ) {
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Bill amount must be a positive number');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Bill description is required');
    }
    await this.findOne(creditorId, branchId);

    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.creditorBill.create({
        data: {
          branchId,
          creditorId,
          description: dto.description.trim(),
          amount: dto.amount,
          billDate: dto.billDate ? new Date(dto.billDate) : new Date(),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes ?? null,
          recordedById: staffId,
        },
        include: { recordedBy: { select: { id: true, name: true } } },
      });
      await tx.creditor.update({
        where: { id: creditorId },
        data: { totalDue: { increment: dto.amount } },
      });
      return bill;
    });
  }

  /**
   * Pay a creditor — mirrors SupplierService.makePayment exactly:
   *   1. Insert CreditorPayment row.
   *   2. Decrement Creditor.totalDue.
   *   3. Auto-create an Expense with the creditor's default category.
   *   4. Debit the linked cash/bank Account via accountService.
   */
  async makePayment(
    branchId: string,
    creditorId: string,
    staffId: string,
    dto: MakeCreditorPaymentDto,
  ) {
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be a positive number');
    }
    const creditor = await this.findOne(creditorId, branchId);
    const method = dto.paymentMethod ?? 'CASH';

    const payment = await this.prisma.creditorPayment.create({
      data: {
        branchId,
        creditorId,
        amount: dto.amount,
        paymentMethod: method,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        paidById: staffId,
      },
      include: { paidBy: { select: { id: true, name: true } } },
    });

    await this.prisma.creditor.update({
      where: { id: creditorId },
      data: { totalDue: { decrement: dto.amount } },
    });

    await this.prisma.expense.create({
      data: {
        branchId,
        category: creditor.defaultExpenseCategory,
        description: `Liability payment — ${creditor.name}${dto.reference ? ` (Ref: ${dto.reference})` : ''}`,
        amount: dto.amount,
        paymentMethod: method,
        date: new Date(),
        recordedById: staffId,
        approvedById: staffId,
        approvedAt: new Date(),
      },
    });

    void this.accountService.updateAccountForPayment(
      branchId,
      method,
      dto.amount,
      'EXPENSE',
      `Liability payment — ${creditor.name}`,
    );

    return payment;
  }

  /**
   * Manual ledger correction. Pure ledger-only:
   *   - Adjusts Creditor.totalDue by the signed amount.
   *   - Writes an audit row to CreditorAdjustment for the ledger view.
   *   - Does NOT touch any cash/bank Account.
   *   - Does NOT create an Expense mirror.
   *   - Does NOT post to Mushak / VAT.
   */
  async recordAdjustment(
    branchId: string,
    creditorId: string,
    staffId: string,
    dto: RecordCreditorAdjustmentDto,
  ) {
    if (!Number.isFinite(dto.amount) || dto.amount === 0) {
      throw new BadRequestException('Adjustment amount must be a non-zero number');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Adjustment reason is required');
    }
    await this.findOne(creditorId, branchId);

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.creditorAdjustment.create({
        data: {
          branchId,
          creditorId,
          amount: dto.amount,
          reason: dto.reason.trim(),
          recordedById: staffId,
        },
        include: { recordedBy: { select: { id: true, name: true } } },
      });
      await tx.creditor.update({
        where: { id: creditorId },
        data: { totalDue: { increment: dto.amount } },
      });
      return adjustment;
    });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSupplierDto, UpdateSupplierDto } from '@restora/types';
import { ingredientDisplayName } from '@restora/utils';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';

@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
  ) {}

  async findAll(branchId: string, opts: { cashierVisibleOnly?: boolean } = {}) {
    // Use raw SQL so the visibleToCashier column is always included in the
    // response, even when the generated Prisma client is stale.
    if (opts.cashierVisibleOnly) {
      return this.prisma.$queryRaw`
        SELECT * FROM "suppliers"
        WHERE "branchId" = ${branchId}
          AND "deletedAt" IS NULL
          AND "isActive" = TRUE
          AND "visibleToCashier" = TRUE
        ORDER BY "name" ASC
      `;
    }
    return this.prisma.$queryRaw`
      SELECT * FROM "suppliers"
      WHERE "branchId" = ${branchId}
        AND "deletedAt" IS NULL
      ORDER BY "name" ASC
    `;
  }

  async findOne(id: string, branchId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, branchId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  create(branchId: string, dto: CreateSupplierDto) {
    const { openingBalance, ...rest } = dto;
    const ob = openingBalance ? Math.round(openingBalance) : 0;
    return this.prisma.supplier.create({
      data: { branchId, ...rest, openingBalance: ob, totalDue: ob },
    });
  }

  async update(id: string, branchId: string, dto: UpdateSupplierDto) {
    await this.findOne(id, branchId);

    // Handle visibleToCashier via raw SQL so it works even when the generated
    // Prisma client is stale (column was added to the DB after the API started).
    const { visibleToCashier, ...rest } = dto as UpdateSupplierDto & { visibleToCashier?: boolean };
    if (typeof visibleToCashier === 'boolean') {
      await this.prisma.$executeRaw`
        UPDATE "suppliers"
        SET "visibleToCashier" = ${visibleToCashier}, "updatedAt" = NOW()
        WHERE id = ${id}
      `;
    }

    if (Object.keys(rest).length === 0) {
      return this.findOne(id, branchId);
    }

    return this.prisma.supplier.update({ where: { id }, data: rest });
  }

  async remove(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async getSupplierLedger(id: string, branchId: string) {
    const supplier = await this.findOne(id, branchId);
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: { branchId, supplierId: id, deletedAt: null, status: { in: ['RECEIVED', 'PARTIAL'] } },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch returns for this supplier
    const returns = await this.prisma.purchaseReturn.findMany({
      where: { branchId, supplierId: id, status: 'COMPLETED' },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, packSize: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const payments = await this.prisma.supplierPayment.findMany({
      where: { branchId, supplierId: id },
      include: { paidBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate total billed. Items first, then add any receipt-level
    // extra fees (delivery, labour, etc.) and subtract receipt-level
    // discount the supplier offered at delivery — these are persisted
    // on the PurchaseOrder by purchasing.service.receiveGoods.
    let totalBilled = 0;
    for (const po of purchaseOrders) {
      for (const item of po.items) {
        totalBilled += item.unitCost.toNumber() * item.quantityReceived.toNumber();
      }
      const fees = ((po as unknown as { receiptExtraFees?: Array<{ amount: number }> | null }).receiptExtraFees ?? null);
      if (Array.isArray(fees)) {
        for (const f of fees) {
          if (Number(f?.amount) > 0) totalBilled += Number(f.amount);
        }
      }
      const rawDiscount = (po as unknown as { receiptDiscount?: { toNumber(): number } | number | null }).receiptDiscount;
      const discount = typeof rawDiscount === 'object' && rawDiscount && 'toNumber' in rawDiscount ? rawDiscount.toNumber() : Number(rawDiscount ?? 0);
      if (discount > 0) totalBilled -= Math.min(totalBilled, discount);
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount.toNumber(), 0);
    const totalReturned = returns.reduce((s, r) => r.items.reduce((ss, i) => ss + i.unitPrice.toNumber() * i.quantity.toNumber(), s), 0);
    const openingBalance = supplier.openingBalance.toNumber();

    return {
      supplier,
      openingBalance,
      totalBilled,
      totalPaid,
      totalReturned,
      balance: openingBalance + totalBilled - totalPaid - totalReturned,
      purchaseOrders: purchaseOrders.map((po) => {
        const itemsTotal = po.items.reduce((s, i) => s + i.unitCost.toNumber() * i.quantityReceived.toNumber(), 0);
        const rawDiscount = (po as unknown as { receiptDiscount?: { toNumber(): number } | number | null }).receiptDiscount;
        const discount = typeof rawDiscount === 'object' && rawDiscount && 'toNumber' in rawDiscount ? rawDiscount.toNumber() : Number(rawDiscount ?? 0);
        const discountReason = (po as unknown as { receiptDiscountReason?: string | null }).receiptDiscountReason ?? null;
        const fees = ((po as unknown as { receiptExtraFees?: Array<{ label: string; amount: number }> | null }).receiptExtraFees ?? null);
        const feesArr = Array.isArray(fees) ? fees : [];
        const feesTotal = feesArr.reduce((s, f) => s + Number(f?.amount ?? 0), 0);
        return {
          id: po.id,
          status: po.status,
          createdAt: po.createdAt,
          receivedAt: po.receivedAt,
          items: po.items.map((item) => ({
            id: item.id,
            ingredientName: ingredientDisplayName(item.ingredient),
            unit: item.unit || item.ingredient?.purchaseUnit || item.ingredient?.unit || '',
            quantityOrdered: item.quantityOrdered.toNumber(),
            quantityReceived: item.quantityReceived.toNumber(),
            unitCost: item.unitCost.toNumber(),
            total: item.unitCost.toNumber() * item.quantityReceived.toNumber(),
          })),
          itemsTotal,
          receiptDiscount: discount,
          receiptDiscountReason: discountReason,
          receiptExtraFees: feesArr,
          // Net total — what actually moves the supplier ledger.
          total: Math.max(0, itemsTotal + feesTotal - discount),
        };
      }),
      returns: returns.map((r) => ({
        id: r.id,
        completedAt: r.completedAt,
        items: r.items.map((i) => ({
          ingredientName: ingredientDisplayName(i.ingredient),
          unit: i.ingredient?.purchaseUnit || i.ingredient?.unit || '',
          quantity: i.quantity.toNumber(),
          unitPrice: i.unitPrice.toNumber(),
          total: i.unitPrice.toNumber() * i.quantity.toNumber(),
        })),
        total: r.items.reduce((s, i) => s + i.unitPrice.toNumber() * i.quantity.toNumber(), 0),
      })),
      payments,
    };
  }

  async makePayment(branchId: string, staffId: string, dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    const payment = await this.prisma.supplierPayment.create({
      data: {
        branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        amount: dto.amount,
        paymentMethod: (dto.paymentMethod ?? 'CASH') as any,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        paidById: staffId,
      },
      include: { paidBy: { select: { id: true, name: true } } },
    });

    // Update supplier totalDue
    await this.prisma.supplier.update({
      where: { id: dto.supplierId },
      data: { totalDue: { decrement: dto.amount } },
    });

    // Get supplier name for expense description
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId }, select: { name: true } });

    // Auto-create expense entry
    const method = dto.paymentMethod ?? 'CASH';
    await this.prisma.expense.create({
      data: {
        branchId,
        category: 'FOOD_COST',
        description: `Supplier payment — ${supplier?.name ?? 'Unknown'}${dto.reference ? ` (Ref: ${dto.reference})` : ''}`,
        amount: dto.amount,
        paymentMethod: method,
        date: new Date(),
        recordedById: staffId,
        approvedById: staffId,
        approvedAt: new Date(),
      },
    });

    // Update linked account balance
    void this.accountService.updateAccountForPayment(branchId, method, dto.amount, 'EXPENSE', `Supplier payment — ${supplier?.name ?? 'Unknown'}`);

    return payment;
  }

  async getPayments(branchId: string, supplierId?: string) {
    return this.prisma.supplierPayment.findMany({
      where: { branchId, ...(supplierId ? { supplierId } : {}) },
      include: {
        paidBy: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateAccountDto, AdjustBalanceDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string) {
    return this.prisma.account.findMany({
      where: { branchId },
      orderBy: { type: 'asc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const account = await this.prisma.account.findFirst({ where: { id, branchId } });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  create(branchId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        branchId,
        type: dto.type,
        name: dto.name,
        balance: dto.balance ?? 0,
        showInPOS: dto.showInPOS ?? false,
        linkedPaymentMethod: dto.linkedPaymentMethod ?? null,
      },
    });
  }

  async update(id: string, branchId: string, dto: Partial<CreateAccountDto>) {
    await this.findOne(id, branchId);
    return this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.showInPOS !== undefined ? { showInPOS: dto.showInPOS } : {}),
        ...(dto.linkedPaymentMethod !== undefined ? { linkedPaymentMethod: dto.linkedPaymentMethod } : {}),
      },
    });
  }

  async adjustBalance(id: string, branchId: string, dto: AdjustBalanceDto) {
    await this.findOne(id, branchId);
    return this.prisma.$transaction([
      this.prisma.account.update({
        where: { id },
        data: { balance: { increment: dto.amount } },
      }),
      this.prisma.accountTransaction.create({
        data: {
          branchId,
          accountId: id,
          type: 'ADJUSTMENT',
          amount: dto.amount,
          description: dto.description,
        },
      }),
    ]);
  }

  async transfer(branchId: string, dto: { fromAccountId: string; toAccountId: string; amount: number; description?: string }) {
    if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Cannot transfer to the same account');
    if (dto.amount <= 0) throw new BadRequestException('Transfer amount must be positive');

    const fromAcc = await this.findOne(dto.fromAccountId, branchId);
    const toAcc = await this.findOne(dto.toAccountId, branchId);
    const desc = dto.description || `Transfer: ${fromAcc.name} → ${toAcc.name}`;

    return this.prisma.$transaction([
      this.prisma.account.update({ where: { id: dto.fromAccountId }, data: { balance: { decrement: dto.amount } } }),
      this.prisma.account.update({ where: { id: dto.toAccountId }, data: { balance: { increment: dto.amount } } }),
      this.prisma.accountTransaction.create({
        data: { branchId, accountId: dto.fromAccountId, type: 'TRANSFER', amount: -dto.amount, description: `${desc} (OUT)` },
      }),
      this.prisma.accountTransaction.create({
        data: { branchId, accountId: dto.toAccountId, type: 'TRANSFER', amount: dto.amount, description: `${desc} (IN)` },
      }),
    ]);
  }

  getTransactions(branchId: string, accountId?: string, limit = 100) {
    return this.prisma.accountTransaction.findMany({
      where: { branchId, ...(accountId ? { accountId } : {}) },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getStatement(branchId: string, accountId: string, from: string, to: string) {
    const account = await this.findOne(accountId, branchId);
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Get all transactions in date range, oldest first
    const transactions = await this.prisma.accountTransaction.findMany({
      where: { accountId, createdAt: { gte: fromDate, lte: toDate } },
      orderBy: { createdAt: 'asc' },
    });

    // Opening balance = currentBalance - sum(all transactions from fromDate onwards)
    const txFromOnwards = await this.prisma.accountTransaction.aggregate({
      where: { accountId, createdAt: { gte: fromDate } },
      _sum: { amount: true },
    });
    const openingBalance = account.balance.toNumber() - (txFromOnwards._sum.amount?.toNumber() ?? 0);

    // Build running balance
    let runningBalance = openingBalance;
    const rows = transactions.map((t) => {
      const amount = t.amount.toNumber();
      runningBalance += amount;
      return {
        id: t.id,
        date: t.createdAt,
        type: t.type,
        description: t.description,
        debit: amount < 0 ? Math.abs(amount) : 0,
        credit: amount > 0 ? amount : 0,
        balance: runningBalance,
      };
    });

    return {
      account: { id: account.id, name: account.name, type: account.type },
      period: { from, to },
      openingBalance,
      closingBalance: runningBalance,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
      transactionCount: rows.length,
      rows,
    };
  }

  /**
   * Auto-update the account linked to a payment method.
   * Looks up via: PaymentOption -> Account link, then fallback to old linkedPaymentMethod,
   * then fallback to category default option.
   * SALE increases balance, EXPENSE / PURCHASE_PAYMENT decrease it.
   */
  async updateAccountForPayment(
    branchId: string,
    paymentOptionCode: string,
    amount: number,
    type: 'SALE' | 'EXPENSE' | 'PURCHASE_PAYMENT',
    description: string,
  ) {
    // First try: find via PaymentOption -> Account link
    const option = await this.prisma.paymentOption.findFirst({
      where: { branchId, code: paymentOptionCode, isActive: true },
      select: { accountId: true, categoryId: true },
    });

    let account;
    if (option?.accountId) {
      account = await this.prisma.account.findFirst({ where: { id: option.accountId, isActive: true } });
    }

    // Fallback: find via old linkedPaymentMethod field
    if (!account) {
      account = await this.prisma.account.findFirst({
        where: { branchId, linkedPaymentMethod: paymentOptionCode, isActive: true },
      });
    }

    // Option exists but no accountId of its own — climb to the
    // option's category and try the category's default option /
    // legacy linkedPaymentMethod=<categoryCode>. Lets a "BKASH"
    // expense post against the MFS-linked account when the bKash
    // PaymentOption itself was never linked to an Account.
    if (!account && option?.categoryId) {
      const cat = await this.prisma.paymentMethodConfig.findFirst({
        where: { id: option.categoryId },
        include: { options: { where: { isDefault: true, isActive: true }, select: { accountId: true } } },
      });
      if (cat?.options[0]?.accountId) {
        account = await this.prisma.account.findFirst({ where: { id: cat.options[0].accountId, isActive: true } });
      }
      if (!account && cat) {
        account = await this.prisma.account.findFirst({
          where: { branchId, linkedPaymentMethod: cat.code, isActive: true },
        });
      }
    }

    // Also try category code (e.g., "CASH" when option is "CASH")
    if (!account) {
      const cat = await this.prisma.paymentMethodConfig.findFirst({
        where: { branchId, code: paymentOptionCode },
        include: { options: { where: { isDefault: true, isActive: true }, select: { accountId: true } } },
      });
      if (cat?.options[0]?.accountId) {
        account = await this.prisma.account.findFirst({ where: { id: cat.options[0].accountId, isActive: true } });
      }
    }

    if (!account) return; // No linked account — skip

    // SALE increases balance, everything else decreases
    const delta = type === 'SALE' ? amount : -amount;

    await this.prisma.account.update({
      where: { id: account.id },
      data: { balance: { increment: delta } },
    });

    await this.prisma.accountTransaction.create({
      data: {
        branchId,
        accountId: account.id,
        type,
        amount: delta,
        description,
      },
    });
  }

  /**
   * Undo a prior SALE posting against the account linked to a payment
   * method. Used by the payment-correction flow when the cashier picked
   * the wrong tender and we need to subtract the amount back out before
   * crediting the corrected method. Same lookup chain as
   * updateAccountForPayment so we land on the same account row that was
   * originally credited. Recorded as ADJUSTMENT (the existing
   * TransactionType enum has no REFUND value) with a clear description
   * pointing at the order.
   */
  async reverseSalePosting(
    branchId: string,
    paymentOptionCode: string,
    amount: number,
    description: string,
  ) {
    const option = await this.prisma.paymentOption.findFirst({
      where: { branchId, code: paymentOptionCode, isActive: true },
      select: { accountId: true },
    });

    let account;
    if (option?.accountId) {
      account = await this.prisma.account.findFirst({ where: { id: option.accountId, isActive: true } });
    }

    if (!account) {
      account = await this.prisma.account.findFirst({
        where: { branchId, linkedPaymentMethod: paymentOptionCode, isActive: true },
      });
    }

    if (!account) {
      const cat = await this.prisma.paymentMethodConfig.findFirst({
        where: { branchId, code: paymentOptionCode },
        include: { options: { where: { isDefault: true, isActive: true }, select: { accountId: true } } },
      });
      if (cat?.options[0]?.accountId) {
        account = await this.prisma.account.findFirst({ where: { id: cat.options[0].accountId, isActive: true } });
      }
    }

    if (!account) return;

    await this.prisma.account.update({
      where: { id: account.id },
      data: { balance: { decrement: amount } },
    });

    await this.prisma.accountTransaction.create({
      data: {
        branchId,
        accountId: account.id,
        type: 'ADJUSTMENT',
        amount: -amount,
        description,
      },
    });
  }

  async getPnl(branchId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Revenue from paid orders
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', paidAt: { gte: fromDate, lte: toDate }, deletedAt: null },
      include: { payments: true },
    });

    let totalRevenue = 0;
    const revenueByMethod: Record<string, number> = {};
    for (const o of orders) {
      const amt = o.totalAmount.toNumber();
      totalRevenue += amt;
      if (o.payments && o.payments.length > 0) {
        for (const p of o.payments) {
          revenueByMethod[p.method] = (revenueByMethod[p.method] ?? 0) + p.amount.toNumber();
        }
      } else {
        const m = o.paymentMethod ?? 'CASH';
        revenueByMethod[m] = (revenueByMethod[m] ?? 0) + amt;
      }
    }

    // Expenses
    const expenses = await this.prisma.expense.findMany({
      where: { branchId, deletedAt: null, date: { gte: fromDate, lte: toDate } },
    });
    let totalExpenses = 0;
    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const amt = e.amount.toNumber();
      totalExpenses += amt;
      expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + amt;
    }

    // Purchasing cost
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        branchId,
        status: { in: ['RECEIVED', 'PARTIAL'] },
        updatedAt: { gte: fromDate, lte: toDate },
        deletedAt: null,
      },
      include: { items: true },
    });
    let purchasingCost = 0;
    for (const po of purchaseOrders) {
      for (const item of po.items) {
        purchasingCost += item.unitCost.toNumber() * item.quantityReceived.toNumber();
      }
    }

    // Account balances
    const accounts = await this.prisma.account.findMany({
      where: { branchId, isActive: true },
      orderBy: { type: 'asc' },
    });

    return {
      period: { from, to },
      revenue: { total: totalRevenue, byMethod: revenueByMethod },
      expenses: { total: totalExpenses, byCategory: expenseByCategory },
      purchasingCost,
      grossProfit: totalRevenue - purchasingCost,
      netProfit: totalRevenue - totalExpenses - purchasingCost,
      accounts: accounts.map((a) => ({ name: a.name, type: a.type, balance: a.balance.toNumber() })),
    };
  }
}

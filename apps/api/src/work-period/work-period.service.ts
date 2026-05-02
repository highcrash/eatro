import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface BalancesData {
  opening: Record<string, number>; // accountId → amount in paisa
  closing?: Record<string, number>;
}

// Supplier + salary payments auto-create mirror Expense rows so they show
// up in expense reports. Summing Expense AND SupplierPayment/PayrollPayment
// would double-count them in reconciliation — filter the mirrors out here.
// Matches the descriptions written in supplier.service.makePayment +
// payroll.service.addPayment.
const AUTO_EXPENSE_PREFIXES = ['Supplier payment', 'Salary paid', 'Salary partial'];
const isAutoMirrorExpense = (description: string | null | undefined) =>
  !!description && AUTO_EXPENSE_PREFIXES.some((p) => description.startsWith(p));

@Injectable()
export class WorkPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(branchId: string) {
    return this.prisma.workPeriod.findFirst({
      where: { branchId, endedAt: null },
      include: { startedBy: { select: { id: true, name: true } } },
    });
  }

  /** Fetch the last ended work period so the frontend can pre-fill opening balances */
  async getLastClosing(branchId: string) {
    const last = await this.prisma.workPeriod.findFirst({
      where: { branchId, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: {
        closingCash: true, closingMFS: true, closingCard: true,
        balancesJson: true, endedAt: true,
      },
    });
    if (!last) return null;

    // If we have dynamic balances, return them
    if (last.balancesJson) {
      try {
        const data: BalancesData = JSON.parse(last.balancesJson);
        return {
          closingBalances: data.closing ?? {},
          // Legacy fields for backward compat
          closingCash: last.closingCash?.toNumber() ?? 0,
          closingMFS: last.closingMFS?.toNumber() ?? 0,
          closingCard: last.closingCard?.toNumber() ?? 0,
          endedAt: last.endedAt,
        };
      } catch {
        // Fall through to legacy
      }
    }

    // Legacy fallback
    return {
      closingBalances: {} as Record<string, number>,
      closingCash: last.closingCash?.toNumber() ?? 0,
      closingMFS: last.closingMFS?.toNumber() ?? 0,
      closingCard: last.closingCard?.toNumber() ?? 0,
      endedAt: last.endedAt,
    };
  }

  async start(
    branchId: string,
    staffId: string,
    dto: {
      notes?: string;
      openingBalances?: Record<string, number>;
      // Legacy fields
      openingCash?: number;
      openingMFS?: number;
      openingCard?: number;
    },
  ) {
    const current = await this.getCurrent(branchId);
    if (current) throw new BadRequestException('A work period is already active. End it first.');

    const balancesData: BalancesData = { opening: dto.openingBalances ?? {} };

    return this.prisma.workPeriod.create({
      data: {
        branchId,
        startedById: staffId,
        notes: dto.notes ?? null,
        openingCash: dto.openingCash ?? 0,
        openingMFS: dto.openingMFS ?? 0,
        openingCard: dto.openingCard ?? 0,
        balancesJson: JSON.stringify(balancesData),
      },
      include: { startedBy: { select: { id: true, name: true } } },
    });
  }

  async end(
    branchId: string,
    staffId: string,
    dto: {
      closingBalances?: Record<string, number>;
      // Legacy fields
      closingCash?: number;
      closingMFS?: number;
      closingCard?: number;
    },
  ) {
    const current = await this.getCurrent(branchId);
    if (!current) throw new BadRequestException('No active work period to end.');

    // Calculate expected balances for discrepancy check
    const balances = await this.calculateBalances(current);

    // Merge closing into balancesJson
    let balancesData: BalancesData = { opening: {} };
    if (current.balancesJson) {
      try {
        balancesData = JSON.parse(current.balancesJson);
      } catch {
        // ignore
      }
    }
    balancesData.closing = dto.closingBalances ?? {};

    const updated = await this.prisma.workPeriod.update({
      where: { id: current.id },
      data: {
        endedAt: new Date(),
        endedById: staffId,
        closingCash: dto.closingCash ?? null,
        closingMFS: dto.closingMFS ?? null,
        closingCard: dto.closingCard ?? null,
        balancesJson: JSON.stringify(balancesData),
      },
      include: {
        startedBy: { select: { id: true, name: true } },
        endedBy: { select: { id: true, name: true } },
      },
    });

    // Compute per-account discrepancies
    const discrepancyByAccount: Record<string, number> = {};
    if (dto.closingBalances && balances.expectedByAccount) {
      for (const [accId, actual] of Object.entries(dto.closingBalances)) {
        const expected = balances.expectedByAccount[accId] ?? 0;
        discrepancyByAccount[accId] = expected - actual;
      }
    }

    // Legacy discrepancy
    const discrepancy = {
      cash: dto.closingCash != null ? balances.expected.cash - dto.closingCash : 0,
      mfs: dto.closingMFS != null ? balances.expected.mfs - dto.closingMFS : 0,
      card: dto.closingCard != null ? balances.expected.card - dto.closingCard : 0,
    };

    return { ...updated, discrepancy, discrepancyByAccount };
  }

  /**
   * Build a map from payment method string (CASH, MFS, CARD, or option code)
   * to accountId, using PaymentOption and Account tables.
   */
  private async buildMethodToAccountMap(branchId: string) {
    // Get all payment options with their linked accounts
    const paymentOptions = await this.prisma.paymentOption.findMany({
      where: { branchId, isActive: true },
      select: { code: true, accountId: true, category: { select: { code: true } } },
    });

    // Get accounts with linkedPaymentMethod
    const accounts = await this.prisma.account.findMany({
      where: { branchId, isActive: true, showInPOS: true },
      select: { id: true, linkedPaymentMethod: true },
    });

    // Method code → accountId
    const map: Record<string, string> = {};

    // First: map payment option codes to their account
    for (const opt of paymentOptions) {
      if (opt.accountId) {
        map[opt.code] = opt.accountId;
        // Also map the category code (CASH, MFS, CARD) to the account
        // if no more specific mapping exists
        if (opt.category?.code && !map[opt.category.code]) {
          map[opt.category.code] = opt.accountId;
        }
      }
    }

    // Second: map linkedPaymentMethod on accounts (lower priority fallback)
    for (const acc of accounts) {
      if (acc.linkedPaymentMethod && !map[acc.linkedPaymentMethod]) {
        map[acc.linkedPaymentMethod] = acc.id;
      }
    }

    return map;
  }

  /** Internal helper to calculate balance breakdown for a work period */
  private async calculateBalances(wp: {
    id: string;
    branchId: string;
    startedAt: Date;
    endedAt: Date | null;
    balancesJson?: string | null;
    openingCash: { toNumber(): number } | number;
    openingMFS: { toNumber(): number } | number;
    openingCard: { toNumber(): number } | number;
    closingCash?: { toNumber(): number } | number | null;
    closingMFS?: { toNumber(): number } | number | null;
    closingCard?: { toNumber(): number } | number | null;
  }) {
    const branchId = wp.branchId;
    const from = wp.startedAt;
    const to = wp.endedAt ?? new Date();
    const toNum = (v: { toNumber(): number } | number | null | undefined) =>
      v == null ? 0 : typeof v === 'number' ? v : v.toNumber();

    // Build method → account mapping
    const methodToAccount = await this.buildMethodToAccountMap(branchId);

    // Parse dynamic opening balances
    let openingByAccount: Record<string, number> = {};
    if (wp.balancesJson) {
      try {
        const data: BalancesData = JSON.parse(wp.balancesJson);
        openingByAccount = data.opening ?? {};
      } catch {
        // ignore
      }
    }

    // Sales by payment method
    const orderPayments = await this.prisma.orderPayment.findMany({
      where: { order: { branchId, paidAt: { gte: from, lte: to }, deletedAt: null, status: 'PAID' } },
    });
    const salesByMethod: Record<string, number> = {};
    const salesByAccount: Record<string, number> = {};
    for (const p of orderPayments) {
      salesByMethod[p.method] = (salesByMethod[p.method] ?? 0) + p.amount.toNumber();
      const accId = methodToAccount[p.method];
      if (accId) {
        salesByAccount[accId] = (salesByAccount[accId] ?? 0) + p.amount.toNumber();
      }
    }

    // Expenses by payment method. Mirror rows auto-created for supplier
    // payments + salary payouts are filtered out — the SupplierPayment
    // and PayrollPayment queries below already account for them, so
    // including them here would double-deduct from the expected balance.
    const expenses = await this.prisma.expense.findMany({
      where: { branchId, deletedAt: null, createdAt: { gte: from, lte: to } },
    });
    const expensesByMethod: Record<string, number> = {};
    const expensesByAccount: Record<string, number> = {};
    for (const e of expenses) {
      if (isAutoMirrorExpense(e.description)) continue;
      expensesByMethod[e.paymentMethod] = (expensesByMethod[e.paymentMethod] ?? 0) + e.amount.toNumber();
      const accId = methodToAccount[e.paymentMethod];
      if (accId) {
        expensesByAccount[accId] = (expensesByAccount[accId] ?? 0) + e.amount.toNumber();
      }
    }

    // Supplier payments by method
    const supplierPayments = await this.prisma.supplierPayment.findMany({
      where: { branchId, createdAt: { gte: from, lte: to } },
    });
    const supplierByMethod: Record<string, number> = {};
    const supplierByAccount: Record<string, number> = {};
    for (const p of supplierPayments) {
      supplierByMethod[p.paymentMethod] = (supplierByMethod[p.paymentMethod] ?? 0) + p.amount.toNumber();
      const accId = methodToAccount[p.paymentMethod];
      if (accId) {
        supplierByAccount[accId] = (supplierByAccount[accId] ?? 0) + p.amount.toNumber();
      }
    }

    // Salary (payroll) payments by method
    const salaryPayments = await this.prisma.payrollPayment.findMany({
      where: { payroll: { branchId }, createdAt: { gte: from, lte: to } },
    });
    const salaryByMethod: Record<string, number> = {};
    const salaryByAccount: Record<string, number> = {};
    for (const p of salaryPayments) {
      salaryByMethod[p.paymentMethod] = (salaryByMethod[p.paymentMethod] ?? 0) + p.amount.toNumber();
      const accId = methodToAccount[p.paymentMethod];
      if (accId) {
        salaryByAccount[accId] = (salaryByAccount[accId] ?? 0) + p.amount.toNumber();
      }
    }

    // Inter-account transfers — pulled from AccountTransaction rows
    // tagged TRANSFER. Each transfer creates two rows (one with
    // negative amount on the source, one positive on the destination)
    // so summing the signed amount per account yields the NET delta
    // for that account. Without this, the expected balance was off
    // by every transfer the cashier made between Cash and bKash
    // during the day, mismatching the closing actuals.
    const transferTxns = await this.prisma.accountTransaction.findMany({
      where: { branchId, type: 'TRANSFER', createdAt: { gte: from, lte: to } },
    });
    const transferByAccount: Record<string, number> = {};
    const transferInByAccount: Record<string, number> = {};
    const transferOutByAccount: Record<string, number> = {};
    for (const t of transferTxns) {
      const amt = t.amount.toNumber();
      transferByAccount[t.accountId] = (transferByAccount[t.accountId] ?? 0) + amt;
      if (amt >= 0) {
        transferInByAccount[t.accountId] = (transferInByAccount[t.accountId] ?? 0) + amt;
      } else {
        transferOutByAccount[t.accountId] = (transferOutByAccount[t.accountId] ?? 0) + Math.abs(amt);
      }
    }

    // Per-account expected balances
    const allAccountIds = new Set([
      ...Object.keys(openingByAccount),
      ...Object.values(methodToAccount),
      ...Object.keys(transferByAccount),
    ]);
    const expectedByAccount: Record<string, number> = {};
    for (const accId of allAccountIds) {
      expectedByAccount[accId] =
        (openingByAccount[accId] ?? 0) +
        (salesByAccount[accId] ?? 0) -
        (expensesByAccount[accId] ?? 0) -
        (supplierByAccount[accId] ?? 0) -
        (salaryByAccount[accId] ?? 0) +
        (transferByAccount[accId] ?? 0);
    }

    // Parse dynamic closing balances
    let closingByAccount: Record<string, number | null> = {};
    if (wp.balancesJson) {
      try {
        const data: BalancesData = JSON.parse(wp.balancesJson);
        if (data.closing) {
          closingByAccount = data.closing;
        }
      } catch {
        // ignore
      }
    }

    // Discrepancy per account
    const discrepancyByAccount: Record<string, number> = {};
    for (const accId of allAccountIds) {
      const closing = closingByAccount[accId];
      if (closing != null) {
        discrepancyByAccount[accId] = (expectedByAccount[accId] ?? 0) - closing;
      }
    }

    // Legacy fields
    const opening = {
      cash: toNum(wp.openingCash),
      mfs: toNum(wp.openingMFS),
      card: toNum(wp.openingCard),
    };

    const expected = {
      cash: opening.cash + (salesByMethod['CASH'] ?? 0) - (expensesByMethod['CASH'] ?? 0) - (supplierByMethod['CASH'] ?? 0) - (salaryByMethod['CASH'] ?? 0),
      mfs: opening.mfs + (salesByMethod['MFS'] ?? 0) - (expensesByMethod['MFS'] ?? 0) - (supplierByMethod['MFS'] ?? 0) - (salaryByMethod['MFS'] ?? 0),
      card: opening.card + (salesByMethod['CARD'] ?? 0) - (expensesByMethod['CARD'] ?? 0) - (supplierByMethod['CARD'] ?? 0) - (salaryByMethod['CARD'] ?? 0),
    };

    const closingCash = toNum(wp.closingCash);
    const closingMFS = toNum(wp.closingMFS);
    const closingCard = toNum(wp.closingCard);

    return {
      opening,
      salesByMethod,
      expensesByMethod,
      supplierPaymentsByMethod: supplierByMethod,
      salaryPaymentsByMethod: salaryByMethod,
      expected,
      closing: {
        cash: wp.closingCash != null ? closingCash : null,
        mfs: wp.closingMFS != null ? closingMFS : null,
        card: wp.closingCard != null ? closingCard : null,
      },
      discrepancy: {
        cash: wp.closingCash != null ? expected.cash - closingCash : 0,
        mfs: wp.closingMFS != null ? expected.mfs - closingMFS : 0,
        card: wp.closingCard != null ? expected.card - closingCard : 0,
      },
      // Dynamic per-account data
      openingByAccount,
      salesByAccount,
      expensesByAccount,
      supplierByAccount,
      salaryByAccount,
      transferByAccount,
      transferInByAccount,
      transferOutByAccount,
      expectedByAccount,
      closingByAccount,
      discrepancyByAccount,
    };
  }

  async getSummary(branchId: string, workPeriodId: string) {
    const wp = await this.prisma.workPeriod.findFirst({ where: { id: workPeriodId, branchId } });
    if (!wp) throw new BadRequestException('Work period not found');

    const from = wp.startedAt;
    const to = wp.endedAt ?? new Date();

    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', paidAt: { gte: from, lte: to }, deletedAt: null },
      include: { payments: true },
    });

    // Drop the mirror Expense rows auto-created by supplier + salary
    // payouts so totals + category charts in the Z-report don't inflate
    // the "Expenses" line by the same amount that already shows under
    // "Supplier payments" and "Salary payments".
    const expenses = (await this.prisma.expense.findMany({
      where: { branchId, deletedAt: null, createdAt: { gte: from, lte: to } },
    })).filter((e) => !isAutoMirrorExpense(e.description));

    // Breakdown by payment method
    const byPaymentMethod: Record<string, number> = {};
    for (const o of orders) {
      if (o.payments && o.payments.length > 0) {
        for (const p of o.payments) {
          byPaymentMethod[p.method] = (byPaymentMethod[p.method] ?? 0) + p.amount.toNumber();
        }
      } else {
        const m = o.paymentMethod ?? 'CASH';
        byPaymentMethod[m] = (byPaymentMethod[m] ?? 0) + o.totalAmount.toNumber();
      }
    }

    // Breakdown by order type
    const byOrderType: Record<string, { count: number; total: number }> = {};
    for (const o of orders) {
      if (!byOrderType[o.type]) byOrderType[o.type] = { count: 0, total: 0 };
      byOrderType[o.type].count++;
      byOrderType[o.type].total += o.totalAmount.toNumber();
    }

    // Expense breakdown by category
    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + e.amount.toNumber();
    }

    // Voided orders
    const voidedOrders = await this.prisma.order.count({
      where: { branchId, status: 'VOID', voidedAt: { gte: from, lte: to }, deletedAt: null },
    });

    // ── Consumed ingredients (SALE-type stock movements) ───────────────────
    // SALE movements are recorded with negative quantity (deduction).
    // We aggregate by ingredient and use abs() so the displayed value is positive.
    const saleMovements = await this.prisma.stockMovement.findMany({
      where: { branchId, type: 'SALE', createdAt: { gte: from, lte: to } },
      include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } },
    });
    type Agg = { id: string; name: string; unit: string; quantity: number; value: number };
    const consumedMap = new Map<string, Agg>();
    for (const mv of saleMovements) {
      if (!mv.ingredient) continue;
      const qty = Math.abs(mv.quantity.toNumber());
      const cost = mv.ingredient.costPerUnit.toNumber();
      const existing = consumedMap.get(mv.ingredientId);
      if (existing) {
        existing.quantity += qty;
        existing.value += qty * cost;
      } else {
        consumedMap.set(mv.ingredientId, {
          id: mv.ingredient.id,
          name: mv.ingredient.name,
          unit: mv.ingredient.unit,
          quantity: qty,
          value: qty * cost,
        });
      }
    }
    const consumedItems = Array.from(consumedMap.values()).sort((a, b) => b.value - a.value);
    const consumedTotalValue = consumedItems.reduce((s, i) => s + i.value, 0);

    // ── Wasted ingredients (WasteLog within the period) ───────────────────
    const wasteLogs = await this.prisma.wasteLog.findMany({
      where: { branchId, createdAt: { gte: from, lte: to } },
      include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } },
    });
    const wasteMap = new Map<string, Agg>();
    for (const w of wasteLogs) {
      if (!w.ingredient) continue;
      const qty = w.quantity.toNumber();
      const cost = w.ingredient.costPerUnit.toNumber();
      const existing = wasteMap.get(w.ingredientId);
      if (existing) {
        existing.quantity += qty;
        existing.value += qty * cost;
      } else {
        wasteMap.set(w.ingredientId, {
          id: w.ingredient.id,
          name: w.ingredient.name,
          unit: w.ingredient.unit,
          quantity: qty,
          value: qty * cost,
        });
      }
    }
    const wasteItems = Array.from(wasteMap.values()).sort((a, b) => b.value - a.value);
    const wasteTotalValue = wasteItems.reduce((s, i) => s + i.value, 0);

    // Balance tracking
    const balances = await this.calculateBalances(wp);

    // Fetch POS accounts info for the summary response
    const posAccounts = await this.prisma.account.findMany({
      where: { branchId, isActive: true, showInPOS: true },
      select: { id: true, name: true, type: true, linkedPaymentMethod: true },
      orderBy: { createdAt: 'asc' },
    });

    // Tax block for the Z-report: gross subtotal (pre-tax), discounts,
    // service charge, VAT, and net. Only PAID orders contribute — VOIDs
    // and still-open tickets are excluded from tax liability.
    const paidOrders = orders.filter((o) => o.status === 'PAID');
    const taxBreakdown = {
      subtotal: paidOrders.reduce((s, o) => s + o.subtotal.toNumber(), 0),
      discountTotal: paidOrders.reduce((s, o) => s + o.discountAmount.toNumber(), 0),
      // Both fields exist on newer rows; older rows return 0 from @default.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceChargeTotal: paidOrders.reduce((s, o) => s + Number((o as any).serviceChargeAmount ?? 0), 0),
      vatTotal: paidOrders.reduce((s, o) => s + o.taxAmount.toNumber(), 0),
      netSales: paidOrders.reduce((s, o) => s + o.totalAmount.toNumber(), 0),
    };

    // Supplier + salary payments are kept SEPARATE from totalExpenses to
    // avoid double-counting against the auto-mirror Expense rows the
    // category breakdown filters out. Surface their aggregates so the
    // daily report can show them as their own tiles + Z-report rows —
    // without them the cashier saw "Total Expenses: 0" on a day with
    // huge supplier payouts and concluded supplier bills weren't being
    // tracked.
    const totalSupplierPayments = Object.values(balances.supplierByAccount ?? {}).reduce((s, n) => s + n, 0);
    const totalSalaryPayments = Object.values(balances.salaryByAccount ?? {}).reduce((s, n) => s + n, 0);

    return {
      workPeriod: wp,
      totalSales: orders.reduce((s, o) => s + o.totalAmount.toNumber(), 0),
      orderCount: orders.length,
      voidedOrders,
      byPaymentMethod,
      byOrderType,
      totalExpenses: expenses.reduce((s, e) => s + e.amount.toNumber(), 0),
      expenseCount: expenses.length,
      expenseByCategory,
      totalSupplierPayments,
      totalSalaryPayments,
      taxBreakdown,
      balances,
      posAccounts,
      consumedItems,
      consumedTotalValue,
      wasteItems,
      wasteTotalValue,
    };
  }

  findAll(branchId: string, from?: string, to?: string) {
    const where: { branchId: string; startedAt?: { gte?: Date; lte?: Date } } = { branchId };
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.startedAt.lte = end;
      }
    }
    return this.prisma.workPeriod.findMany({
      where,
      include: {
        startedBy: { select: { id: true, name: true } },
        endedBy: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 365,
    });
  }
}

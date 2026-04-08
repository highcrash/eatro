import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalesDetail(branchId: string, from?: string, to?: string) {
    const now = new Date();
    let dateFrom: Date;
    let dateTo: Date;

    if (!from && !to) {
      // Today
      dateFrom = new Date(now);
      dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(now);
      dateTo.setHours(23, 59, 59, 999);
    } else {
      dateFrom = new Date(from || now.toISOString().split('T')[0]);
      dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(to || now.toISOString().split('T')[0]);
      dateTo.setHours(23, 59, 59, 999);
    }

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'PAID',
        deletedAt: null,
        paidAt: { gte: dateFrom, lte: dateTo },
      },
      include: {
        items: { where: { voidedAt: null } },
        payments: true,
      },
      orderBy: { paidAt: 'asc' },
    });

    return {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        paidAt: o.paidAt,
        createdAt: o.createdAt,
        type: o.type,
        tableNumber: o.tableNumber,
        items: o.items.map((i) => ({
          name: i.menuItemName,
          quantity: i.quantity,
          total: Number(i.totalPrice),
        })),
        subtotal: Number(o.subtotal),
        discountAmount: Number(o.discountAmount),
        taxAmount: Number(o.taxAmount),
        totalAmount: Number(o.totalAmount),
        paymentMethod: o.payments.map((p) => p.method).join(', ') || o.paymentMethod || 'N/A',
      })),
    };
  }

  private getDateRange(period: string): DateRange {
    const now = new Date();
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);

    const from = new Date(now);
    from.setHours(0, 0, 0, 0);

    if (period === 'week') {
      from.setDate(from.getDate() - 6);
    } else if (period === 'month') {
      from.setDate(1);
    } else if (period === 'year') {
      from.setMonth(0, 1);
    }

    return { from, to };
  }

  async getSalesSummary(branchId: string, period: string) {
    const { from, to } = this.getDateRange(period);

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'PAID',
        paidAt: { gte: from, lte: to },
        deletedAt: null,
      },
      include: { items: true },
    });

    const totalRevenue = orders.reduce((s, o) => s + o.totalAmount.toNumber(), 0);
    const totalTax = orders.reduce((s, o) => s + o.taxAmount.toNumber(), 0);
    const totalSubtotal = orders.reduce((s, o) => s + o.subtotal.toNumber(), 0);
    const totalDiscount = orders.reduce((s, o) => s + o.discountAmount.toNumber(), 0);
    const orderCount = orders.length;
    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Payment method breakdown
    const byPaymentMethod: Record<string, number> = {};
    for (const order of orders) {
      const method = order.paymentMethod ?? 'UNKNOWN';
      byPaymentMethod[method] = (byPaymentMethod[method] ?? 0) + order.totalAmount.toNumber();
    }

    // Order type breakdown
    const byOrderType: Record<string, number> = {};
    for (const order of orders) {
      byOrderType[order.type] = (byOrderType[order.type] ?? 0) + order.totalAmount.toNumber();
    }

    // Voided orders count and value
    const voidedOrders = await this.prisma.order.count({
      where: {
        branchId,
        status: 'VOID',
        voidedAt: { gte: from, lte: to },
        deletedAt: null,
      },
    });

    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      orderCount,
      voidedOrders,
      totalRevenue,
      totalSubtotal,
      totalTax,
      totalDiscount,
      averageOrderValue,
      byPaymentMethod,
      byOrderType,
    };
  }

  async getTopItems(branchId: string, period: string, limit = 10) {
    const { from, to } = this.getDateRange(period);

    const items = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'menuItemName'],
      where: {
        order: {
          branchId,
          status: 'PAID',
          paidAt: { gte: from, lte: to },
          deletedAt: null,
        },
        voidedAt: null,
      },
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: limit,
    });

    return items.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.menuItemName,
      totalQuantity: item._sum.quantity ?? 0,
      totalRevenue: Number(item._sum.totalPrice ?? 0),
    }));
  }

  async getRevenueByCategory(branchId: string, period: string) {
    const { from, to } = this.getDateRange(period);

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          branchId,
          status: 'PAID',
          paidAt: { gte: from, lte: to },
          deletedAt: null,
        },
        voidedAt: null,
      },
      include: {
        menuItem: { include: { category: true } },
      },
    });

    const byCategory: Record<string, { name: string; revenue: number; quantity: number }> = {};
    for (const item of items) {
      const cat = item.menuItem.category;
      if (!byCategory[cat.id]) {
        byCategory[cat.id] = { name: cat.name, revenue: 0, quantity: 0 };
      }
      byCategory[cat.id].revenue += item.totalPrice.toNumber();
      byCategory[cat.id].quantity += item.quantity;
    }

    return Object.entries(byCategory)
      .map(([id, data]) => ({ categoryId: id, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getDailySales(branchId: string, days = 30) {
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'PAID',
        paidAt: { gte: from, lte: to },
        deletedAt: null,
      },
      select: { paidAt: true, totalAmount: true, orderNumber: true },
      orderBy: { paidAt: 'asc' },
    });

    // Group by date
    const byDate: Record<string, { revenue: number; orders: number }> = {};
    for (const order of orders) {
      const dateKey = order.paidAt!.toISOString().split('T')[0];
      if (!byDate[dateKey]) byDate[dateKey] = { revenue: 0, orders: 0 };
      byDate[dateKey].revenue += order.totalAmount.toNumber();
      byDate[dateKey].orders += 1;
    }

    // Fill in missing days with zeros
    const result = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dateKey = cursor.toISOString().split('T')[0];
      result.push({
        date: dateKey,
        revenue: byDate[dateKey]?.revenue ?? 0,
        orders: byDate[dateKey]?.orders ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  async getStockReport(branchId: string) {
    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null },
      include: { supplier: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const items = ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      itemCode: i.itemCode,
      category: i.category,
      unit: i.unit,
      currentStock: i.currentStock.toNumber(),
      minimumStock: i.minimumStock.toNumber(),
      costPerUnit: i.costPerUnit.toNumber(),
      stockValue: i.currentStock.toNumber() * i.costPerUnit.toNumber(),
      supplierName: i.supplier?.name ?? null,
      isLow: i.currentStock.toNumber() <= i.minimumStock.toNumber(),
    }));

    const totalValue = items.reduce((s, i) => s + i.stockValue, 0);
    const lowStockCount = items.filter((i) => i.isLow).length;

    return { totalValue, totalItems: items.length, lowStockCount, items };
  }

  async getMonthlyStockReport(branchId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const movements = await this.prisma.stockMovement.findMany({
      where: { branchId, createdAt: { gte: from, lte: to } },
      include: { ingredient: { select: { name: true, unit: true } } },
    });

    const byIngredient: Record<string, { name: string; unit: string; consumed: number; received: number; adjusted: number }> = {};
    for (const m of movements) {
      const key = m.ingredientId;
      if (!byIngredient[key]) {
        byIngredient[key] = { name: m.ingredient.name, unit: m.ingredient.unit, consumed: 0, received: 0, adjusted: 0 };
      }
      const qty = m.quantity.toNumber();
      if (m.type === 'SALE' || m.type === 'WASTE') byIngredient[key].consumed += Math.abs(qty);
      else if (m.type === 'PURCHASE' || m.type === 'VOID_RETURN') byIngredient[key].received += qty;
      else byIngredient[key].adjusted += qty;
    }

    return {
      period: { year, month },
      items: Object.entries(byIngredient).map(([id, data]) => ({ ingredientId: id, ...data })),
      totalMovements: movements.length,
    };
  }

  async getDailyConsumption(branchId: string, date: string) {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);

    const movements = await this.prisma.stockMovement.findMany({
      where: { branchId, createdAt: { gte: from, lte: to } },
      include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } },
    });

    const byIngredient: Record<string, { name: string; unit: string; costPerUnit: number; consumed: number; received: number; wasted: number }> = {};
    for (const m of movements) {
      const key = m.ingredientId;
      if (!byIngredient[key]) {
        byIngredient[key] = {
          name: m.ingredient.name,
          unit: m.ingredient.unit,
          costPerUnit: m.ingredient.costPerUnit.toNumber(),
          consumed: 0, received: 0, wasted: 0,
        };
      }
      const qty = Math.abs(m.quantity.toNumber());
      if (m.type === 'SALE') byIngredient[key].consumed += qty;
      else if (m.type === 'WASTE') byIngredient[key].wasted += qty;
      else if (m.type === 'PURCHASE' || m.type === 'VOID_RETURN') byIngredient[key].received += qty;
    }

    const items = Object.entries(byIngredient).map(([id, data]) => ({
      ingredientId: id,
      ...data,
      consumedValue: data.consumed * data.costPerUnit,
      wastedValue: data.wasted * data.costPerUnit,
    }));

    return {
      date,
      items: items.sort((a, b) => b.consumedValue - a.consumedValue),
      totalConsumedValue: items.reduce((s, i) => s + i.consumedValue, 0),
      totalWastedValue: items.reduce((s, i) => s + i.wastedValue, 0),
      totalMovements: movements.length,
    };
  }

  async getSalesVsFoodCost(branchId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', paidAt: { gte: fromDate, lte: toDate }, deletedAt: null },
      include: { items: { where: { voidedAt: null }, include: { menuItem: { include: { recipe: { include: { items: { include: { ingredient: true } } } } } } } } },
    });

    let totalSales = 0;
    let totalFoodCost = 0;

    for (const order of orders) {
      totalSales += order.totalAmount.toNumber();
      for (const item of order.items) {
        if (item.menuItem.recipe) {
          for (const ri of item.menuItem.recipe.items) {
            totalFoodCost += ri.ingredient.costPerUnit.toNumber() * ri.quantity.toNumber() * item.quantity;
          }
        }
      }
    }

    const grossProfit = totalSales - totalFoodCost;
    const foodCostPercentage = totalSales > 0 ? (totalFoodCost / totalSales) * 100 : 0;

    return {
      period: { from, to },
      totalSales,
      totalFoodCost,
      grossProfit,
      foodCostPercentage: Math.round(foodCostPercentage * 100) / 100,
      orderCount: orders.length,
    };
  }

  async getDateRangeSales(branchId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    return this.getDailySales(branchId, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }

  async getWaiterReport(branchId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'PAID',
        paidAt: { gte: fromDate, lte: toDate },
        deletedAt: null,
        waiterId: { not: null },
      },
      include: { waiter: { select: { id: true, name: true } } },
    });

    const byWaiter: Record<string, { name: string; orders: number; revenue: number }> = {};
    for (const o of orders) {
      const wId = o.waiterId!;
      if (!byWaiter[wId]) byWaiter[wId] = { name: (o as any).waiter?.name ?? 'Unknown', orders: 0, revenue: 0 };
      byWaiter[wId].orders++;
      byWaiter[wId].revenue += o.totalAmount.toNumber();
    }

    return Object.entries(byWaiter)
      .map(([id, data]) => ({ waiterId: id, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getPurchasingSummary(branchId: string, period: string) {
    const { from, to } = this.getDateRange(period);

    const receivedPOs = await this.prisma.purchaseOrder.findMany({
      where: {
        branchId,
        status: { in: ['RECEIVED', 'PARTIAL'] },
        receivedAt: { gte: from, lte: to },
        deletedAt: null,
      },
      include: { items: true },
    });

    const totalSpent = receivedPOs.reduce((s, po) => {
      return s + po.items.reduce((ps, item) => {
        return ps + item.unitCost.toNumber() * item.quantityReceived.toNumber();
      }, 0);
    }, 0);

    return {
      purchaseOrderCount: receivedPOs.length,
      totalSpent,
    };
  }
}

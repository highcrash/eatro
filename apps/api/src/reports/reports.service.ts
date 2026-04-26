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

  /**
   * Items-Sold report — every paid line in the period, aggregated by
   * (menuItemId, unitPrice). Distinct unit prices stay in their own
   * row so a discounted line and a full-price line of the same item
   * print as two rows on the receipt-style report ("qty × name × unit
   * = total"). Defaults to today when from/to are both omitted.
   */
  async getItemsSold(branchId: string, from?: string, to?: string) {
    const now = new Date();
    let dateFrom: Date;
    let dateTo: Date;

    if (!from && !to) {
      dateFrom = new Date(now); dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(now); dateTo.setHours(23, 59, 59, 999);
    } else {
      dateFrom = new Date(from || now.toISOString().split('T')[0]);
      dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(to || now.toISOString().split('T')[0]);
      dateTo.setHours(23, 59, 59, 999);
    }

    const items = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'menuItemName', 'unitPrice'],
      where: {
        order: {
          branchId,
          status: 'PAID',
          paidAt: { gte: dateFrom, lte: dateTo },
          deletedAt: null,
        },
        voidedAt: null,
      },
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
    });

    const rows = items.map((it) => ({
      menuItemId: it.menuItemId,
      name: it.menuItemName,
      unitPrice: Number(it.unitPrice),
      quantity: Number(it._sum.quantity ?? 0),
      totalRevenue: Number(it._sum.totalPrice ?? 0),
    }));

    const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);

    return {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      rows,
      totals: { quantity: totalQty, revenue: totalRevenue },
    };
  }

  /**
   * Performance Report — per-menu-item qty / revenue / COGS / gross profit
   * / margin% over a date range, plus a category roll-up and an inventory
   * price-volatility panel. Defaults to today when both from + to are
   * omitted (mirrors getSalesDetail). COGS computation walks each item's
   * Recipe and falls back to the cheapest active variant's cost when the
   * parent ingredient has cost = 0 (matches the pre-ready cost helper).
   */
  async getPerformanceReport(branchId: string, from?: string, to?: string) {
    const now = new Date();
    let dateFrom: Date;
    let dateTo: Date;

    if (!from && !to) {
      dateFrom = new Date(now); dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(now); dateTo.setHours(23, 59, 59, 999);
    } else {
      dateFrom = new Date(from || now.toISOString().split('T')[0]);
      dateFrom.setHours(0, 0, 0, 0);
      dateTo = new Date(to || now.toISOString().split('T')[0]);
      dateTo.setHours(23, 59, 59, 999);
    }

    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        order: { branchId, status: 'PAID', paidAt: { gte: dateFrom, lte: dateTo }, deletedAt: null },
        voidedAt: null,
      },
      include: {
        menuItem: {
          include: {
            category: true,
            recipe: { include: { items: { include: { ingredient: true } } } },
          },
        },
      },
    });

    // Variant-fallback cost lookup. Cache cheapest-variant cost per parent
    // so the per-item pass doesn't re-query for repeated ingredients.
    const variantCostCache = new Map<string, number>();
    const resolveCost = async (ingredientId: string, parentCost: number, hasVariants: boolean): Promise<number> => {
      if (parentCost > 0 || !hasVariants) return parentCost;
      if (variantCostCache.has(ingredientId)) return variantCostCache.get(ingredientId)!;
      const variants = await this.prisma.ingredient.findMany({
        where: { parentId: ingredientId, isActive: true, deletedAt: null },
        select: { costPerUnit: true },
      });
      const positives = variants.map((v) => v.costPerUnit.toNumber()).filter((c) => c > 0);
      const cost = positives.length > 0 ? Math.min(...positives) : 0;
      variantCostCache.set(ingredientId, cost);
      return cost;
    };

    interface ItemAgg {
      menuItemId: string;
      name: string;
      categoryId: string;
      categoryName: string;
      quantity: number;
      revenue: number;
      cogs: number;
    }
    const byItem = new Map<string, ItemAgg>();

    for (const oi of orderItems) {
      const mi = oi.menuItem;
      const cat = mi.category;
      let agg = byItem.get(mi.id);
      if (!agg) {
        agg = {
          menuItemId: mi.id,
          name: mi.name,
          categoryId: cat.id,
          categoryName: cat.name,
          quantity: 0,
          revenue: 0,
          cogs: 0,
        };
        byItem.set(mi.id, agg);
      }
      agg.quantity += oi.quantity;
      agg.revenue += oi.totalPrice.toNumber();

      // Per-unit recipe cost — sum(recipeItem.qty × ingredient.costPerUnit).
      // Note: we don't apply unit conversions here. Recipes that store the
      // recipe-line in the ingredient's native unit (the common case) are
      // exact; mismatched units return an under-counted cost rather than
      // a hard failure, which is the right tradeoff for a report.
      if (mi.recipe) {
        let unitCost = 0;
        for (const ri of mi.recipe.items) {
          const ing = ri.ingredient;
          const cost = await resolveCost(ing.id, ing.costPerUnit.toNumber(), ing.hasVariants ?? false);
          unitCost += ri.quantity.toNumber() * cost;
        }
        agg.cogs += unitCost * oi.quantity;
      }
    }

    const items = [...byItem.values()].map((a) => {
      const grossProfit = a.revenue - a.cogs;
      const marginPct = a.revenue > 0 && a.cogs > 0 ? (grossProfit / a.revenue) * 100 : null;
      return {
        menuItemId: a.menuItemId,
        name: a.name,
        categoryId: a.categoryId,
        categoryName: a.categoryName,
        quantity: a.quantity,
        revenue: a.revenue,
        cogs: a.cogs,
        grossProfit,
        marginPct,
      };
    }).sort((x, y) => y.revenue - x.revenue);

    // Category roll-up.
    const byCat = new Map<string, { id: string; name: string; quantity: number; revenue: number; cogs: number }>();
    for (const i of items) {
      let c = byCat.get(i.categoryId);
      if (!c) {
        c = { id: i.categoryId, name: i.categoryName, quantity: 0, revenue: 0, cogs: 0 };
        byCat.set(i.categoryId, c);
      }
      c.quantity += i.quantity;
      c.revenue += i.revenue;
      c.cogs += i.cogs;
    }
    const categories = [...byCat.values()].map((c) => {
      const grossProfit = c.revenue - c.cogs;
      const marginPct = c.revenue > 0 && c.cogs > 0 ? (grossProfit / c.revenue) * 100 : null;
      return {
        categoryId: c.id,
        categoryName: c.name,
        quantity: c.quantity,
        revenue: c.revenue,
        cogs: c.cogs,
        grossProfit,
        marginPct,
      };
    }).sort((x, y) => y.revenue - x.revenue);

    // Inventory price volatility — group purchase_order_items by ingredient
    // over the date range, surface only those with > 1 distinct unitCost.
    const purchaseRows = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: { branchId, deletedAt: null },
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      // PurchaseOrderItem.unitCost is denominated in the supplier's
      // PURCHASE unit, not the stock unit. We need both unit + purchase
      // unit + purchaseUnitQty to render the column truthfully and to
      // derive a per-stock-unit price if the UI wants one.
      include: { ingredient: { select: { id: true, name: true, unit: true, purchaseUnit: true, purchaseUnitQty: true } } },
      orderBy: { createdAt: 'desc' },
    });

    interface PriceAgg {
      ingredientId: string;
      ingredientName: string;
      stockUnit: string;
      purchaseUnit: string;
      purchaseUnitQty: number;
      prices: Set<number>;
      sum: number;
      min: number;
      max: number;
      count: number;
      latest: number;
    }
    const byIng = new Map<string, PriceAgg>();
    for (const r of purchaseRows) {
      const cost = r.unitCost.toNumber();
      const id = r.ingredientId;
      let p = byIng.get(id);
      if (!p) {
        const stockUnit = r.ingredient.unit;
        // Fall back to stockUnit when admin never set a purchase unit
        // — at least the displayed label is consistent with the cost
        // figure (which equals per-stock-unit cost in that case).
        const purchaseUnit = r.ingredient.purchaseUnit?.trim() || stockUnit;
        const qty = r.ingredient.purchaseUnitQty?.toNumber() ?? 1;
        p = {
          ingredientId: id,
          ingredientName: r.ingredient.name,
          stockUnit,
          purchaseUnit,
          purchaseUnitQty: qty > 0 ? qty : 1,
          prices: new Set(),
          sum: 0,
          min: cost,
          max: cost,
          count: 0,
          latest: cost, // first row in DESC order = latest
        };
        byIng.set(id, p);
      }
      p.prices.add(cost);
      p.sum += cost;
      if (cost < p.min) p.min = cost;
      if (cost > p.max) p.max = cost;
      p.count += 1;
    }
    const inventoryVolatility = [...byIng.values()]
      .filter((p) => p.prices.size >= 2)
      .map((p) => ({
        ingredientId: p.ingredientId,
        ingredientName: p.ingredientName,
        // `unit` retained for backwards compat with any older client
        // bundles that haven't reloaded; new fields below are the
        // truthful labels.
        unit: p.purchaseUnit,
        stockUnit: p.stockUnit,
        purchaseUnit: p.purchaseUnit,
        purchaseUnitQty: p.purchaseUnitQty,
        distinctPrices: p.prices.size,
        minUnitCost: p.min,
        maxUnitCost: p.max,
        avgUnitCost: p.sum / p.count,
        latestUnitCost: p.latest,
        deliveries: p.count,
      }))
      .sort((a, b) => (b.maxUnitCost - b.minUnitCost) - (a.maxUnitCost - a.minUnitCost));

    // Suggested margin% = average of marginPct across items where cogs > 0.
    const margins = items.map((i) => i.marginPct).filter((m): m is number => m !== null && m > 0);
    const suggestedCustomMenuMargin = margins.length > 0
      ? Math.round((margins.reduce((s, m) => s + m, 0) / margins.length) * 100) / 100
      : null;

    return {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      items,
      categories,
      inventoryVolatility,
      suggestedCustomMenuMargin,
    };
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
      // minimumStock=0 means the owner hasn't set a reorder threshold;
      // never flag those items as low even if currentStock is 0.
      isLow: i.minimumStock.toNumber() > 0 && i.currentStock.toNumber() <= i.minimumStock.toNumber(),
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
      include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true, category: true } } },
    });

    const byIngredient: Record<string, { name: string; unit: string; costPerUnit: number; category: string; consumed: number; received: number; wasted: number; suppliesUsed: number }> = {};
    for (const m of movements) {
      const key = m.ingredientId;
      if (!byIngredient[key]) {
        byIngredient[key] = {
          name: m.ingredient.name,
          unit: m.ingredient.unit,
          costPerUnit: m.ingredient.costPerUnit.toNumber(),
          category: m.ingredient.category,
          consumed: 0, received: 0, wasted: 0, suppliesUsed: 0,
        };
      }
      const qty = Math.abs(m.quantity.toNumber());
      if (m.type === 'SALE') byIngredient[key].consumed += qty;
      else if (m.type === 'WASTE') byIngredient[key].wasted += qty;
      else if (m.type === 'OPERATIONAL_USE') byIngredient[key].suppliesUsed += qty;
      else if (m.type === 'PURCHASE' || m.type === 'VOID_RETURN') byIngredient[key].received += qty;
    }

    const items = Object.entries(byIngredient).map(([id, data]) => ({
      ingredientId: id,
      ...data,
      consumedValue: data.consumed * data.costPerUnit,
      wastedValue: data.wasted * data.costPerUnit,
      suppliesUsedValue: data.suppliesUsed * data.costPerUnit,
    }));

    // SUPPLY ingredients are reported separately so packaging spend
    // doesn't pollute the food-cost margin. The Supplies report on
    // /reports/supplies surfaces the same numbers in detail.
    const foodItems = items.filter((i) => i.category !== 'SUPPLY');
    const supplyItems = items.filter((i) => i.category === 'SUPPLY');

    return {
      date,
      items: foodItems.sort((a, b) => b.consumedValue - a.consumedValue),
      totalConsumedValue: foodItems.reduce((s, i) => s + i.consumedValue, 0),
      totalWastedValue: foodItems.reduce((s, i) => s + i.wastedValue, 0),
      suppliesItems: supplyItems.sort((a, b) => b.suppliesUsedValue - a.suppliesUsedValue),
      totalSuppliesUsedValue: supplyItems.reduce((s, i) => s + i.suppliesUsedValue, 0),
      totalMovements: movements.length,
    };
  }

  /**
   * Supplies report — one row per SUPPLY-category ingredient over a
   * date window. Surfaces purchase total, manual usage (the
   * OPERATIONAL_USE log), waste, on-hand value, and a trailing 30-day
   * burn rate so owners can see days-of-cover at a glance.
   */
  async getSuppliesReport(branchId: string, from: string, to: string) {
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const supplies = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, category: 'SUPPLY' },
      select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true },
    });

    if (supplies.length === 0) {
      return {
        rows: [],
        totals: { purchasedCost: 0, usedQty: 0, onHandValue: 0 },
        windowFrom: fromDate.toISOString(),
        windowTo: toDate.toISOString(),
      };
    }

    const supplyIds = supplies.map((s) => s.id);
    const movements = await this.prisma.stockMovement.findMany({
      where: { branchId, ingredientId: { in: supplyIds }, createdAt: { gte: fromDate, lte: toDate } },
      select: { ingredientId: true, type: true, quantity: true },
    });

    // Trailing 30-day window for the burn-rate projection. Independent
    // of the report window so a "today only" view still surfaces a
    // meaningful days-of-cover estimate.
    const burnFrom = new Date(toDate);
    burnFrom.setDate(burnFrom.getDate() - 30);
    burnFrom.setHours(0, 0, 0, 0);
    const burnMovements = await this.prisma.stockMovement.findMany({
      where: { branchId, ingredientId: { in: supplyIds }, type: 'OPERATIONAL_USE', createdAt: { gte: burnFrom, lte: toDate } },
      select: { ingredientId: true, quantity: true },
    });
    const usedLast30 = new Map<string, number>();
    for (const m of burnMovements) {
      usedLast30.set(m.ingredientId, (usedLast30.get(m.ingredientId) ?? 0) + Math.abs(m.quantity.toNumber()));
    }

    const rows = supplies.map((s) => {
      const ms = movements.filter((m) => m.ingredientId === s.id);
      const purchasedQty = ms.filter((m) => m.type === 'PURCHASE').reduce((sum, m) => sum + Math.abs(m.quantity.toNumber()), 0);
      const usedQty = ms.filter((m) => m.type === 'OPERATIONAL_USE').reduce((sum, m) => sum + Math.abs(m.quantity.toNumber()), 0);
      const wastedQty = ms.filter((m) => m.type === 'WASTE').reduce((sum, m) => sum + Math.abs(m.quantity.toNumber()), 0);
      const costPerUnit = s.costPerUnit.toNumber();
      const currentStock = s.currentStock.toNumber();
      const avgDailyUsage = (usedLast30.get(s.id) ?? 0) / 30;
      const daysOfCover = avgDailyUsage > 0 ? currentStock / avgDailyUsage : null;
      return {
        ingredientId: s.id,
        name: s.name,
        unit: s.unit,
        currentStock,
        costPerUnit,
        onHandValue: currentStock * costPerUnit,
        purchasedQty,
        purchasedCost: purchasedQty * costPerUnit,
        usedQty,
        wastedQty,
        avgDailyUsage,
        daysOfCover,
      };
    });

    return {
      rows: rows.sort((a, b) => b.purchasedCost - a.purchasedCost),
      totals: {
        purchasedCost: rows.reduce((s, r) => s + r.purchasedCost, 0),
        usedQty: rows.reduce((s, r) => s + r.usedQty, 0),
        onHandValue: rows.reduce((s, r) => s + r.onHandValue, 0),
      },
      windowFrom: fromDate.toISOString(),
      windowTo: toDate.toISOString(),
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

  /**
   * Voided items + fully-voided orders between from/to (defaults: today).
   * Useful for owners to audit what staff struck off and why. Returns two
   * lists — "items" (partial voids) and "orders" (fully cancelled orders)
   * — plus a summary of total value voided and counts by approver.
   */
  async getVoidReport(branchId: string, from?: string, to?: string) {
    const now = new Date();
    const start = from
      ? (() => { const d = new Date(from); d.setHours(0, 0, 0, 0); return d; })()
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = to
      ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })()
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // OrderItem.voidedById has no Prisma relation (yet) so we hydrate
    // Staff names in a second query + map here. Same for the order join
    // — just fetch parent orders separately and hash them.
    const voidedItems = await this.prisma.orderItem.findMany({
      where: {
        voidedAt: { gte: start, lte: end, not: null },
        order: { branchId, deletedAt: null },
      },
      orderBy: { voidedAt: 'desc' },
    });

    const voidedOrders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'VOID',
        voidedAt: { gte: start, lte: end, not: null },
        deletedAt: null,
      },
      orderBy: { voidedAt: 'desc' },
    });

    const parentOrderIds = Array.from(new Set(voidedItems.map((i) => i.orderId)));
    const parentOrders = parentOrderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: parentOrderIds } },
          select: { id: true, orderNumber: true, tableNumber: true, type: true, status: true },
        })
      : [];
    const parentById = new Map(parentOrders.map((o) => [o.id, o] as const));

    const approverIds = Array.from(new Set([
      ...voidedItems.map((i) => i.voidedById).filter((x): x is string => !!x),
      ...voidedOrders.map((o) => o.voidedById).filter((x): x is string => !!x),
    ]));
    const approvers = approverIds.length
      ? await this.prisma.staff.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, name: true },
        })
      : [];
    const approverById = new Map(approvers.map((s) => [s.id, s] as const));

    const items = voidedItems.map((i) => {
      const parent = parentById.get(i.orderId);
      const approver = i.voidedById ? approverById.get(i.voidedById) ?? null : null;
      return {
        id: i.id,
        orderId: i.orderId,
        orderNumber: parent?.orderNumber ?? '',
        tableNumber: parent?.tableNumber ?? null,
        type: parent?.type ?? '',
        orderStatus: parent?.status ?? '',
        menuItemName: i.menuItemName,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.totalPrice),
        voidReason: i.voidReason,
        voidedAt: i.voidedAt,
        voidedBy: approver,
      };
    });

    const orders = voidedOrders.map((o) => {
      const approver = o.voidedById ? approverById.get(o.voidedById) ?? null : null;
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        tableNumber: o.tableNumber,
        type: o.type,
        subtotal: Number(o.subtotal),
        voidReason: o.voidReason,
        voidedAt: o.voidedAt,
        voidedBy: approver,
      };
    });

    const itemsValue = items.reduce((s, i) => s + i.lineTotal, 0);
    const ordersValue = orders.reduce((s, o) => s + o.subtotal, 0);

    const byApprover: Record<string, { name: string; itemCount: number; orderCount: number; valuePaisa: number }> = {};
    for (const i of items) {
      if (!i.voidedBy) continue;
      const key = i.voidedBy.id;
      if (!byApprover[key]) byApprover[key] = { name: i.voidedBy.name, itemCount: 0, orderCount: 0, valuePaisa: 0 };
      byApprover[key].itemCount += 1;
      byApprover[key].valuePaisa += i.lineTotal;
    }
    for (const o of orders) {
      if (!o.voidedBy) continue;
      const key = o.voidedBy.id;
      if (!byApprover[key]) byApprover[key] = { name: o.voidedBy.name, itemCount: 0, orderCount: 0, valuePaisa: 0 };
      byApprover[key].orderCount += 1;
      byApprover[key].valuePaisa += o.subtotal;
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      items,
      orders,
      summary: {
        itemCount: items.length,
        orderCount: orders.length,
        itemsValuePaisa: itemsValue,
        ordersValuePaisa: ordersValue,
        totalValuePaisa: itemsValue + ordersValue,
        byApprover: Object.values(byApprover).sort((a, b) => b.valuePaisa - a.valuePaisa),
      },
    };
  }
}

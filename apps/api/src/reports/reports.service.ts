import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';

export interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
  ) {}

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
        // Mushak 6.3 invoice (Bangladesh VAT register). When the branch
        // is BIN-enabled, every paid order has one. Surface its serial
        // + SD amount so the POS sales report can show the Mushak
        // Register Serial Number column and let the cashier reprint the
        // invoice slip with one click.
        mushakInvoice: {
          select: { id: true, serial: true, sdAmount: true },
        },
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
        sdAmount: o.mushakInvoice ? Number(o.mushakInvoice.sdAmount) : 0,
        taxAmount: Number(o.taxAmount),
        totalAmount: Number(o.totalAmount),
        paymentMethod: o.payments.map((p) => p.method).join(', ') || o.paymentMethod || 'N/A',
        mushakInvoice: o.mushakInvoice
          ? { id: o.mushakInvoice.id, serial: o.mushakInvoice.serial, sdAmount: Number(o.mushakInvoice.sdAmount) }
          : null,
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
    // Returns both the cost AND the stock unit it's denominated in —
    // recipe lines may differ from the ingredient's stock unit (e.g.
    // recipe "Salt 6 G" vs ingredient stocked in KG), so we need the
    // unit to convert before multiplying.
    const variantCostCache = new Map<string, { cost: number; unit: string }>();
    const resolveCostAndUnit = async (
      ingredientId: string,
      parentCost: number,
      parentUnit: string,
      hasVariants: boolean,
    ): Promise<{ cost: number; unit: string }> => {
      if (parentCost > 0 || !hasVariants) return { cost: parentCost, unit: parentUnit };
      if (variantCostCache.has(ingredientId)) return variantCostCache.get(ingredientId)!;
      const variants = await this.prisma.ingredient.findMany({
        where: { parentId: ingredientId, isActive: true, deletedAt: null },
        select: { costPerUnit: true, unit: true },
      });
      const positives = variants
        .map((v) => ({ cost: v.costPerUnit.toNumber(), unit: v.unit as unknown as string }))
        .filter((v) => v.cost > 0);
      const picked = positives.length > 0
        ? positives.reduce((a, b) => (a.cost <= b.cost ? a : b))
        : { cost: 0, unit: parentUnit };
      variantCostCache.set(ingredientId, picked);
      return picked;
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

      // Per-unit recipe cost — sum(recipeItem.qty × ingredient.costPerUnit),
      // with unit conversion. RecipeItem.unit may differ from
      // Ingredient.unit (e.g. recipe specifies "6 G" of an ingredient
      // stocked in KG); without conversion we'd report 1/1000th of the
      // real COGS for that line. Custom-menu items make this especially
      // common — cashier types whatever unit feels natural.
      if (mi.recipe) {
        let unitCost = 0;
        for (const ri of mi.recipe.items) {
          const ing = ri.ingredient;
          const ingStockUnit = (ing.unit as unknown as string) ?? '';
          const { cost, unit: stockUnit } = await resolveCostAndUnit(
            ing.id,
            ing.costPerUnit.toNumber(),
            ingStockUnit,
            ing.hasVariants ?? false,
          );
          if (cost === 0) continue;
          const recipeUnit = (ri.unit as unknown as string) ?? stockUnit;
          const qtyInStockUnit = recipeUnit === stockUnit
            ? ri.quantity.toNumber()
            : await this.unitConversion.convert(branchId, ri.quantity.toNumber(), recipeUnit, stockUnit);
          unitCost += qtyInStockUnit * cost;
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

    // Detect & value "logged as waste" voids by reading the WasteLog
    // table directly — same source the Waste Log page uses, so the
    // numbers always match. Order-service void-as-waste writes a
    // WasteLog with notes prefixed `Void waste:` per recipe ingredient
    // in the same transaction as the OrderItem void. We pair each
    // WasteLog with its WASTE StockMovement (matched on ingredientId
    // ±5s + |qty|, identical heuristic to WasteService.findAll) so
    // the cost is the per-unit cost stamped at write time. Falls
    // back to current Ingredient.costPerUnit when the StockMovement
    // is pre-migration / missing unitCostPaisa.
    const voidWasteLogs = await this.prisma.wasteLog.findMany({
      where: {
        branchId,
        createdAt: { gte: start, lte: end },
        notes: { startsWith: 'Void waste:' },
      },
      include: {
        ingredient: { select: { id: true, costPerUnit: true } },
      },
    });

    const wasteIngIds = Array.from(new Set(voidWasteLogs.map((w) => w.ingredientId)));
    const wasteMovementsForVoids = wasteIngIds.length
      ? await this.prisma.stockMovement.findMany({
          where: {
            branchId,
            type: 'WASTE',
            ingredientId: { in: wasteIngIds },
            createdAt: {
              gte: new Date(start.getTime() - 10_000),
              lte: new Date(end.getTime() + 10_000),
            },
          },
          select: { id: true, ingredientId: true, quantity: true, unitCostPaisa: true, createdAt: true },
        })
      : [];

    const claimedMovement = new Set<string>();
    const findVoidWasteCost = (log: typeof voidWasteLogs[number]): number => {
      const targetTime = log.createdAt.getTime();
      const targetQty = Math.abs(Number(log.quantity));
      const m = wasteMovementsForVoids.find(
        (mv) =>
          !claimedMovement.has(mv.id) &&
          mv.ingredientId === log.ingredientId &&
          Math.abs(mv.createdAt.getTime() - targetTime) < 5000 &&
          Math.abs(Math.abs(Number(mv.quantity)) - targetQty) < 0.0001,
      );
      if (m && m.unitCostPaisa != null) {
        claimedMovement.add(m.id);
        return m.unitCostPaisa.toNumber();
      }
      return log.ingredient.costPerUnit.toNumber();
    };

    const items = voidedItems.map((i) => {
      const parent = parentById.get(i.orderId);
      const approver = i.voidedById ? approverById.get(i.voidedById) ?? null : null;
      // Per-item classification: was this voided line logged as
      // waste? Match by menuItemName appearing in any "Void waste:"
      // WasteLog notes within ±10s of voidedAt. The notes are
      // stamped as `Void waste: ${menuItemName} ×${quantity} —
      // ${reason}` at the order-service write site, so substring
      // match on menuItemName is reliable. More robust than joining
      // via StockMovement.orderId since older voids may not have
      // had orderId stamped on the WASTE movement.
      const targetTime = i.voidedAt?.getTime() ?? 0;
      const loggedAsWaste = targetTime > 0 && voidWasteLogs.some(
        (log) =>
          log.notes != null &&
          log.notes.includes(i.menuItemName) &&
          Math.abs(log.createdAt.getTime() - targetTime) < 10_000,
      );
      const wasteCostPaisa = 0;
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
        loggedAsWaste,
        wasteCostPaisa,
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

    // Split the voided-item value by mode so admins see "of the X
    // taka of voided sales, Y taka was returned to stock and Z taka
    // was actually wasted (lost food, lost cost)". Old voids without
    // a paired WASTE movement default to "returned" — which is
    // historically correct for most installs since waste-on-void
    // was opt-in.
    const voidedReturnSellingValuePaisa = items
      .filter((i) => !i.loggedAsWaste)
      .reduce((s, i) => s + i.lineTotal, 0);
    const voidedWasteSellingValuePaisa = items
      .filter((i) => i.loggedAsWaste)
      .reduce((s, i) => s + i.lineTotal, 0);
    // Sum every "Void waste:" WasteLog row in the date range — same
    // source-of-truth the Waste Log page reads, valued via the same
    // paired-StockMovement lookup so the two reports always agree.
    const actualVoidWasteCostPaisa = voidWasteLogs.reduce((s, log) => {
      const qty = Number(log.quantity);
      const unitCost = findVoidWasteCost(log);
      return s + Math.round(qty * unitCost);
    }, 0);

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
        // Selling-price split of voided items.
        voidedReturnSellingValuePaisa,
        voidedWasteSellingValuePaisa,
        // Ingredient-cost loss on the wasted voids — what the
        // kitchen actually paid for food that went out the door.
        actualVoidWasteCostPaisa,
        byApprover: Object.values(byApprover).sort((a, b) => b.valuePaisa - a.valuePaisa),
      },
    };
  }

  /**
   * Per-ingredient activity ledger ("Stock Watcher") — every stock
   * movement on a single ingredient inside a date range, grouped by
   * day, sub-grouped by movement bucket (purchase / sale / wastage /
   * other), with PO + supplier context for purchases and order +
   * menu-item context for sales / void-waste rows.
   *
   * Cost basis per row: `unitCostPaisa` stamped on the StockMovement
   * at write time (post-2026-05-08 migration). Old rows without it
   * fall back to current `Ingredient.costPerUnit` and are flagged
   * `isApprox: true` so the UI can mark them.
   */
  async getStockWatcher(branchId: string, ingredientId: string, from?: string, to?: string) {
    const now = new Date();
    const dateFrom = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = to ? new Date(to) : now;
    dateTo.setHours(23, 59, 59, 999);

    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: ingredientId, branchId, deletedAt: null },
      select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true, hasVariants: true, parentId: true },
    });
    if (!ingredient) return null;

    // Family roll-up: when admin picks a parent that hasVariants, the
    // PARENT's own stock_movements are typically empty — every recipe
    // SALE / WASTE / VOID_RETURN deducts from a specific variant via
    // FIFO. Sum across the whole family so the picker doesn't return
    // an empty report for a "Spring Onion" parent that has 3 brand
    // variants underneath.
    const familyIds = ingredient.hasVariants
      ? [
          ingredient.id,
          ...(
            await this.prisma.ingredient.findMany({
              where: { parentId: ingredient.id, deletedAt: null },
              select: { id: true },
            })
          ).map((v) => v.id),
        ]
      : [ingredient.id];

    // Family currentStock — for parents that have variants, the
    // parent's own `currentStock` column IS the running sum of its
    // variants (kept in lockstep by `syncParentStock` after every
    // variant write). Earlier this branch ALSO summed variant rows,
    // which double-counted the family total because the parent's
    // currentStock already aggregates them — closing-stock then
    // displayed at exactly 2× the on-hand figure. Just read the
    // parent's column directly.
    const familyCurrentStock = ingredient.currentStock.toNumber();

    const currentCost = ingredient.costPerUnit.toNumber();

    // Pull every movement for the FAMILY in the range, plus the ones
    // AFTER the range — we need the "after" sum to derive the
    // closing-at-to snapshot from currentStock.
    const movementsInRange = await this.prisma.stockMovement.findMany({
      where: {
        branchId,
        ingredientId: { in: familyIds },
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      orderBy: { createdAt: 'asc' },
    });
    const movementsAfter = await this.prisma.stockMovement.aggregate({
      where: { branchId, ingredientId: { in: familyIds }, createdAt: { gt: dateTo } },
      _sum: { quantity: true },
    });

    const sumAfter = Number(movementsAfter._sum.quantity ?? 0);
    const sumInRange = movementsInRange.reduce((s, m) => s + Number(m.quantity), 0);
    const closingStockQty = familyCurrentStock - sumAfter;
    const openingStockQty = closingStockQty - sumInRange;
    const closingStockValuePaisa = Math.round(closingStockQty * currentCost);
    const openingStockValuePaisa = Math.round(openingStockQty * currentCost);

    // Resolve cost-per-row: prefer stamped unitCostPaisa, fall back
    // to current ingredient cost (flagged isApprox).
    const rowCost = (m: { unitCostPaisa: { toNumber(): number } | null }): { value: number; isApprox: boolean } => {
      if (m.unitCostPaisa != null) return { value: m.unitCostPaisa.toNumber(), isApprox: false };
      return { value: currentCost, isApprox: true };
    };

    // Lookups for context columns.
    const poIds = Array.from(new Set(movementsInRange.map((m) => m.purchaseOrderId).filter((x): x is string => !!x)));
    const orderIds = Array.from(new Set(movementsInRange.map((m) => m.orderId).filter((x): x is string => !!x)));
    const staffIds = Array.from(new Set(movementsInRange.map((m) => m.staffId).filter((x): x is string => !!x)));

    const [pos, orders, staff, wasteLogs] = await Promise.all([
      poIds.length
        ? this.prisma.purchaseOrder.findMany({
            where: { id: { in: poIds } },
            select: { id: true, supplier: { select: { name: true } } },
          })
        : Promise.resolve([] as Array<{ id: string; supplier: { name: string } | null }>),
      orderIds.length
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, orderNumber: true },
          })
        : Promise.resolve([] as Array<{ id: string; orderNumber: string }>),
      staffIds.length
        ? this.prisma.staff.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      // Manual waste log rows for this ingredient in range. We match
      // each WASTE-type StockMovement to its WasteLog by approximate
      // timestamp (same-transaction writes land within milliseconds).
      this.prisma.wasteLog.findMany({
        where: {
          branchId,
          ingredientId,
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        include: { recordedBy: { select: { name: true } } },
      }),
    ]);

    const poById = new Map(pos.map((p) => [p.id, p] as const));
    const orderById = new Map(orders.map((o) => [o.id, o] as const));
    const staffById = new Map(staff.map((s) => [s.id, s] as const));

    // Variant-name lookup so per-day rows can show "Spring Onion —
    // ABC (1 KG Pack)" alongside the parent header. Only matters for
    // family rollups; standalone ingredients fall through with a
    // single-entry map.
    const familyMembers = await this.prisma.ingredient.findMany({
      where: { id: { in: familyIds } },
      select: { id: true, name: true },
    });
    const ingNameById = new Map(familyMembers.map((i) => [i.id, i.name] as const));

    // Match WasteLog → StockMovement by (createdAt within ±5s, abs qty).
    const wasteByMovementId = new Map<string, (typeof wasteLogs)[number]>();
    for (const m of movementsInRange) {
      if (m.type !== 'WASTE') continue;
      const targetTime = m.createdAt.getTime();
      const targetQty = Math.abs(Number(m.quantity));
      const match = wasteLogs.find(
        (w) =>
          Math.abs(w.createdAt.getTime() - targetTime) < 5000 &&
          Math.abs(Number(w.quantity) - targetQty) < 0.0001 &&
          !Array.from(wasteByMovementId.values()).some((used) => used.id === w.id),
      );
      if (match) wasteByMovementId.set(m.id, match);
    }

    // Group by date (YYYY-MM-DD).
    const byDate = new Map<string, typeof movementsInRange>();
    for (const m of movementsInRange) {
      const day = m.createdAt.toISOString().slice(0, 10);
      const arr = byDate.get(day) ?? [];
      arr.push(m);
      byDate.set(day, arr);
    }

    let purchaseQty = 0, purchaseValue = 0;
    // GROSS usage = sum of all SALE + OPERATIONAL_USE deductions.
    // We track this separately from the headline "usage" figure
    // because some of those rows were later voided and the stock
    // was returned (VOID_RETURN). The NET usage that admins care
    // about for variance review is gross usage minus returns —
    // it answers "how much was actually consumed by customers".
    let usageGrossQty = 0, usageGrossValue = 0;
    let voidReturnQty = 0, voidReturnValue = 0;
    let wastageQty = 0, wastageValue = 0;
    // ADJUSTMENT is a manual correction; VOID_RETURN is now bucketed
    // separately above. Keep ADJUSTMENT-only here so the audit
    // picture stays clean.
    let adjustmentQty = 0, adjustmentValue = 0;

    const days = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, rows]) => {
        const purchases: any[] = [];
        const sales: any[] = [];
        const wastage: any[] = [];
        const other: any[] = [];

        for (const m of rows) {
          const cost = rowCost(m);
          const qty = Number(m.quantity);
          const totalPaisa = Math.round(Math.abs(qty) * cost.value);
          const time = m.createdAt.toISOString();
          const orderRef = m.orderId ? orderById.get(m.orderId)?.orderNumber ?? null : null;

          // Variant name for family rollups — shown next to the
          // description so admins reading "Spring Onion" can see
          // "Spring Onion — Local Vendor (2 KG Pack)" on each row.
          // Falls back to the family parent's name for safety.
          const variantName = ingNameById.get(m.ingredientId) ?? ingredient.name;
          const isVariantRow = m.ingredientId !== ingredient.id;

          if (m.type === 'PURCHASE' || m.type === 'PRODUCTION_RECEIVED') {
            purchaseQty += qty;
            purchaseValue += totalPaisa;
            const po = m.purchaseOrderId ? poById.get(m.purchaseOrderId) : null;
            purchases.push({
              time,
              type: m.type,
              supplierName: po?.supplier?.name ?? null,
              poNumber: m.purchaseOrderId ? m.purchaseOrderId.slice(-8).toUpperCase() : null,
              quantity: qty,
              unit: ingredient.unit,
              unitCostPaisa: cost.value,
              totalPaisa,
              isApprox: cost.isApprox,
              notes: m.notes,
              variantName: isVariantRow ? variantName : null,
            });
          } else if (m.type === 'SALE' || m.type === 'OPERATIONAL_USE') {
            const absQty = Math.abs(qty);
            usageGrossQty += absQty;
            usageGrossValue += totalPaisa;
            sales.push({
              time,
              type: m.type,
              orderNumber: orderRef,
              notes: m.notes,
              quantity: absQty,
              unitCostPaisa: cost.value,
              totalPaisa,
              isApprox: cost.isApprox,
              variantName: isVariantRow ? variantName : null,
            });
          } else if (m.type === 'WASTE') {
            const absQty = Math.abs(qty);
            wastageQty += absQty;
            wastageValue += totalPaisa;
            const log = wasteByMovementId.get(m.id);
            const isVoidAuto = (m.notes ?? '').toLowerCase().startsWith('void waste');
            wastage.push({
              time,
              kind: isVoidAuto ? 'VOID_AUTO' : 'MANUAL',
              reason: log?.reason ?? null,
              recordedByName: log?.recordedBy?.name ?? (m.staffId ? staffById.get(m.staffId)?.name ?? null : null),
              orderNumber: orderRef,
              notes: m.notes,
              quantity: absQty,
              unitCostPaisa: cost.value,
              totalPaisa,
              isApprox: cost.isApprox,
              variantName: isVariantRow ? variantName : null,
            });
          } else if (m.type === 'VOID_RETURN') {
            // VOID_RETURN puts qty back on the shelf — qty is positive.
            // Track separately so the headline Usage tile can subtract
            // returns and show the net "actually consumed" figure.
            // The row still appears in the per-day "Other" table for
            // audit visibility.
            voidReturnQty += qty;
            voidReturnValue += totalPaisa;
            other.push({
              time,
              type: m.type,
              signedQuantity: qty,
              notes: m.notes,
              orderNumber: orderRef,
              staffName: m.staffId ? staffById.get(m.staffId)?.name ?? null : null,
              unitCostPaisa: cost.value,
              totalPaisa,
              isApprox: cost.isApprox,
              variantName: isVariantRow ? variantName : null,
            });
          } else {
            // ADJUSTMENT — manual stock correction. Surfaced under the
            // Other section so admins see the audit trail; doesn't
            // affect the headline tiles since these are corrections,
            // not consumption.
            adjustmentQty += qty;
            adjustmentValue += qty >= 0 ? totalPaisa : -totalPaisa;
            other.push({
              time,
              type: m.type,
              signedQuantity: qty,
              notes: m.notes,
              orderNumber: orderRef,
              staffName: m.staffId ? staffById.get(m.staffId)?.name ?? null : null,
              unitCostPaisa: cost.value,
              totalPaisa,
              isApprox: cost.isApprox,
              variantName: isVariantRow ? variantName : null,
            });
          }
        }

        return { date, purchases, sales, wastage, other };
      });

    return {
      ingredient: {
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        // For a family rollup this is the SUM of all variants' on-
        // hand stock so the closing-stock tile and the page header
        // match each other. For a single ingredient it's the row's
        // own currentStock.
        currentStock: familyCurrentStock,
        costPerUnit: currentCost,
        hasVariants: ingredient.hasVariants,
        variantCount: familyIds.length - 1,
      },
      range: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      summary: {
        openingStockQty,
        openingStockValuePaisa,
        purchaseQty,
        purchaseValuePaisa: purchaseValue,
        // `usageQty` is the NET figure — gross consumption MINUS
        // void returns (because VOID_RETURN put that qty back on
        // the shelf, so it wasn't actually consumed). Gross + the
        // void-return breakdown are also exposed so the UI can
        // show "Net X (gross Y, returns Z)" when returns happened.
        usageQty: usageGrossQty - voidReturnQty,
        usageValuePaisa: usageGrossValue - voidReturnValue,
        usageGrossQty,
        usageGrossValuePaisa: usageGrossValue,
        voidReturnQty,
        voidReturnValuePaisa: voidReturnValue,
        wastageQty,
        wastageValuePaisa: wastageValue,
        adjustmentQty,
        adjustmentValuePaisa: adjustmentValue,
        closingStockQty,
        closingStockValuePaisa,
      },
      days,
    };
  }

  /**
   * Aggregator P&L report — per food-delivery platform breakdown of
   * gross order revenue vs. the commission / VAT / subscription fees
   * the platform later deducts from the settlement.
   *
   * Wiring relies on convention (no schema change):
   *   - Each PaymentOption under the "FOOD_DELIVERY" PaymentMethodConfig
   *     is treated as a platform. `option.code` is matched
   *     case-insensitively against `OrderPayment.method` to find that
   *     platform's gross.
   *   - Each Creditor whose `name` matches the option's name (or code)
   *     is treated as the settlement counterparty. `CreditorBill`
   *     rows under that creditor in the window are summed as platform
   *     fees. Admin can split a single Foodpanda invoice across line
   *     items (commission, online-payment, VAT, subscription) — they
   *     all roll up here.
   *   - Outstanding settlement = `Account.balance` for the account
   *     linked to the PaymentOption (the "Pending Settlement" account
   *     pattern from Lane B).
   *
   * Net = gross − fees. Negative net (Foodpanda's 15 May invoice) shows
   * up as a negative number — owners want to see that.
   */
  async getAggregatorPnL(branchId: string, from?: string, to?: string) {
    const now = new Date();
    const dateFrom = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = to ? new Date(to) : now;
    dateTo.setHours(23, 59, 59, 999);

    // Step 1 — resolve the platforms. Pure flag-driven: any active
    // PaymentOption whose parent PaymentMethodConfig has
    // `isAggregator = true`. Admin marks a category once in Settings
    // → Payment Methods and every option under it shows up here.
    // No hardcoded code list, no prefix regex — the report scales to
    // any future aggregator the user adds (Shohoz Food, Uber Eats,
    // Khaas Food, whatever) without a code change.
    const aggregatorOptions = await this.prisma.paymentOption.findMany({
      where: {
        branchId,
        isActive: true,
        category: { isAggregator: true },
      },
      include: { category: { select: { code: true, name: true, isAggregator: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    if (aggregatorOptions.length === 0) {
      return {
        from: dateFrom.toISOString(),
        to: dateTo.toISOString(),
        rows: [],
        totals: { orders: 0, grossPaisa: 0, feesPaisa: 0, netPaisa: 0, outstandingPaisa: 0 },
      };
    }

    // Step 2 — sum gross from OrderPayment rows. Using OrderPayment
    // (not Order.paymentMethod) handles split-payment cases cleanly:
    // a part-cash, part-Foodpanda order would otherwise miscount.
    const optionCodes = aggregatorOptions.map((o) => o.code.toUpperCase());
    // OrderStatus enum (see prisma/schema.prisma line 36): PENDING /
    // CONFIRMED / PREPARING / READY / SERVED / PAID / VOID / REFUNDED
    // / PARTIALLY_REFUNDED. Filtering to PAID + PARTIALLY_REFUNDED
    // covers every order that actually generated revenue, dropping
    // VOID / REFUNDED (no revenue) and in-flight states. Earlier code
    // referenced a non-existent COMPLETED status which caused the
    // /reports/aggregator-pnl endpoint to 500 — Prisma rejected the
    // unknown enum value.
    const payments = await this.prisma.orderPayment.findMany({
      where: {
        order: {
          branchId,
          deletedAt: null,
          status: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
          paidAt: { gte: dateFrom, lte: dateTo },
        },
      },
      select: { method: true, amount: true, orderId: true },
    });
    const grossByCode = new Map<string, number>();
    const orderIdsByCode = new Map<string, Set<string>>();
    for (const p of payments) {
      const code = (p.method ?? '').toUpperCase();
      if (!optionCodes.includes(code)) continue;
      grossByCode.set(code, (grossByCode.get(code) ?? 0) + p.amount.toNumber());
      const set = orderIdsByCode.get(code) ?? new Set<string>();
      set.add(p.orderId);
      orderIdsByCode.set(code, set);
    }

    // Step 3 — sum CreditorBill amounts per matching creditor. Match
    // by case-insensitive name OR code (convention: creditor "Foodpanda"
    // matches platform "FOOD_PANDA" / "Foodpanda").
    const creditors = await this.prisma.creditor.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true },
    });
    const matchCreditor = (option: { code: string; name: string }) => {
      const norm = option.name.replace(/\s+/g, '').toLowerCase();
      const codeNorm = option.code.replace(/_/g, '').toLowerCase();
      return creditors.find((c) => {
        const n = c.name.replace(/\s+/g, '').toLowerCase();
        return n.includes(norm) || norm.includes(n) || n.includes(codeNorm);
      });
    };

    const billsByCreditor = new Map<string, number>();
    if (creditors.length > 0) {
      const bills = await this.prisma.creditorBill.findMany({
        where: {
          branchId,
          creditorId: { in: creditors.map((c) => c.id) },
          billDate: { gte: dateFrom, lte: dateTo },
        },
        select: { creditorId: true, amount: true },
      });
      for (const b of bills) {
        billsByCreditor.set(b.creditorId, (billsByCreditor.get(b.creditorId) ?? 0) + b.amount.toNumber());
      }
    }

    // Step 4 — outstanding settlement = balance of the linked Account.
    const accountIds = aggregatorOptions
      .map((o) => o.accountId)
      .filter((id): id is string => !!id);
    const accounts = accountIds.length > 0
      ? await this.prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, balance: true },
        })
      : [];
    const balanceByAccountId = new Map(accounts.map((a) => [a.id, a.balance.toNumber()] as const));

    // Step 5 — assemble per-platform rows.
    const rows = aggregatorOptions.map((opt) => {
      const code = opt.code.toUpperCase();
      const grossPaisa = grossByCode.get(code) ?? 0;
      const orders = orderIdsByCode.get(code)?.size ?? 0;
      const creditor = matchCreditor(opt);
      const feesPaisa = creditor ? (billsByCreditor.get(creditor.id) ?? 0) : 0;
      const netPaisa = grossPaisa - feesPaisa;
      const outstandingPaisa = opt.accountId ? (balanceByAccountId.get(opt.accountId) ?? 0) : 0;
      return {
        platformCode: opt.code,
        platformName: opt.name,
        platformColor: opt.color ?? null,
        accountId: opt.accountId ?? null,
        creditorId: creditor?.id ?? null,
        creditorName: creditor?.name ?? null,
        orders,
        grossPaisa,
        feesPaisa,
        netPaisa,
        outstandingPaisa,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        orders: acc.orders + r.orders,
        grossPaisa: acc.grossPaisa + r.grossPaisa,
        feesPaisa: acc.feesPaisa + r.feesPaisa,
        netPaisa: acc.netPaisa + r.netPaisa,
        outstandingPaisa: acc.outstandingPaisa + r.outstandingPaisa,
      }),
      { orders: 0, grossPaisa: 0, feesPaisa: 0, netPaisa: 0, outstandingPaisa: 0 },
    );

    // Sort by gross descending so the busiest platform is on top.
    rows.sort((a, b) => b.grossPaisa - a.grossPaisa);

    return {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      rows,
      totals,
    };
  }
}

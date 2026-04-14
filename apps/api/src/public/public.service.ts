import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** Calculate discounted prices for menu items based on active MenuItemDiscounts */
  private async applyDiscounts<T extends { id: string; price: any }>(branchId: string, items: T[]): Promise<(T & { discountedPrice: number | null; discountType: string | null; discountValue: number | null })[]> {
    if (items.length === 0) return items.map((i) => ({ ...i, discountedPrice: null, discountType: null, discountValue: null }));
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const discounts = await this.prisma.menuItemDiscount.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        menuItem: { branchId },
      },
    });
    const activeDiscounts = discounts.filter((d) => {
      if (!d.applicableDays) return true;
      try { const days: string[] = JSON.parse(d.applicableDays); return days.includes(dayName); } catch { return true; }
    });

    return items.map((item) => {
      const discount = activeDiscounts.find((d) => d.menuItemId === item.id);
      if (!discount) return { ...item, discountedPrice: null, discountType: null, discountValue: null, discountEndDate: null, discountApplicableDays: null };
      const price = Number(item.price);
      const discountedPrice = discount.type === 'FLAT'
        ? Math.max(0, price - Number(discount.value))
        : Math.round(price * (1 - Number(discount.value) / 100));
      let applicableDays: string[] | null = null;
      try { applicableDays = discount.applicableDays ? JSON.parse(discount.applicableDays) : null; } catch { /* */ }
      return {
        ...item,
        discountedPrice,
        discountType: discount.type,
        discountValue: Number(discount.value),
        discountEndDate: discount.endDate.toISOString(),
        discountApplicableDays: applicableDays,
      };
    });
  }

  async getTableInfo(tableId: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: tableId, deletedAt: null },
      include: { branch: true },
    });
    if (!table) throw new NotFoundException('Table not found');

    // Check for active (non-finished) order on this table
    const activeOrder = await this.prisma.order.findFirst({
      where: {
        tableId,
        deletedAt: null,
        status: { notIn: ['PAID', 'VOID'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return {
      id: table.id,
      tableNumber: table.tableNumber,
      branchId: table.branchId,
      branchName: table.branch.name,
      status: table.status,
      activeOrderId: activeOrder?.id ?? null,
    };
  }

  async getBranches() {
    return this.prisma.branch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, address: true, phone: true },
    });
  }

  async getBranchById(branchId: string) {
    return this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, address: true, phone: true, logoUrl: true },
    });
  }

  async getMenu(branchId: string) {
    // Menu page = ALL categories the admin hasn't explicitly hidden.
    // featuredCategoryIds only controls the HOMEPAGE preview (applied client-side
    // on the web app), never the full menu page — admin wants the complete menu
    // browsable even when a subset is featured on the home page.
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const hiddenCatIds: string[] = content?.hiddenCategoryIds ? this.safeParseArray(content.hiddenCategoryIds) : [];
    const hiddenItemIds: string[] = content?.hiddenItemIds ? this.safeParseArray(content.hiddenItemIds) : [];

    const catWhere: any = {
      branchId,
      isActive: true,
      deletedAt: null,
      websiteVisible: true,
    };
    if (hiddenCatIds.length > 0) catWhere.id = { notIn: hiddenCatIds };

    const itemWhere: any = {
      branchId,
      isAvailable: true,
      deletedAt: null,
      websiteVisible: true,
    };
    if (hiddenItemIds.length > 0) itemWhere.id = { notIn: hiddenItemIds };

    const [categories, items] = await Promise.all([
      this.prisma.menuCategory.findMany({ where: catWhere, orderBy: { sortOrder: 'asc' } }),
      this.prisma.menuItem.findMany({ where: itemWhere, orderBy: { sortOrder: 'asc' } }),
    ]);

    const itemsWithDiscount = await this.applyDiscounts(branchId, items);
    return { categories, items: itemsWithDiscount };
  }

  private safeParseArray(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  async getMenuItem(branchId: string, itemIdOrSlug: string) {
    // Support lookup by ID or slug
    const item = await this.prisma.menuItem.findFirst({
      where: {
        branchId,
        deletedAt: null,
        OR: [{ id: itemIdOrSlug }, { slug: itemIdOrSlug }],
      },
      include: {
        category: true,
        recipe: {
          include: {
            items: {
              include: {
                ingredient: { select: { id: true, name: true, unit: true, imageUrl: true, showOnWebsite: true } },
              },
            },
          },
        },
      },
    });
    if (!item) return null;

    // Apply discount
    const [itemWithDiscount] = await this.applyDiscounts(branchId, [item]);

    // Filter ingredients by showOnWebsite
    const ingredients = item.recipe?.items
      .filter((ri) => ri.ingredient.showOnWebsite)
      .map((ri) => ({
        id: ri.ingredient.id,
        name: ri.ingredient.name,
        imageUrl: ri.ingredient.imageUrl,
        quantity: ri.quantity,
        unit: ri.unit,
      })) ?? [];

    return { ...itemWithDiscount, ingredients };
  }

  async getRecommended(branchId: string, categoryId?: string) {
    // Get recommended tag from CMS
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const tag = content?.recommendedTag ?? 'Chef Special';

    if (categoryId) {
      // "You might also like" — top selling from same category
      const topItems = await this.prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: { order: { branchId, status: 'PAID' }, menuItem: { categoryId, deletedAt: null, isAvailable: true, websiteVisible: true } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      });
      const ids = topItems.map((t) => t.menuItemId);
      if (ids.length > 0) {
        const items = await this.prisma.menuItem.findMany({
          where: { id: { in: ids }, deletedAt: null },
          include: { category: true },
        });
        return this.applyDiscounts(branchId, items);
      }
    }

    // Items tagged with recommendedTag
    const tagged = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null, isAvailable: true, websiteVisible: true, tags: { contains: tag } },
      include: { category: true },
      take: 10,
    });
    if (tagged.length > 0) return this.applyDiscounts(branchId, tagged);

    // Fallback: top selling items
    const topAll = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { branchId, status: 'PAID' }, menuItem: { deletedAt: null, isAvailable: true } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    });
    const fallbackIds = topAll.map((t) => t.menuItemId);
    const fallbackItems = await this.prisma.menuItem.findMany({
      where: { id: { in: fallbackIds }, deletedAt: null },
      include: { category: true },
    });
    return this.applyDiscounts(branchId, fallbackItems);
  }

  async getDiscountedItems(branchId: string) {
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const discounts = await this.prisma.menuItemDiscount.findMany({
      where: { isActive: true, startDate: { lte: now }, endDate: { gte: now }, menuItem: { branchId, deletedAt: null, isAvailable: true, websiteVisible: true } },
      include: { menuItem: { include: { category: true } } },
    });
    const active = discounts.filter((d) => {
      if (!d.applicableDays) return true;
      try { return (JSON.parse(d.applicableDays) as string[]).includes(dayName); } catch { return true; }
    });
    return active.map((d) => {
      const price = Number(d.menuItem.price);
      const discountedPrice = d.type === 'FLAT' ? Math.max(0, price - Number(d.value)) : Math.round(price * (1 - Number(d.value) / 100));
      let applicableDays: string[] | null = null;
      try { applicableDays = d.applicableDays ? JSON.parse(d.applicableDays) : null; } catch { /* */ }
      return {
        ...d.menuItem,
        discountedPrice,
        discountType: d.type,
        discountValue: Number(d.value),
        discountEndDate: d.endDate.toISOString(),
        discountApplicableDays: applicableDays,
      };
    });
  }

  async getReviews(branchId: string) {
    return this.prisma.review.findMany({
      where: { branchId },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}

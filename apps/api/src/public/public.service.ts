import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getMenu(branchId: string) {
    const now = new Date();

    // Get website visibility settings
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId } });
    const hiddenCatIds: string[] = content?.hiddenCategoryIds ? JSON.parse(content.hiddenCategoryIds) : [];
    const hiddenItemIds: string[] = content?.hiddenItemIds ? JSON.parse(content.hiddenItemIds) : [];

    const [categories, items, menuDiscounts] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { branchId, isActive: true, deletedAt: null, websiteVisible: true, id: { notIn: hiddenCatIds.length > 0 ? hiddenCatIds : undefined } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.menuItem.findMany({
        where: { branchId, isAvailable: true, deletedAt: null, websiteVisible: true, id: { notIn: hiddenItemIds.length > 0 ? hiddenItemIds : undefined } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.menuItemDiscount.findMany({
        where: {
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
          menuItem: { branchId },
        },
      }),
    ]);

    // Calculate active discounted prices
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const activeDiscounts = menuDiscounts.filter((d) => {
      if (!d.applicableDays) return true;
      const days: string[] = JSON.parse(d.applicableDays);
      return days.includes(dayName);
    });

    const itemsWithDiscount = items.map((item) => {
      const discount = activeDiscounts.find((d) => d.menuItemId === item.id);
      if (!discount) return { ...item, discountedPrice: null, discountType: null, discountValue: null };
      const price = Number(item.price);
      const discountedPrice = discount.type === 'FLAT'
        ? Math.max(0, price - Number(discount.value))
        : Math.round(price * (1 - Number(discount.value) / 100));
      return { ...item, discountedPrice, discountType: discount.type, discountValue: Number(discount.value) };
    });

    return { categories, items: itemsWithDiscount };
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

    return { ...item, ingredients };
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
        return this.prisma.menuItem.findMany({
          where: { id: { in: ids }, deletedAt: null },
          include: { category: true },
        });
      }
    }

    // Items tagged with recommendedTag
    const tagged = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null, isAvailable: true, websiteVisible: true, tags: { contains: tag } },
      include: { category: true },
      take: 10,
    });
    if (tagged.length > 0) return tagged;

    // Fallback: top selling items
    const topAll = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { branchId, status: 'PAID' }, menuItem: { deletedAt: null, isAvailable: true } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    });
    const fallbackIds = topAll.map((t) => t.menuItemId);
    return this.prisma.menuItem.findMany({
      where: { id: { in: fallbackIds }, deletedAt: null },
      include: { category: true },
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

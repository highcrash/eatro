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
    const [categories, items, menuDiscounts] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { branchId, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.menuItem.findMany({
        where: { branchId, isAvailable: true, deletedAt: null },
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
}

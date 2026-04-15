import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

import type { CreateOrderDto, ProcessPaymentDto, VoidOrderDto, VoidOrderItemDto } from '@restora/types';
import { generateOrderNumber } from '@restora/utils';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { RecipeService } from '../recipe/recipe.service';
import { AccountService } from '../account/account.service';
import { BranchSettingsService } from '../branch-settings/branch-settings.service';

/**
 * Service charge + VAT calculator used by every place that recomputes an
 * order's totals (create, add-items, apply-discount / coupon, void).
 * Respects the branch-level vatEnabled + serviceChargeEnabled toggles so
 * an admin can turn VAT off or switch on a service charge without
 * redeploying.
 */
interface TaxableBranch {
  vatEnabled: boolean;
  taxRate: { toNumber(): number };
  serviceChargeEnabled: boolean;
  serviceChargeRate: { toNumber(): number };
}
function computeTotals(branch: TaxableBranch, subtotal: number, discountAmount = 0) {
  const net = Math.max(0, subtotal - discountAmount);
  const serviceChargeAmount = branch.serviceChargeEnabled && branch.serviceChargeRate.toNumber() > 0
    ? Math.round(net * (branch.serviceChargeRate.toNumber() / 100))
    : 0;
  const taxAmount = branch.vatEnabled && branch.taxRate.toNumber() > 0
    ? Math.round((net + serviceChargeAmount) * (branch.taxRate.toNumber() / 100))
    : 0;
  const totalAmount = net + serviceChargeAmount + taxAmount;
  return { serviceChargeAmount, taxAmount, totalAmount };
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RestoraPosGateway,
    private readonly recipeService: RecipeService,
    private readonly accountService: AccountService,
    private readonly branchSettings: BranchSettingsService,
  ) {}

  findAll(branchId: string, tableId?: string, status?: string, from?: string, to?: string) {
    // Date range filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) { const d = new Date(from); d.setHours(0, 0, 0, 0); dateFilter.createdAt.gte = d; }
      if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); dateFilter.createdAt.lte = d; }
    }

    // When fetching for a specific table (POS), limit to 1 active order
    if (tableId) {
      return this.prisma.order.findMany({
        where: { branchId, deletedAt: null, tableId, status: { notIn: ['PAID' as const, 'VOID' as const] } },
        include: { items: true, payments: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
    }

    return this.prisma.order.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(status ? { status: { in: status.split(',') as never[] } } : {}),
        ...dateFilter,
      },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, branchId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { items: { include: { menuItem: true } }, payments: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async getKitchenTicket(id: string, branchId: string) {
    const order = await this.findOne(id, branchId);
    const activeItems = order.items.filter((i) => !i.voidedAt);
    return {
      orderNumber: order.orderNumber,
      type: order.type,
      tableNumber: order.tableNumber,
      createdAt: order.createdAt,
      items: activeItems.map((i) => ({
        name: i.menuItemName,
        quantity: i.quantity,
        notes: i.notes,
      })),
      notes: order.notes,
    };
  }

  async create(branchId: string, cashierId: string, dto: CreateOrderDto) {
    // Fetch menu items to get prices and names
    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId, deletedAt: null, isAvailable: true },
    });

    if (menuItems.length !== menuItemIds.length) {
      throw new BadRequestException('One or more menu items are unavailable');
    }

    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });

    // Fetch active menu item discounts for price adjustment
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const menuDiscounts = await this.prisma.menuItemDiscount.findMany({
      where: {
        menuItemId: { in: menuItemIds },
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    const getDiscountedPrice = (menuItemId: string, originalPrice: number): number => {
      const discount = menuDiscounts.find((d) => {
        if (d.menuItemId !== menuItemId) return false;
        if (d.applicableDays) {
          const days: string[] = JSON.parse(d.applicableDays);
          if (!days.includes(dayName)) return false;
        }
        return true;
      });
      if (!discount) return originalPrice;
      if (discount.type === 'FLAT') return Math.max(0, originalPrice - discount.value.toNumber());
      return Math.round(originalPrice * (1 - discount.value.toNumber() / 100));
    };

    // Calculate totals with discounted prices
    const itemsData = dto.items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const unitPrice = getDiscountedPrice(item.menuItemId, menuItem.price.toNumber());
      return {
        menuItemId: item.menuItemId,
        menuItemName: menuItem.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        notes: item.notes ?? null,
      };
    });

    const subtotal = itemsData.reduce((s, i) => s + i.totalPrice, 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    // Update table status to OCCUPIED if dine-in
    let tableNumber: string | null = null;
    if (dto.tableId && dto.type === 'DINE_IN') {
      const table = await this.prisma.diningTable.update({
        where: { id: dto.tableId },
        data: { status: 'OCCUPIED' },
      });
      tableNumber = table.tableNumber;
    }

    // Resolve customer info if provided
    let customerName: string | null = null;
    let customerPhone: string | null = null;
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId } });
      if (customer) {
        customerName = customer.name;
        customerPhone = customer.phone;
      }
    }

    const order = await this.prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        branchId,
        cashierId,
        tableId: dto.tableId ?? null,
        tableNumber,
        customerId: dto.customerId ?? null,
        customerName,
        customerPhone,
        waiterId: dto.waiterId ?? null,
        guestCount: dto.guestCount ?? 0,
        type: dto.type,
        status: 'CONFIRMED',
        notes: dto.notes ?? null,
        subtotal,
        taxAmount,
        serviceChargeAmount,
        discountAmount: 0,
        totalAmount,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    this.ws.emitToBranch(branchId, 'order:created', order);
    if (await this.branchSettings.isKdsEnabled(branchId)) {
      this.ws.emitToKds(branchId, 'kds:ticket:new', order);
    }
    if (dto.tableId) this.ws.emitToBranch(branchId, 'table:updated', { id: dto.tableId, status: 'OCCUPIED' });

    // Deduct stock via recipe engine (best-effort, non-blocking)
    void this.recipeService.deductStockForOrder(
      branchId,
      order.id,
      dto.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    );

    return order;
  }

  async processPayment(id: string, branchId: string, dto: ProcessPaymentDto) {
    const order = await this.findOne(id, branchId);
    if (order.status === 'PAID') throw new BadRequestException('Order already paid');
    if (order.status === 'VOID') throw new BadRequestException('Cannot pay a voided order');

    const total = order.totalAmount.toNumber();

    // Validate split amounts
    if (dto.method === 'SPLIT') {
      if (!dto.splits || dto.splits.length < 2) {
        throw new BadRequestException('Split payment requires at least 2 payment methods');
      }
      const splitTotal = dto.splits.reduce((s, sp) => s + sp.amount, 0);
      if (Math.abs(splitTotal - total) > 1) {
        throw new BadRequestException('Split amounts must equal order total');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Create payment records
      if (dto.method === 'SPLIT' && dto.splits) {
        await tx.orderPayment.createMany({
          data: dto.splits.map((sp) => ({
            orderId: id,
            method: sp.method,
            amount: sp.amount,
            reference: sp.reference ?? null,
          })),
        });
      } else {
        await tx.orderPayment.create({
          data: {
            orderId: id,
            method: dto.method as any,
            amount: total,
          },
        });
      }

      return tx.order.update({
        where: { id },
        data: {
          status: 'PAID',
          paymentMethod: dto.method,
          paidAt: new Date(),
        },
        include: { items: true, payments: true },
      });
    });

    // Update linked account balances (best-effort, non-blocking)
    if (dto.method === 'SPLIT' && dto.splits) {
      for (const sp of dto.splits) {
        void this.accountService.updateAccountForPayment(branchId, sp.method, sp.amount, 'SALE', `Order #${updated.orderNumber}`);
      }
    } else {
      void this.accountService.updateAccountForPayment(branchId, dto.method, total, 'SALE', `Order #${updated.orderNumber}`);
    }

    // Free the table
    if (order.tableId) {
      await this.prisma.diningTable.update({
        where: { id: order.tableId },
        data: { status: 'CLEANING' },
      });
      this.ws.emitToBranch(branchId, 'table:updated', { id: order.tableId, status: 'CLEANING' });
    }

    this.ws.emitToBranch(branchId, 'order:paid', updated);
    this.ws.emitToKds(branchId, 'kds:ticket:done', id);

    // Update customer stats
    if (order.customerId) {
      void this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { increment: 1 },
          totalSpent: { increment: total },
          lastVisit: new Date(),
        },
      }).catch(() => {});
    }

    return updated;
  }

  async applyDiscount(orderId: string, branchId: string, discountId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') throw new BadRequestException('Cannot modify this order');
    if (order.couponId) throw new BadRequestException('Remove coupon before applying a discount');

    const discount = await this.prisma.discount.findFirst({ where: { id: discountId, branchId, isActive: true } });
    if (!discount) throw new BadRequestException('Discount not found');

    const activeItems = order.items.filter((i) => !i.voidedAt);
    const items = activeItems.map((i) => ({ menuItemId: i.menuItemId, totalPrice: i.totalPrice.toNumber() }));

    const targets: string[] = discount.targetItems ? JSON.parse(discount.targetItems) : [];
    let applicableTotal = 0;
    for (const item of items) {
      if (discount.scope === 'ALL_ITEMS') applicableTotal += item.totalPrice;
      else if (discount.scope === 'SPECIFIC_ITEMS' && targets.includes(item.menuItemId)) applicableTotal += item.totalPrice;
      else if (discount.scope === 'ALL_EXCEPT' && !targets.includes(item.menuItemId)) applicableTotal += item.totalPrice;
    }

    const discountAmount = discount.type === 'FLAT'
      ? Math.min(discount.value.toNumber(), applicableTotal)
      : Math.round(applicableTotal * (discount.value.toNumber() / 100));

    const subtotal = activeItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, discountAmount);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount, discountId, discountName: discount.name, couponId: null, couponCode: null, totalAmount, taxAmount, serviceChargeAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async removeDiscount(orderId: string, branchId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') throw new BadRequestException('Cannot modify this order');

    // Decrement coupon usage if removing a coupon
    if (order.couponId) {
      await this.prisma.coupon.update({ where: { id: order.couponId }, data: { usedCount: { decrement: 1 } } });
    }

    const activeItems = order.items.filter((i) => !i.voidedAt);
    const subtotal = activeItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount: 0, discountId: null, discountName: null, couponId: null, couponCode: null, totalAmount, taxAmount, serviceChargeAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async applyCoupon(orderId: string, branchId: string, code: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') throw new BadRequestException('Cannot modify this order');
    if (order.discountId) throw new BadRequestException('Remove discount before applying a coupon');

    // If replacing an existing coupon, decrement old coupon usage
    if (order.couponId) {
      await this.prisma.coupon.update({ where: { id: order.couponId }, data: { usedCount: { decrement: 1 } } });
    }

    const coupon = await this.prisma.coupon.findFirst({ where: { branchId, code: code.toUpperCase(), isActive: true } });
    if (!coupon) throw new BadRequestException('Invalid coupon code');
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new BadRequestException('Coupon has expired');
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) throw new BadRequestException('Coupon usage limit reached');

    const activeItems = order.items.filter((i) => !i.voidedAt);
    const items = activeItems.map((i) => ({ menuItemId: i.menuItemId, totalPrice: i.totalPrice.toNumber() }));

    const targets: string[] = coupon.targetItems ? JSON.parse(coupon.targetItems) : [];
    let applicableTotal = 0;
    for (const item of items) {
      if (coupon.scope === 'ALL_ITEMS') applicableTotal += item.totalPrice;
      else if (coupon.scope === 'SPECIFIC_ITEMS' && targets.includes(item.menuItemId)) applicableTotal += item.totalPrice;
      else if (coupon.scope === 'ALL_EXCEPT' && !targets.includes(item.menuItemId)) applicableTotal += item.totalPrice;
    }

    const discountAmount = coupon.type === 'FLAT'
      ? Math.min(coupon.value.toNumber(), applicableTotal)
      : Math.round(applicableTotal * (coupon.value.toNumber() / 100));

    const subtotal = activeItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, discountAmount);

    await this.prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount, couponId: coupon.id, couponCode: coupon.code, discountName: coupon.name, discountId: null, totalAmount, taxAmount, serviceChargeAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async voidItem(orderId: string, itemId: string, branchId: string, dto: VoidOrderItemDto) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID') throw new BadRequestException('Cannot void items on a paid order');
    if (order.status === 'VOID') throw new BadRequestException('Order is voided');

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.voidedAt) throw new BadRequestException('Item already voided');

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { voidedAt: new Date(), voidReason: dto.reason, voidedById: dto.approverId },
    });

    // Recalculate totals excluding voided items
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const remaining = order.items.filter((i) => i.id !== itemId && !i.voidedAt);
    const subtotal = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    // If ALL items are now voided, auto-void the entire order and free the table
    if (remaining.length === 0) {
      const voidedOrder = await this.prisma.order.update({
        where: { id: orderId },
        data: { subtotal: 0, taxAmount: 0, serviceChargeAmount: 0, totalAmount: 0, status: 'VOID', voidReason: 'All items voided', voidedById: dto.approverId, voidedAt: new Date() },
        include: { items: true, payments: true },
      });

      // Free the table
      if (order.tableId) {
        await this.prisma.diningTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
        this.ws.emitToBranch(branchId, 'table:updated', { id: order.tableId, status: 'AVAILABLE' });
      }

      this.ws.emitToBranch(branchId, 'order:cancelled', voidedOrder);
      this.ws.emitToKds(branchId, 'kds:ticket:done', orderId);

      // Handle waste logging for this last voided item
      if (dto.logAsWaste) {
        const recipe = await this.prisma.recipe.findUnique({
          where: { menuItemId: item.menuItemId },
          include: { items: { include: { ingredient: true } } },
        });
        if (recipe) {
          for (const ri of recipe.items) {
            const wasteQty = ri.quantity.toNumber() * item.quantity;
            await this.prisma.wasteLog.create({
              data: { branchId, ingredientId: ri.ingredientId, quantity: wasteQty, reason: (dto.wasteReason ?? 'PREPARATION_ERROR') as any, notes: `Void waste: ${item.menuItemName} ×${item.quantity} — ${dto.reason}`, recordedById: dto.approverId },
            });
            await this.prisma.stockMovement.create({
              data: { branchId, ingredientId: ri.ingredientId, type: 'WASTE', quantity: -wasteQty, notes: `Void waste: ${item.menuItemName} ×${item.quantity}`, staffId: dto.approverId },
            });
            await this.prisma.stockMovement.create({
              data: { branchId, ingredientId: ri.ingredientId, type: 'VOID_RETURN', quantity: wasteQty, notes: `Void return: ${item.menuItemName} (logged as waste)`, staffId: dto.approverId },
            });
          }
        }
      } else {
        void this.recipeService.restoreStockForItems(branchId, orderId, [
          { menuItemId: item.menuItemId, quantity: item.quantity },
        ]);
      }

      return voidedOrder;
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount },
      include: { items: true },
    });

    if (dto.logAsWaste) {
      // Item was prepared but wasted — stock was already deducted on order creation
      // Log waste entries + stock movements for tracking
      const recipe = await this.prisma.recipe.findUnique({
        where: { menuItemId: item.menuItemId },
        include: { items: { include: { ingredient: true } } },
      });
      if (recipe) {
        for (const ri of recipe.items) {
          const wasteQty = ri.quantity.toNumber() * item.quantity;
          // Waste log for waste tracking
          await this.prisma.wasteLog.create({
            data: {
              branchId,
              ingredientId: ri.ingredientId,
              quantity: wasteQty,
              reason: (dto.wasteReason ?? 'PREPARATION_ERROR') as any,
              notes: `Void waste: ${item.menuItemName} ×${item.quantity} — ${dto.reason}`,
              recordedById: dto.approverId,
            },
          });
          // Stock movement for movement history (stock already deducted as SALE, now record as WASTE)
          await this.prisma.stockMovement.create({
            data: {
              branchId,
              ingredientId: ri.ingredientId,
              type: 'WASTE',
              quantity: -wasteQty,
              notes: `Void waste: ${item.menuItemName} ×${item.quantity} — ${dto.reason}`,
              staffId: dto.approverId,
            },
          });
          // Restore the SALE deduction then re-deduct as WASTE (net zero stock change, but movements are correct)
          // Actually stock was already deducted on order creation as SALE. We just need to record a WASTE movement.
          // But we should also create a VOID_RETURN to cancel the SALE, then a WASTE to record the waste.
          // This gives accurate movement history: SALE → VOID_RETURN → WASTE
          await this.prisma.stockMovement.create({
            data: {
              branchId,
              ingredientId: ri.ingredientId,
              type: 'VOID_RETURN',
              quantity: wasteQty,
              notes: `Void return: ${item.menuItemName} ×${item.quantity} (logged as waste)`,
              staffId: dto.approverId,
            },
          });
        }
      }
    } else {
      // Item wasn't prepared — restore stock
      void this.recipeService.restoreStockForItems(branchId, orderId, [
        { menuItemId: item.menuItemId, quantity: item.quantity },
      ]);
    }

    return updatedOrder;
  }

  async createQrOrder(branchId: string, dto: CreateOrderDto) {
    // Find any active cashier/owner for the branch to use as the cashier ID
    const cashier = await this.prisma.staff.findFirst({
      where: { branchId, isActive: true, role: { in: ['CASHIER', 'OWNER', 'MANAGER'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!cashier) throw new BadRequestException('No cashier available for this branch');

    // Create order then set to PENDING (QR orders need staff acceptance)
    const order = await this.create(branchId, cashier.id, dto);

    const pendingOrder = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'PENDING' },
      include: { items: true, payments: true },
    });

    // Emit to POS for acceptance (override the CONFIRMED event from create)
    this.ws.emitToBranch(branchId, 'order:created', pendingOrder);

    // Update customer lastVisit
    if (dto.customerId) {
      void this.prisma.customer.update({
        where: { id: dto.customerId },
        data: { lastVisit: new Date() },
      }).catch(() => {});
    }

    return pendingOrder;
  }

  async acceptOrder(id: string, branchId: string) {
    const order = await this.findOne(id, branchId);
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not pending acceptance');

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    if (await this.branchSettings.isKdsEnabled(branchId)) {
      this.ws.emitToKds(branchId, 'kds:ticket:new', updated);
    }

    return updated;
  }

  async addItemsToOrder(id: string, branchId: string, items: { menuItemId: string; quantity: number; notes?: string }[], needsApproval = false) {
    const order = await this.findOne(id, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot add items to this order');
    }

    const menuItemIds = items.map((i) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId, deletedAt: null, isAvailable: true },
    });

    if (menuItems.length !== menuItemIds.length) {
      throw new BadRequestException('One or more menu items are unavailable');
    }

    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });

    // Fetch active menu item discounts
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
    const menuDiscounts = await this.prisma.menuItemDiscount.findMany({
      where: { menuItemId: { in: menuItemIds }, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
    });

    const getDiscountedPrice = (menuItemId: string, originalPrice: number): number => {
      const discount = menuDiscounts.find((d) => {
        if (d.menuItemId !== menuItemId) return false;
        if (d.applicableDays) { const days: string[] = JSON.parse(d.applicableDays); if (!days.includes(dayName)) return false; }
        return true;
      });
      if (!discount) return originalPrice;
      if (discount.type === 'FLAT') return Math.max(0, originalPrice - discount.value.toNumber());
      return Math.round(originalPrice * (1 - discount.value.toNumber() / 100));
    };

    const newItems = items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const unitPrice = getDiscountedPrice(item.menuItemId, menuItem.price.toNumber());
      return {
        orderId: id,
        menuItemId: item.menuItemId,
        menuItemName: menuItem.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        notes: item.notes ?? null,
        kitchenStatus: needsApproval ? 'PENDING_APPROVAL' as const : 'NEW' as const,
      };
    });

    await this.prisma.orderItem.createMany({ data: newItems });

    // Recalculate totals (only count approved + non-voided items)
    const allItems = await this.prisma.orderItem.findMany({ where: { orderId: id, voidedAt: null } });
    const subtotal = allItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, needsApproval ? 'order:items-pending' : 'order:updated', updated);

    // Only deduct stock for immediately approved items
    if (!needsApproval) {
      void this.recipeService.deductStockForOrder(
        branchId, id,
        items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      );
    }

    return updated;
  }

  async approveNewItems(id: string, branchId: string) {
    const order = await this.findOne(id, branchId);
    const pendingItems = order.items.filter((i) => i.kitchenStatus === 'PENDING_APPROVAL' && !i.voidedAt);
    if (pendingItems.length === 0) throw new BadRequestException('No pending items to approve');

    await this.prisma.orderItem.updateMany({
      where: { orderId: id, kitchenStatus: 'PENDING_APPROVAL', voidedAt: null },
      data: { kitchenStatus: 'NEW' },
    });

    const updated = await this.prisma.order.findFirstOrThrow({
      where: { id },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    if (await this.branchSettings.isKdsEnabled(branchId)) {
      this.ws.emitToKds(branchId, 'kds:ticket:new', updated);
    }

    // Deduct stock for newly approved items
    void this.recipeService.deductStockForOrder(
      branchId, id,
      pendingItems.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    );

    return updated;
  }

  async rejectNewItems(id: string, branchId: string) {
    const order = await this.findOne(id, branchId);
    const pendingItems = order.items.filter((i) => i.kitchenStatus === 'PENDING_APPROVAL' && !i.voidedAt);
    if (pendingItems.length === 0) throw new BadRequestException('No pending items to reject');

    await this.prisma.orderItem.updateMany({
      where: { orderId: id, kitchenStatus: 'PENDING_APPROVAL', voidedAt: null },
      data: { voidedAt: new Date(), voidReason: 'Rejected by cashier' },
    });

    // Recalculate totals
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const remaining = await this.prisma.orderItem.findMany({ where: { orderId: id, voidedAt: null } });
    const subtotal = remaining.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async approveItem(orderId: string, itemId: string, branchId: string) {
    const order = await this.findOne(orderId, branchId);
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.kitchenStatus !== 'PENDING_APPROVAL') throw new BadRequestException('Item is not pending approval');

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { kitchenStatus: 'NEW' },
    });

    const updated = await this.prisma.order.findFirstOrThrow({
      where: { id: orderId },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    if (await this.branchSettings.isKdsEnabled(branchId)) {
      this.ws.emitToKds(branchId, 'kds:ticket:new', updated);
    }

    void this.recipeService.deductStockForOrder(
      branchId, orderId,
      [{ menuItemId: item.menuItemId, quantity: item.quantity }],
    );

    return updated;
  }

  async rejectItem(orderId: string, itemId: string, branchId: string) {
    const order = await this.findOne(orderId, branchId);
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.kitchenStatus !== 'PENDING_APPROVAL') throw new BadRequestException('Item is not pending approval');

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { voidedAt: new Date(), voidReason: 'Rejected by cashier' },
    });

    // Recalculate totals
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const remaining = await this.prisma.orderItem.findMany({ where: { orderId, voidedAt: null } });
    const subtotal = remaining.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async cancelItemByCustomer(orderId: string, itemId: string, branchId: string) {
    const order = await this.findOne(orderId, branchId);

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.voidedAt) throw new BadRequestException('Item already cancelled');

    // Allow cancel if: order is PENDING (any item), or item is PENDING_APPROVAL (awaiting cashier)
    const canCancel = order.status === 'PENDING' || item.kitchenStatus === 'PENDING_APPROVAL';
    if (!canCancel) {
      throw new BadRequestException('This item can no longer be cancelled');
    }

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { voidedAt: new Date(), voidReason: 'Cancelled by customer' },
    });

    // Recalculate
    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });
    const remaining = order.items.filter((i) => i.id !== itemId && !i.voidedAt);
    const subtotal = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
    const { serviceChargeAmount, taxAmount, totalAmount } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);

    // Restore stock
    void this.recipeService.restoreStockForItems(branchId, orderId, [
      { menuItemId: item.menuItemId, quantity: item.quantity },
    ]);

    return updated;
  }

  async setWaiter(orderId: string, branchId: string, waiterId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot update a completed order');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { waiterId },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async setGuestCount(orderId: string, branchId: string, guestCount: number) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot update a completed order');
    }
    const clamped = Math.max(0, Math.min(999, Math.floor(Number(guestCount) || 0)));
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { guestCount: clamped },
      include: { items: true, payments: true },
    });
    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async updateItemNotes(orderId: string, itemId: string, branchId: string, notes: string) {
    const order = await this.findOne(orderId, branchId);
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item not found');

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { notes: notes || null },
    });

    const updated = await this.prisma.order.findFirstOrThrow({
      where: { id: orderId },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async moveItemToTable(orderId: string, itemId: string, branchId: string, targetTableId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot move items from this order');
    }

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item not found in order');
    if (item.voidedAt) throw new BadRequestException('Cannot move a voided item');

    if (order.tableId === targetTableId) {
      throw new BadRequestException('Item is already on this table');
    }

    const targetTable = await this.prisma.diningTable.findFirst({
      where: { id: targetTableId, branchId },
    });
    if (!targetTable) throw new NotFoundException('Target table not found');

    // Find or create an active order on the target table
    const existing = await this.prisma.order.findFirst({
      where: {
        branchId,
        tableId: targetTableId,
        status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] },
      },
      select: { id: true },
    });

    let targetOrderId: string;
    if (existing) {
      targetOrderId = existing.id;
    } else {
      const orderNumber = generateOrderNumber();
      const created = await this.prisma.order.create({
        data: {
          branchId,
          orderNumber,
          tableId: targetTableId,
          tableNumber: targetTable.tableNumber,
          type: order.type,
          status: order.status === 'PENDING' ? 'PENDING' : 'CONFIRMED',
          subtotal: 0,
          taxAmount: 0,
          totalAmount: 0,
          cashierId: order.cashierId,
        },
      });
      targetOrderId = created.id;

      await this.prisma.diningTable.update({
        where: { id: targetTableId },
        data: { status: 'OCCUPIED' },
      });
      this.ws.emitToBranch(branchId, 'table:updated', { id: targetTableId, status: 'OCCUPIED' });
    }

    // Reassign the item to the target order
    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { orderId: targetOrderId },
    });

    const branch = await this.prisma.branch.findFirstOrThrow({ where: { id: branchId } });

    // Recalculate target order totals
    const targetItems = await this.prisma.orderItem.findMany({
      where: { orderId: targetOrderId, voidedAt: null },
    });
    const tSubtotal = targetItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const tTotals = computeTotals(branch, tSubtotal, 0);
    await this.prisma.order.update({
      where: { id: targetOrderId },
      data: { subtotal: tSubtotal, taxAmount: tTotals.taxAmount, serviceChargeAmount: tTotals.serviceChargeAmount, totalAmount: tTotals.totalAmount },
    });

    // Recalculate source order totals
    const srcItems = await this.prisma.orderItem.findMany({
      where: { orderId, voidedAt: null },
    });
    const sSubtotal = srcItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const sTotals = computeTotals(branch, sSubtotal, 0);
    const updatedSource = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal: sSubtotal, taxAmount: sTotals.taxAmount, serviceChargeAmount: sTotals.serviceChargeAmount, totalAmount: sTotals.totalAmount },
      include: { items: true, payments: true },
    });

    // If source has no remaining active items, leave the order but free the table
    // (Cashier can void it manually if desired). Don't auto-void to preserve audit trail.

    const updatedTarget = await this.prisma.order.findFirstOrThrow({
      where: { id: targetOrderId },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updatedSource);
    this.ws.emitToBranch(branchId, 'order:updated', updatedTarget);

    return updatedSource;
  }

  async moveTable(orderId: string, branchId: string, newTableId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot move a completed order');
    }

    const newTable = await this.prisma.diningTable.findFirst({
      where: { id: newTableId, branchId },
    });
    if (!newTable) throw new NotFoundException('Table not found');

    // Free old table
    if (order.tableId) {
      await this.prisma.diningTable.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE' },
      });
      this.ws.emitToBranch(branchId, 'table:updated', { id: order.tableId, status: 'AVAILABLE' });
    }

    // Occupy new table
    await this.prisma.diningTable.update({
      where: { id: newTableId },
      data: { status: 'OCCUPIED' },
    });
    this.ws.emitToBranch(branchId, 'table:updated', { id: newTableId, status: 'OCCUPIED' });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { tableId: newTableId, tableNumber: newTable.tableNumber },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);

    return updated;
  }

  async requestBill(orderId: string, branchId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') {
      throw new BadRequestException('Cannot request bill for this order');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { billRequested: true },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'bill:requested', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      totalAmount: order.totalAmount,
    });
    this.ws.emitToBranch(branchId, 'order:updated', updated);

    return { message: 'Bill request sent to staff' };
  }

  async voidOrder(id: string, branchId: string, dto: VoidOrderDto) {
    const order = await this.findOne(id, branchId);
    if (order.status === 'PAID') throw new BadRequestException('Cannot void a paid order');
    if (order.status === 'VOID') throw new BadRequestException('Order already voided');

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: 'VOID',
        voidReason: dto.reason,
        voidedById: dto.approverId,
        voidedAt: new Date(),
      },
      include: { items: true },
    });

    // Free the table
    if (order.tableId) {
      await this.prisma.diningTable.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE' },
      });
      this.ws.emitToBranch(branchId, 'table:updated', { id: order.tableId, status: 'AVAILABLE' });
    }

    this.ws.emitToBranch(branchId, 'order:cancelled', updated);
    this.ws.emitToKds(branchId, 'kds:ticket:done', id);

    // Restore stock for all non-already-voided items
    const activeItems = order.items.filter((i) => !i.voidedAt);
    if (activeItems.length > 0) {
      void this.recipeService.restoreStockForItems(
        branchId,
        id,
        activeItems.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      );
    }

    return updated;
  }
}

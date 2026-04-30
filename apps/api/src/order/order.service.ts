import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

import type { Prisma } from '@prisma/client';
import type { CreateOrderDto, ProcessPaymentDto, VoidOrderDto, VoidOrderItemDto, RefundOrderDto, RefundReason, CorrectPaymentDto, AddonSelectionInput, OrderItemAddonSnapshot } from '@restora/types';
import { generateOrderNumber, type MushakLineItem, type MushakBuyerBlock } from '@restora/utils';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../ws-gateway/realtime.gateway';
import { RecipeService } from '../recipe/recipe.service';
import { AccountService } from '../account/account.service';
import { BranchSettingsService } from '../branch-settings/branch-settings.service';
import { LicenseService } from '../license/license.service';
import { SmsService } from '../sms/sms.service';
import { MushakService } from '../mushak/mushak.service';

/**
 * Service charge + VAT calculator used by every place that recomputes an
 * order's totals (create, add-items, apply-discount / coupon, void).
 * Respects the branch-level vatEnabled + serviceChargeEnabled toggles and
 * the optional per-section `taxableSubtotal` override (for sections that
 * are individually VAT-exempt). When `taxableSubtotal` is omitted, the
 * whole subtotal is considered taxable.
 */
interface TaxableBranch {
  vatEnabled: boolean;
  taxRate: { toNumber(): number };
  serviceChargeEnabled: boolean;
  serviceChargeRate: { toNumber(): number };
}
function computeTotals(branch: TaxableBranch, subtotal: number, discountAmount = 0, taxableSubtotal?: number) {
  const net = Math.max(0, subtotal - discountAmount);
  const serviceChargeAmount = branch.serviceChargeEnabled && branch.serviceChargeRate.toNumber() > 0
    ? Math.round(net * (branch.serviceChargeRate.toNumber() / 100))
    : 0;
  // VAT base = taxable portion of net (after proportional discount) + full
  // service charge. Service charge stays taxable for simplicity; admins
  // who need a VAT-free SC can turn VAT off branch-wide.
  let taxableNet = net;
  if (taxableSubtotal != null && subtotal > 0) {
    const taxableShareOfSubtotal = Math.min(1, Math.max(0, taxableSubtotal / subtotal));
    taxableNet = Math.max(0, Math.round(net * taxableShareOfSubtotal));
  }
  const taxAmount = branch.vatEnabled && branch.taxRate.toNumber() > 0
    ? Math.round((taxableNet + serviceChargeAmount) * (branch.taxRate.toNumber() / 100))
    : 0;
  const rawTotal = net + serviceChargeAmount + taxAmount;
  // Auto-round to the nearest taka (= 100 paisa). Cash practice in BD
  // restaurants — coins under a taka are rare, so a 973.70 BDT bill is
  // rounded to 974.00 with +0.30 printed on the receipt as "Auto Roundup".
  // Math.round is half-up: 973.70 → 974, 973.20 → 973. Delta is signed.
  const totalAmount = Math.round(rawTotal / 100) * 100;
  const roundAdjustment = totalAmount - rawTotal;
  return { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment };
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RealtimeGateway,
    private readonly recipeService: RecipeService,
    private readonly accountService: AccountService,
    private readonly branchSettings: BranchSettingsService,
    // Inline license check — defence-in-depth so a cracker who patches
    // out the global APP_GUARD still trips on this in the hot path.
    private readonly license: LicenseService,
    private readonly sms: SmsService,
    private readonly mushak: MushakService,
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
      items: activeItems.map((i) => {
        const mods = (i as { modifications?: { removedNames?: string[] } | null }).modifications;
        const removed = mods?.removedNames ?? [];
        const addons = ((i as { addons?: { addonName: string }[] | null }).addons) ?? [];
        return {
          name: i.menuItemName,
          quantity: i.quantity,
          notes: i.notes,
          removedIngredients: removed,
          // Surface selected addons so the chef knows what extras /
          // sides / sauces to plate. Renderers append "+ Cheese Sauce"
          // under the item line.
          selectedAddons: addons.map((a) => a.addonName),
        };
      }),
      notes: order.notes,
    };
  }

  /**
   * Validate + resolve a single line's addon picks against the parent
   * menu item's addon groups. Returns:
   *   - snapshot: frozen array stored on OrderItem.addons
   *   - addonRecipeItems: synthetic [{menuItemId, quantity}] entries
   *     for the recipe-deduction engine, one per selected addon
   *     (multiplied by the line quantity).
   *   - extraUnitPrice: paisa to add to the line's unit price.
   *
   * Throws BadRequestException when:
   *   - groupId references a group that doesn't belong to this menu item
   *   - addonItemId isn't a valid option in that group
   *   - more than maxPicks selections in any group
   *   - fewer than minPicks selections in any required group
   */
  private async resolveAddonsForLine(
    branchId: string,
    menuItemId: string,
    quantity: number,
    selections: AddonSelectionInput[],
  ): Promise<{ snapshot: OrderItemAddonSnapshot[]; addonRecipeItems: { menuItemId: string; quantity: number }[]; extraUnitPrice: number }> {
    // Pull the parent's groups + their valid options.
    const groups = await this.prisma.menuItemAddonGroup.findMany({
      where: { menuItemId, branchId, deletedAt: null },
      include: {
        options: {
          include: { addon: { select: { id: true, name: true, price: true, isAvailable: true, isAddon: true } } },
        },
      },
    });
    if (groups.length === 0 && selections.length === 0) {
      return { snapshot: [], addonRecipeItems: [], extraUnitPrice: 0 };
    }

    const validByGroup = new Map<string, Map<string, { id: string; name: string; price: { toNumber(): number } }>>();
    for (const g of groups) {
      const map = new Map<string, { id: string; name: string; price: { toNumber(): number } }>();
      for (const opt of g.options) {
        if (opt.addon.isAvailable !== false && opt.addon.isAddon) {
          map.set(opt.addon.id, { id: opt.addon.id, name: opt.addon.name, price: opt.addon.price });
        }
      }
      validByGroup.set(g.id, map);
    }

    // Tally picks per group.
    const picksByGroup = new Map<string, AddonSelectionInput[]>();
    for (const sel of selections ?? []) {
      const valid = validByGroup.get(sel.groupId);
      if (!valid) throw new BadRequestException('Addon group does not belong to this menu item');
      if (!valid.has(sel.addonItemId)) throw new BadRequestException('Selected addon is not part of its group');
      const arr = picksByGroup.get(sel.groupId) ?? [];
      arr.push(sel);
      picksByGroup.set(sel.groupId, arr);
    }

    // Enforce min/max per group.
    for (const g of groups) {
      const picks = picksByGroup.get(g.id) ?? [];
      if (picks.length > g.maxPicks) {
        throw new BadRequestException(`"${g.name}" allows at most ${g.maxPicks} pick(s); got ${picks.length}`);
      }
      if (picks.length < g.minPicks) {
        throw new BadRequestException(`"${g.name}" requires at least ${g.minPicks} pick(s); got ${picks.length}`);
      }
    }

    // Build snapshot + per-unit price + recipe-deduction entries.
    const snapshot: OrderItemAddonSnapshot[] = [];
    const addonRecipeItems: { menuItemId: string; quantity: number }[] = [];
    let extraUnitPrice = 0;
    for (const g of groups) {
      const picks = picksByGroup.get(g.id) ?? [];
      for (const sel of picks) {
        const opt = validByGroup.get(g.id)!.get(sel.addonItemId)!;
        const price = opt.price.toNumber();
        snapshot.push({
          groupId: g.id,
          groupName: g.name,
          addonItemId: opt.id,
          addonName: opt.name,
          price,
        });
        extraUnitPrice += price;
        // Deduct the addon's recipe once per ordered unit. Empty recipe
        // = no deduction, which is the "no-stock" footgun admin saw a
        // warning about at addon-group save time.
        addonRecipeItems.push({ menuItemId: opt.id, quantity });
      }
    }

    return { snapshot, addonRecipeItems, extraUnitPrice };
  }

  async create(branchId: string, cashierId: string, dto: CreateOrderDto) {
    this.license.assertMutation('order.create');
    // Fetch menu items to get prices and names
    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId, deletedAt: null, isAvailable: true },
    });

    if (menuItems.length !== menuItemIds.length) {
      throw new BadRequestException('One or more menu items are unavailable');
    }

    // Reject parent variant shells — those are picker placeholders, not
    // sellable items. POS opens a chooser when a parent is tapped.
    const parents = menuItems.filter((m) => (m as { isVariantParent?: boolean }).isVariantParent);
    if (parents.length > 0) {
      throw new BadRequestException(`These items have variants — pick a variant: ${parents.map((p) => p.name).join(', ')}`);
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

    // Resolve removed-ingredient names once per order (snapshot-frozen
    // on the OrderItem so a future ingredient rename doesn't rewrite
    // history). Uses a single lookup across all unique IDs.
    const allRemovedIds = Array.from(new Set(dto.items.flatMap((i) => i.removedIngredientIds ?? [])));
    const removedIngLookup = allRemovedIds.length > 0
      ? new Map(
          (await this.prisma.ingredient.findMany({
            where: { id: { in: allRemovedIds } },
            select: { id: true, name: true },
          })).map((i) => [i.id, i.name] as const),
        )
      : new Map<string, string>();
    const buildModsSnapshot = (removedIds?: string[]) => {
      const ids = (removedIds ?? []).filter((id) => removedIngLookup.has(id));
      if (ids.length === 0) return null;
      return {
        removedIngredientIds: ids,
        removedNames: ids.map((id) => removedIngLookup.get(id) as string),
      };
    };

    // Calculate totals with discounted prices + resolve any addon
    // selections per line. Addon picks are validated against the
    // parent menu item's addon groups; their recipes feed the stock-
    // deduction step below, and a snapshot of {group, addon, price}
    // is frozen on each OrderItem.
    const itemsData = await Promise.all(dto.items.map(async (item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const baseUnit = getDiscountedPrice(item.menuItemId, menuItem.price.toNumber());
      const mods = buildModsSnapshot(item.removedIngredientIds);
      const addonRes = await this.resolveAddonsForLine(branchId, item.menuItemId, item.quantity, item.addons ?? []);
      const unitPrice = baseUnit + addonRes.extraUnitPrice;
      return {
        menuItemId: item.menuItemId,
        menuItemName: menuItem.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        notes: item.notes ?? null,
        modifications: mods as Prisma.InputJsonValue | undefined,
        addons: addonRes.snapshot.length > 0 ? (addonRes.snapshot as unknown as Prisma.InputJsonValue) : undefined,
        // Carry the deduction list on a non-persisted property; we
        // pull it back out below before passing to the recipe engine.
        _addonRecipeItems: addonRes.addonRecipeItems,
      };
    }));

    const subtotal = itemsData.reduce((s, i) => s + i.totalPrice, 0);
    // Per-section VAT: items routed to a section with vatEnabled=false
    // contribute to subtotal but not to the taxable base.
    const sectionIds = Array.from(new Set(menuItems.map((m) => m.cookingStationId).filter((id): id is string => !!id)));
    const stations = sectionIds.length
      ? await this.prisma.cookingStation.findMany({ where: { id: { in: sectionIds } } })
      : [];
    const vatOptOut = new Set(
      stations
        .filter((s) => (s as unknown as { vatEnabled?: boolean }).vatEnabled === false)
        .map((s) => s.id),
    );
    const taxableSubtotal = itemsData.reduce((s, i) => {
      const m = menuItems.find((mm) => mm.id === i.menuItemId);
      if (m?.cookingStationId && vatOptOut.has(m.cookingStationId)) return s;
      return s + i.totalPrice;
    }, 0);
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0, taxableSubtotal);

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

    // Strip the helper-only _addonRecipeItems before passing to Prisma.
    const itemsForCreate = itemsData.map((row) => {
      const { _addonRecipeItems, ...rest } = row;
      void _addonRecipeItems; // referenced solely to satisfy TS noUnused
      return rest;
    });
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
        roundAdjustment,
        items: { create: itemsForCreate },
      },
      include: { items: true },
    });

    this.ws.emitToBranch(branchId, 'order:created', order);
    if (await this.branchSettings.isKdsEnabled(branchId)) {
      this.ws.emitToKds(branchId, 'kds:ticket:new', order);
    }
    if (dto.tableId) this.ws.emitToBranch(branchId, 'table:updated', { id: dto.tableId, status: 'OCCUPIED' });

    // Deduct stock via recipe engine (best-effort, non-blocking).
    // Each line contributes its own recipe AND every selected addon's
    // recipe (Phase 3) — addons that have no recipe simply don't
    // deduct anything (admin saw a warning at addon-group save time).
    const baseRecipeItems = dto.items.map((i) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      removedIngredientIds: i.removedIngredientIds,
    }));
    const addonRecipeItems = itemsData.flatMap((i) => i._addonRecipeItems ?? []);
    void this.recipeService.deductStockForOrder(
      branchId,
      order.id,
      [...baseRecipeItems, ...addonRecipeItems],
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

    // Fetch branch up front so we can issue a Mushak-6.3 inside the same
    // transaction when nbrEnabled=true. Keeping this read outside the
    // transaction is fine — branch settings don't race with order payment.
    const branchForMushak = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });

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

      const paidOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'PAID',
          paymentMethod: dto.method,
          paidAt: new Date(),
        },
        include: { items: true, payments: true },
      });

      // NBR Mushak-6.3: issue the tax invoice inside the same transaction
      // so serial allocation + order paid-state either both commit or both
      // roll back. No-op when the branch toggle is off.
      if (branchForMushak.nbrEnabled) {
        await this.mushak.issueInvoiceForOrder(tx, {
          order: paidOrder as never,
          branch: branchForMushak as never,
        });
      }

      return paidOrder;
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

    // Payment-thank-you SMS. Fires only when the branch has it toggled on,
    // the order was attached to a customer with a phone, and the gateway
    // is configured. Fire-and-forget so a transient SMS failure never
    // blocks the checkout flow — the log row records the failure for
    // admin triage.
    void this.maybeSendPaymentSms(branchId, order.id).catch((err) => {
      console.warn(`[order] payment SMS failed for ${order.id}: ${(err as Error).message}`);
    });

    return updated;
  }

  private async maybeSendPaymentSms(branchId: string, orderId: string): Promise<void> {
    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings?.smsPaymentNotifyEnabled) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, payments: true, branch: { select: { name: true } } },
    });
    if (!order?.customerId) return;
    const phone = order.customer?.phone ?? order.customerPhone;
    if (!phone) return;

    // totalAmount is stored in PAISA (project-wide convention — see
    // packages/utils/src/currency.ts). The SMS template's "{{amount}}"
    // is meant to be the human-friendly Taka figure, so divide by 100
    // and format with thousands separators. Strip trailing ".00" for
    // whole-taka amounts to keep the message terse.
    const amountTaka = Number(order.totalAmount ?? 0) / 100;
    const amount = amountTaka
      .toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .replace(/\.00$/, '');
    const method = (order.payments ?? [])
      .map((p) => (p.method ?? 'cash').toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('/');
    const defaultTemplate =
      'Thanks for Dining with {{brand}}. Your payment {{amount}} Taka has been received with {{method}}.';
    const template = settings.smsPaymentTemplate && settings.smsPaymentTemplate.trim()
      ? settings.smsPaymentTemplate
      : defaultTemplate;

    const body = template
      .replace(/\{\{\s*brand\s*\}\}/gi, order.branch?.name ?? '')
      .replace(/\{\{\s*name\s*\}\}/gi, order.customer?.name && order.customer.name.trim() && order.customer.name.trim().toLowerCase() !== 'walk-in'
        ? order.customer.name.trim()
        : 'Dear Customer')
      .replace(/\{\{\s*amount\s*\}\}/gi, amount)
      .replace(/\{\{\s*method\s*\}\}/gi, method || 'payment');

    await this.sms.sendAndLog(branchId, phone, body, {
      kind: 'PAYMENT',
      customerId: order.customerId,
      orderId: order.id,
    });
  }

  async applyDiscount(orderId: string, branchId: string, discountId: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') throw new BadRequestException('Cannot modify this order');
    if (order.couponId) throw new BadRequestException('Remove coupon before applying a discount');
    // Discounts must be tied to a customer so loyalty + usage-audit makes
    // sense. POS shows a "pick a customer first" popup and retries; QR
    // shows a login link. Returning 400 lets the client show that.
    if (!order.customerId) {
      throw new BadRequestException('CUSTOMER_REQUIRED: select or add a customer before applying a discount');
    }

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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, discountAmount);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount, discountId, discountName: discount.name, couponId: null, couponCode: null, totalAmount, taxAmount, serviceChargeAmount, roundAdjustment },
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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount: 0, discountId: null, discountName: null, couponId: null, couponCode: null, totalAmount, taxAmount, serviceChargeAmount, roundAdjustment },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, 'order:updated', updated);
    return updated;
  }

  async applyCoupon(orderId: string, branchId: string, code: string) {
    const order = await this.findOne(orderId, branchId);
    if (order.status === 'PAID' || order.status === 'VOID') throw new BadRequestException('Cannot modify this order');
    if (order.discountId) throw new BadRequestException('Remove discount before applying a coupon');
    // Coupons are tied to a customer account for usage tracking and to
    // block coupon-sharing. Clients detect CUSTOMER_REQUIRED in the
    // error message and show a customer picker (POS) or login link (QR).
    if (!order.customerId) {
      throw new BadRequestException('CUSTOMER_REQUIRED: log in or select a customer before applying a coupon');
    }

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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, discountAmount);

    await this.prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { discountAmount, couponId: coupon.id, couponCode: coupon.code, discountName: coupon.name, discountId: null, totalAmount, taxAmount, serviceChargeAmount, roundAdjustment },
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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    // If ALL items are now voided, auto-void the entire order and free the table
    if (remaining.length === 0) {
      const voidedOrder = await this.prisma.order.update({
        where: { id: orderId },
        data: { subtotal: 0, taxAmount: 0, serviceChargeAmount: 0, totalAmount: 0, roundAdjustment: 0, status: 'VOID', voidReason: 'All items voided', voidedById: dto.approverId, voidedAt: new Date() },
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
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount, roundAdjustment },
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

  async addItemsToOrder(id: string, branchId: string, items: { menuItemId: string; quantity: number; notes?: string; removedIngredientIds?: string[]; addons?: AddonSelectionInput[] }[], needsApproval = false) {
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

    // Reject parent variant shells — pick a variant via the POS chooser.
    const addParents = menuItems.filter((m) => (m as { isVariantParent?: boolean }).isVariantParent);
    if (addParents.length > 0) {
      throw new BadRequestException(`These items have variants — pick a variant: ${addParents.map((p) => p.name).join(', ')}`);
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

    // Snapshot removed-ingredient names so KT print + receipt + reports
    // survive a future ingredient rename. Same engine as `create`.
    const allRemovedIds = Array.from(new Set(items.flatMap((i) => i.removedIngredientIds ?? [])));
    const removedIngLookup = allRemovedIds.length > 0
      ? new Map(
          (await this.prisma.ingredient.findMany({
            where: { id: { in: allRemovedIds } },
            select: { id: true, name: true },
          })).map((i) => [i.id, i.name] as const),
        )
      : new Map<string, string>();
    const buildModsSnapshot = (removedIds?: string[]) => {
      const ids = (removedIds ?? []).filter((id) => removedIngLookup.has(id));
      if (ids.length === 0) return null;
      return {
        removedIngredientIds: ids,
        removedNames: ids.map((id) => removedIngLookup.get(id) as string),
      };
    };

    const newItems = await Promise.all(items.map(async (item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const baseUnit = getDiscountedPrice(item.menuItemId, menuItem.price.toNumber());
      const mods = buildModsSnapshot(item.removedIngredientIds);
      const addonRes = await this.resolveAddonsForLine(branchId, item.menuItemId, item.quantity, item.addons ?? []);
      const unitPrice = baseUnit + addonRes.extraUnitPrice;
      return {
        orderId: id,
        menuItemId: item.menuItemId,
        menuItemName: menuItem.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        notes: item.notes ?? null,
        kitchenStatus: needsApproval ? 'PENDING_APPROVAL' as const : 'NEW' as const,
        modifications: mods as Prisma.InputJsonValue | undefined,
        addons: addonRes.snapshot.length > 0 ? (addonRes.snapshot as unknown as Prisma.InputJsonValue) : undefined,
        _addonRecipeItems: addonRes.addonRecipeItems,
      };
    }));

    const newItemsForCreate = newItems.map((row) => {
      const { _addonRecipeItems, ...rest } = row;
      void _addonRecipeItems;
      return rest;
    });
    await this.prisma.orderItem.createMany({ data: newItemsForCreate });

    // Recalculate totals (only count approved + non-voided items)
    const allItems = await this.prisma.orderItem.findMany({ where: { orderId: id, voidedAt: null } });
    const subtotal = allItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount, roundAdjustment },
      include: { items: true, payments: true },
    });

    this.ws.emitToBranch(branchId, needsApproval ? 'order:items-pending' : 'order:updated', updated);

    // Only deduct stock for immediately approved items. Mods + addon
    // recipes flow through.
    if (!needsApproval) {
      const baseRecipeItems = items.map((i) => ({
        menuItemId: i.menuItemId,
        quantity: i.quantity,
        removedIngredientIds: i.removedIngredientIds,
      }));
      const addonRecipeItems = newItems.flatMap((i) => i._addonRecipeItems ?? []);
      void this.recipeService.deductStockForOrder(
        branchId, id,
        [...baseRecipeItems, ...addonRecipeItems],
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

    // Deduct stock for newly approved items. Honour any per-line
    // removals + selected addons stored on the OrderItem at creation
    // time. Each addon's recipe deducts on top of the base item's.
    const baseRecipe = pendingItems.map((i) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      removedIngredientIds: ((i as { modifications?: { removedIngredientIds?: string[] } | null }).modifications?.removedIngredientIds) ?? undefined,
    }));
    const addonRecipe = pendingItems.flatMap((i) => {
      const addons = (i as { addons?: { addonItemId: string }[] | null }).addons ?? [];
      return addons.map((a) => ({ menuItemId: a.addonItemId, quantity: i.quantity }));
    });
    void this.recipeService.deductStockForOrder(branchId, id, [...baseRecipe, ...addonRecipe]);

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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount, roundAdjustment },
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

    const addons = ((item as { addons?: { addonItemId: string }[] | null }).addons) ?? [];
    void this.recipeService.deductStockForOrder(
      branchId, orderId,
      [
        {
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          removedIngredientIds: ((item as { modifications?: { removedIngredientIds?: string[] } | null }).modifications?.removedIngredientIds) ?? undefined,
        },
        ...addons.map((a) => ({ menuItemId: a.addonItemId, quantity: item.quantity })),
      ],
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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount, roundAdjustment },
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
    const { serviceChargeAmount, taxAmount, totalAmount, roundAdjustment } = computeTotals(branch, subtotal, 0);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceChargeAmount, totalAmount, roundAdjustment },
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
          roundAdjustment: 0,
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
      data: { subtotal: tSubtotal, taxAmount: tTotals.taxAmount, serviceChargeAmount: tTotals.serviceChargeAmount, totalAmount: tTotals.totalAmount, roundAdjustment: tTotals.roundAdjustment },
    });

    // Recalculate source order totals
    const srcItems = await this.prisma.orderItem.findMany({
      where: { orderId, voidedAt: null },
    });
    const sSubtotal = srcItems.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const sTotals = computeTotals(branch, sSubtotal, 0);
    const updatedSource = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal: sSubtotal, taxAmount: sTotals.taxAmount, serviceChargeAmount: sTotals.serviceChargeAmount, totalAmount: sTotals.totalAmount, roundAdjustment: sTotals.roundAdjustment },
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
    this.license.assertMutation('order.void');
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

  /**
   * Refund a paid order (full or per-item). Issues a Mushak-6.8 credit note
   * linked to the original 6.3, restores stock, and reverses the account
   * balance for the refunded portion. Requires an approver staff member
   * (OWNER/MANAGER) verified via their password hash — reuses the same
   * bcrypt-compare pattern the void-approval flow already uses.
   */
  async refundOrder(id: string, branchId: string, staffId: string, dto: RefundOrderDto) {
    this.license.assertMutation('order.refund');

    const order = await this.prisma.order.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException('Only paid orders can be refunded');
    }

    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    if (!branch.nbrEnabled) {
      throw new BadRequestException('Refunds require NBR mode to be enabled on the branch');
    }
    const invoice = await this.prisma.mushakInvoice.findUnique({ where: { orderId: id } });
    if (!invoice) {
      throw new BadRequestException('Original Mushak-6.3 invoice not found for this order');
    }

    // Approver check — a staff member with PIN / password must confirm.
    const approverId = dto.approverId ?? staffId;
    const approver = await this.prisma.staff.findFirst({
      where: { id: approverId, branchId, isActive: true, deletedAt: null },
    });
    if (!approver || (approver.role !== 'OWNER' && approver.role !== 'MANAGER')) {
      throw new BadRequestException('Refund requires OWNER or MANAGER approval');
    }
    if (dto.approverPin) {
      const ok = await bcrypt.compare(dto.approverPin, approver.passwordHash);
      if (!ok) throw new BadRequestException('Approver PIN is incorrect');
    }

    // Determine the items being refunded. Omitted/empty itemIds = whole order.
    const alreadyRefunded = await this.prisma.mushakNote.findMany({
      where: { orderId: id },
      select: { refundedItemIds: true },
    });
    const priorRefundedIds = new Set(
      alreadyRefunded.flatMap((n) => (Array.isArray(n.refundedItemIds) ? (n.refundedItemIds as string[]) : [])),
    );

    const refundingSpecific = !!(dto.itemIds && dto.itemIds.length > 0);
    const candidateItems = order.items.filter((i) => !i.voidedAt);
    const refundTargets = refundingSpecific
      ? candidateItems.filter((i) => dto.itemIds!.includes(i.id) && !priorRefundedIds.has(i.id))
      : candidateItems.filter((i) => !priorRefundedIds.has(i.id));

    if (refundTargets.length === 0) {
      throw new BadRequestException('No eligible items remain to refund');
    }

    // Reuse the same math the invoice used. VAT is distributed proportional
    // to line totals so the refunded VAT exactly mirrors what was collected.
    const refundSubtotal = refundTargets.reduce((s, i) => s + i.totalPrice.toNumber(), 0);
    const orderNet = Math.max(1, order.subtotal.toNumber() - order.discountAmount.toNumber());
    const refundVat = Math.round((refundSubtotal / orderNet) * order.taxAmount.toNumber() * 100) / 100;
    const refundTotal = refundSubtotal + refundVat;

    const refundedItems: MushakLineItem[] = refundTargets.map((i) => {
      const share = Math.round((i.totalPrice.toNumber() / Math.max(1, refundSubtotal)) * refundVat * 100) / 100;
      return {
        id: i.id,
        name: i.menuItemName,
        quantity: -Number(i.quantity),
        unitPrice: i.unitPrice.toNumber(),
        subtotalExclVat: -i.totalPrice.toNumber(),
        sdAmount: 0,
        vatAmount: -share,
        totalInclVat: -(i.totalPrice.toNumber() + share),
      };
    });

    const buyer: MushakBuyerBlock | null = (order.customerName || order.customerPhone)
      ? { name: order.customerName, phone: order.customerPhone }
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const note = await this.mushak.issueNoteForRefund(tx, {
        invoice: { id: invoice.id, serial: invoice.serial, branchId: invoice.branchId, branchCode: invoice.branchCode },
        order: { id: order.id },
        branch: branch as never,
        issuedByStaff: { id: approver.id, name: approver.name },
        reasonCode: dto.reason as RefundReason,
        reasonText: dto.reasonText ?? null,
        noteType: 'CREDIT',
        refundedItems,
        refundedItemIds: refundTargets.map((i) => i.id),
        totals: {
          subtotalExclVat: -refundSubtotal,
          sdAmount: 0,
          vatAmount: -refundVat,
          totalInclVat: -refundTotal,
        },
        buyer,
      });

      // Status transition: full set refunded → REFUNDED, otherwise PARTIALLY.
      const totalRefundedSoFar = priorRefundedIds.size + refundTargets.length;
      const totalCandidates = candidateItems.length;
      const newStatus = totalRefundedSoFar >= totalCandidates ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status: newStatus as never },
        include: { items: true, payments: true },
      });
      return { note, order: updatedOrder };
    });

    // Reverse account balances proportionally across the order's payments
    // (best-effort, non-blocking — same pattern as processPayment).
    const paymentTotal = order.payments.reduce((s, p) => s + p.amount.toNumber(), 0) || 1;
    for (const p of order.payments) {
      const share = Math.round((p.amount.toNumber() / paymentTotal) * refundTotal * 100) / 100;
      if (share > 0) {
        void this.accountService.updateAccountForPayment(
          branchId,
          p.method,
          -share,
          'REFUND' as never,
          `Refund for order #${order.orderNumber} (${result.note.serial})`,
        );
      }
    }

    // Restore stock for the refunded items.
    void this.recipeService.restoreStockForItems(
      branchId,
      id,
      refundTargets.map((i) => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity) })),
    );

    this.ws.emitToBranch(branchId, 'order:updated' as never, { orderId: id, noteId: result.note.id, status: result.order.status });

    return { order: result.order, note: result.note };
  }

  /**
   * Correct the payment method on an already-PAID order. Used when a
   * cashier mistakenly tapped the wrong tender (e.g. CASH instead of
   * bKash, or POS Card instead of Cash). The order total stays
   * identical — only the OrderPayment rows + linked accounts change.
   *
   * Coverage:
   *  - OrderPayment rows: deleted + recreated for the corrected method
   *    (single or split). work-period reconciliation reads OrderPayment
   *    live, so it auto-corrects.
   *  - Account ledger: each existing payment is reversed against its
   *    linked account (ADJUSTMENT row), then the new method's account
   *    is credited (SALE row). Balances net to zero on the old account
   *    and gain the full amount on the new one.
   *  - Mushak-6.3 snapshot: paymentSummary updated in-place (legal
   *    metadata only — totals/items remain frozen).
   *  - Order.paymentMethod display field flipped to the new method.
   *
   * Approver gate mirrors void/refund: OWNER or MANAGER, optionally PIN-
   * verified.
   */
  async correctOrderPayment(id: string, branchId: string, staffId: string, dto: CorrectPaymentDto) {
    this.license.assertMutation('order.correctPayment');

    const order = await this.prisma.order.findFirst({
      where: { id, branchId, deletedAt: null },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED' && order.status !== 'REFUNDED') {
      throw new BadRequestException('Only paid orders can have their payment method corrected');
    }

    // Approver check — OWNER or MANAGER, PIN optional.
    const approverId = dto.approverId ?? staffId;
    const approver = await this.prisma.staff.findFirst({
      where: { id: approverId, branchId, isActive: true, deletedAt: null },
    });
    if (!approver || (approver.role !== 'OWNER' && approver.role !== 'MANAGER')) {
      throw new BadRequestException('Payment correction requires OWNER or MANAGER approval');
    }
    if (dto.approverPin) {
      const ok = await bcrypt.compare(dto.approverPin, approver.passwordHash);
      if (!ok) throw new BadRequestException('Approver PIN is incorrect');
    }

    const total = order.totalAmount.toNumber();

    // Validate split sum matches total exactly (allowing 1 paisa drift).
    if (dto.method === 'SPLIT') {
      if (!dto.splits || dto.splits.length < 2) {
        throw new BadRequestException('Split payment requires at least 2 payment methods');
      }
      const splitTotal = dto.splits.reduce((s, sp) => s + sp.amount, 0);
      if (Math.abs(splitTotal - total) > 1) {
        throw new BadRequestException('Split amounts must equal order total');
      }
    }

    // Snapshot existing payments before we wipe them — needed for the
    // ledger reversal step that runs after the transaction commits.
    const oldPayments = order.payments.map((p) => ({ method: p.method, amount: p.amount.toNumber() }));

    const referenceNote = dto.reason ? `Correction: ${dto.reason}` : 'Payment method corrected';

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderPayment.deleteMany({ where: { orderId: id } });

      if (dto.method === 'SPLIT' && dto.splits) {
        await tx.orderPayment.createMany({
          data: dto.splits.map((sp) => ({
            orderId: id,
            method: sp.method,
            amount: sp.amount,
            reference: sp.reference ?? referenceNote,
          })),
        });
      } else {
        await tx.orderPayment.create({
          data: {
            orderId: id,
            method: dto.method as never,
            amount: total,
            reference: referenceNote,
          },
        });
      }

      const o = await tx.order.update({
        where: { id },
        data: { paymentMethod: dto.method },
        include: { items: true, payments: true },
      });

      // Mushak-6.3 paymentSummary is a display-only field; legal totals
      // and item lines remain frozen. Refreshing it here keeps reprints
      // consistent with the corrected ledger.
      const invoice = await tx.mushakInvoice.findUnique({ where: { orderId: id } });
      if (invoice) {
        const snap = (invoice.snapshot ?? {}) as Record<string, unknown>;
        snap.paymentSummary = (o.payments ?? []).map((p) => ({
          method: p.method,
          amount: p.amount.toNumber(),
        }));
        await tx.mushakInvoice.update({
          where: { id: invoice.id },
          data: { snapshot: snap as Prisma.InputJsonValue },
        });
      }

      return o;
    });

    // Reverse old payments against their original accounts, then credit
    // the new accounts. Best-effort — same fire-and-forget pattern as
    // processPayment so a transient account update never rolls back the
    // payment correction itself.
    for (const op of oldPayments) {
      void this.accountService.reverseSalePosting(
        branchId,
        op.method,
        op.amount,
        `Payment correction — reverse ${op.method} for order #${order.orderNumber}`,
      );
    }
    if (dto.method === 'SPLIT' && dto.splits) {
      for (const sp of dto.splits) {
        void this.accountService.updateAccountForPayment(
          branchId,
          sp.method,
          sp.amount,
          'SALE',
          `Payment correction — Order #${order.orderNumber}`,
        );
      }
    } else {
      void this.accountService.updateAccountForPayment(
        branchId,
        dto.method,
        total,
        'SALE',
        `Payment correction — Order #${order.orderNumber}`,
      );
    }

    this.ws.emitToBranch(branchId, 'order:updated', updated);

    return updated;
  }
}

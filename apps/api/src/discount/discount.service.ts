import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialService } from '../social/social.service';

@Injectable()
export class DiscountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
  ) {}

  // ─── Discounts (cashier-applied) ───────────────────────────────────────────

  findAllDiscounts(branchId: string) {
    return this.prisma.discount.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' } });
  }

  createDiscount(branchId: string, dto: { name: string; type: string; value: number; scope?: string; targetItems?: string[] }) {
    return this.prisma.discount.create({
      data: {
        branchId,
        name: dto.name,
        type: dto.type as any,
        value: dto.value,
        scope: (dto.scope as any) ?? 'ALL_ITEMS',
        targetItems: dto.targetItems ? JSON.stringify(dto.targetItems) : null,
      },
    });
  }

  async updateDiscount(id: string, branchId: string, dto: { name?: string; type?: string; value?: number; scope?: string; targetItems?: string[]; isActive?: boolean }) {
    const d = await this.prisma.discount.findFirst({ where: { id, branchId } });
    if (!d) throw new NotFoundException();
    return this.prisma.discount.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type as any } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope as any } : {}),
        ...(dto.targetItems !== undefined ? { targetItems: JSON.stringify(dto.targetItems) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteDiscount(id: string, branchId: string) {
    const d = await this.prisma.discount.findFirst({ where: { id, branchId } });
    if (!d) throw new NotFoundException();
    return this.prisma.discount.delete({ where: { id } });
  }

  // Calculate discount amount for given items
  calculateDiscount(discount: { type: string; value: number; scope: string; targetItems: string | null }, items: { menuItemId: string; totalPrice: number }[]) {
    const targets: string[] = discount.targetItems ? JSON.parse(discount.targetItems) : [];
    let applicableTotal = 0;

    for (const item of items) {
      if (discount.scope === 'ALL_ITEMS') {
        applicableTotal += item.totalPrice;
      } else if (discount.scope === 'SPECIFIC_ITEMS' && targets.includes(item.menuItemId)) {
        applicableTotal += item.totalPrice;
      } else if (discount.scope === 'ALL_EXCEPT' && !targets.includes(item.menuItemId)) {
        applicableTotal += item.totalPrice;
      }
    }

    if (discount.type === 'FLAT') {
      return Math.min(Number(discount.value), applicableTotal);
    }
    return Math.round(applicableTotal * (Number(discount.value) / 100));
  }

  // ─── Coupons (QR user applied) ─────────────────────────────────────────────

  findAllCoupons(branchId: string) {
    return this.prisma.coupon.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' } });
  }

  createCoupon(branchId: string, dto: { code: string; name: string; type: string; value: number; scope?: string; targetItems?: string[]; maxUses?: number; expiresAt?: string }) {
    return this.prisma.coupon.create({
      data: {
        branchId,
        code: dto.code.toUpperCase(),
        name: dto.name,
        type: dto.type as any,
        value: dto.value,
        scope: (dto.scope as any) ?? 'ALL_ITEMS',
        targetItems: dto.targetItems ? JSON.stringify(dto.targetItems) : null,
        maxUses: dto.maxUses ?? 0,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async updateCoupon(id: string, branchId: string, dto: { code?: string; name?: string; type?: string; value?: number; scope?: string; targetItems?: string[]; maxUses?: number; expiresAt?: string | null; isActive?: boolean }) {
    const c = await this.prisma.coupon.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException();
    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code.toUpperCase() } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type as any } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope as any } : {}),
        ...(dto.targetItems !== undefined ? { targetItems: JSON.stringify(dto.targetItems) } : {}),
        ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteCoupon(id: string, branchId: string) {
    const c = await this.prisma.coupon.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException();
    return this.prisma.coupon.delete({ where: { id } });
  }

  async validateAndApplyCoupon(branchId: string, code: string, items: { menuItemId: string; totalPrice: number }[]) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { branchId, code: code.toUpperCase(), isActive: true },
    });
    if (!coupon) throw new BadRequestException('Invalid coupon code');
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new BadRequestException('Coupon has expired');
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) throw new BadRequestException('Coupon usage limit reached');

    const discountAmount = this.calculateDiscount(
      { type: coupon.type, value: coupon.value.toNumber(), scope: coupon.scope, targetItems: coupon.targetItems },
      items,
    );

    return { coupon, discountAmount };
  }

  async incrementCouponUsage(couponId: string) {
    await this.prisma.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
  }

  // ─── Menu Item Discounts (auto-applied) ────────────────────────────────────

  findMenuItemDiscounts(branchId: string) {
    return this.prisma.menuItemDiscount.findMany({
      where: { menuItem: { branchId } },
      include: { menuItem: { select: { id: true, name: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMenuItemDiscountsByItem(menuItemId: string) {
    return this.prisma.menuItemDiscount.findMany({
      where: { menuItemId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMenuItemDiscount(dto: { menuItemId: string; type: string; value: number; startDate: string; endDate: string; applicableDays?: string[] }) {
    const created = await this.prisma.menuItemDiscount.create({
      data: {
        menuItemId: dto.menuItemId,
        type: dto.type as any,
        value: dto.value,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        applicableDays: dto.applicableDays ? JSON.stringify(dto.applicableDays) : null,
      },
      include: { menuItem: { select: { id: true, name: true, price: true } } },
    });
    // Best-effort schedule a Facebook auto-post for this discount.
    // No-op when the branch hasn't connected a page; never throws.
    void this.social.scheduleForDiscount(created.id);
    return created;
  }

  async updateMenuItemDiscount(id: string, dto: { type?: string; value?: number; startDate?: string; endDate?: string; applicableDays?: string[] | null; isActive?: boolean }) {
    const d = await this.prisma.menuItemDiscount.findFirst({ where: { id } });
    if (!d) throw new NotFoundException();
    const updated = await this.prisma.menuItemDiscount.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type as any } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: new Date(dto.endDate) } : {}),
        ...(dto.applicableDays !== undefined ? { applicableDays: dto.applicableDays ? JSON.stringify(dto.applicableDays) : null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { menuItem: { select: { id: true, name: true, price: true } } },
    });
    // Re-render + reschedule the FB post to keep the queue in sync
    // with the latest discount terms. scheduleForDiscount overwrites
    // an existing PENDING row in place; non-PENDING rows are left
    // alone (admin already saw the outcome).
    void this.social.scheduleForDiscount(updated.id);
    return updated;
  }

  async deleteMenuItemDiscount(id: string) {
    const d = await this.prisma.menuItemDiscount.findFirst({ where: { id } });
    if (!d) throw new NotFoundException();
    return this.prisma.menuItemDiscount.delete({ where: { id } });
  }

  // Get active discount for a menu item right now
  getActiveMenuItemDiscount(menuItemId: string, discounts: { id: string; menuItemId: string; type: string; value: number; startDate: Date; endDate: Date; applicableDays: string | null; isActive: boolean }[]) {
    const now = new Date();
    const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];

    for (const d of discounts) {
      if (!d.isActive) continue;
      if (d.menuItemId !== menuItemId) continue;
      if (now < d.startDate || now > d.endDate) continue;
      if (d.applicableDays) {
        const days: string[] = JSON.parse(d.applicableDays);
        if (!days.includes(dayName)) continue;
      }
      return d;
    }
    return null;
  }
}

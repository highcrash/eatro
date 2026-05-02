import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { DiscountService } from './discount.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

// ─── Admin endpoints (authenticated) ─────────────────────────────────────────

@Controller('discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class DiscountController {
  constructor(
    private readonly svc: DiscountService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Discounts ──────────────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAllDiscounts(user.branchId);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: { name: string; type: string; value: number; scope?: string; targetItems?: string[] }) {
    const created = await this.svc.createDiscount(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'CREATE',
      entityType: 'discount', entityId: (created as any).id, entityName: dto.name,
      after: created as any,
      summary: `Created ${dto.type} discount "${dto.name}" (${dto.value})`,
    });
    return created;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    const updated = await this.svc.updateDiscount(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'UPDATE',
      entityType: 'discount', entityId: id, entityName: (updated as any)?.name ?? id,
      after: updated as any,
      summary: `Updated discount "${(updated as any)?.name ?? id}"`,
    });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.svc.deleteDiscount(id, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'DELETE',
      entityType: 'discount', entityId: id, entityName: (result as any)?.name ?? `discount ${id}`,
      summary: `Deleted discount`,
    });
    return result;
  }

  // ── Coupons ────────────────────────────────────────────────────────────────

  @Get('coupons')
  findAllCoupons(@CurrentUser() user: JwtPayload) {
    return this.svc.findAllCoupons(user.branchId);
  }

  @Post('coupons')
  async createCoupon(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    const created = await this.svc.createCoupon(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'CREATE',
      entityType: 'coupon', entityId: (created as any).id, entityName: (created as any).code ?? 'coupon',
      after: created as any,
      summary: `Created coupon "${(created as any).code}"`,
    });
    return created;
  }

  @Patch('coupons/:id')
  async updateCoupon(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    const updated = await this.svc.updateCoupon(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'UPDATE',
      entityType: 'coupon', entityId: id, entityName: (updated as any)?.code ?? id,
      after: updated as any,
      summary: `Updated coupon "${(updated as any)?.code ?? id}"`,
    });
    return updated;
  }

  @Delete('coupons/:id')
  async removeCoupon(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.svc.deleteCoupon(id, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'DELETE',
      entityType: 'coupon', entityId: id, entityName: (result as any)?.code ?? `coupon ${id}`,
      summary: `Deleted coupon`,
    });
    return result;
  }

  // ── Menu Item Discounts ────────────────────────────────────────────────────

  @Get('menu-discounts')
  findMenuDiscounts(@CurrentUser() user: JwtPayload) {
    return this.svc.findMenuItemDiscounts(user.branchId);
  }

  @Post('menu-discounts')
  async createMenuDiscount(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    const created = await this.svc.createMenuItemDiscount(dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'CREATE',
      entityType: 'menuItemDiscount', entityId: (created as any).id,
      entityName: `Menu discount ${dto.menuItemId}`,
      after: created as any,
      summary: `Created menu-item discount`,
    });
    return created;
  }

  @Patch('menu-discounts/:id')
  async updateMenuDiscount(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    const updated = await this.svc.updateMenuItemDiscount(id, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'UPDATE',
      entityType: 'menuItemDiscount', entityId: id,
      entityName: `Menu discount ${id}`,
      after: updated as any,
      summary: `Updated menu-item discount`,
    });
    return updated;
  }

  @Delete('menu-discounts/:id')
  async removeMenuDiscount(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.svc.deleteMenuItemDiscount(id);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'DISCOUNT', action: 'DELETE',
      entityType: 'menuItemDiscount', entityId: id,
      entityName: `Menu discount ${id}`,
      summary: `Deleted menu-item discount`,
    });
    return result;
  }
}

// ─── POS endpoints (cashier can list & get active discounts) ─────────────────

@Controller('discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
export class DiscountPosController {
  constructor(private readonly svc: DiscountService) {}

  @Get('active')
  getActiveDiscounts(@CurrentUser() user: JwtPayload) {
    return this.svc.findAllDiscounts(user.branchId).then((d) => d.filter((x) => x.isActive));
  }
}

// ─── Public endpoints (QR coupon validation) ─────────────────────────────────

@Controller('discounts')
export class DiscountPublicController {
  constructor(private readonly svc: DiscountService) {}

  @Post('coupons/validate')
  async validateCoupon(
    @Headers('x-branch-id') branchId: string,
    @Body() dto: { code: string; items: { menuItemId: string; totalPrice: number }[] },
  ) {
    if (!branchId) throw new BadRequestException('Branch ID required');
    const result = await this.svc.validateAndApplyCoupon(branchId, dto.code, dto.items);
    return {
      couponId: result.coupon.id,
      code: result.coupon.code,
      name: result.coupon.name,
      type: result.coupon.type,
      value: Number(result.coupon.value),
      discountAmount: result.discountAmount,
    };
  }
}

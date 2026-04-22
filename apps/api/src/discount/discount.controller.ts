import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { DiscountService } from './discount.service';

// ─── Admin endpoints (authenticated) ─────────────────────────────────────────

@Controller('discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class DiscountController {
  constructor(private readonly svc: DiscountService) {}

  // ── Discounts ──────────────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAllDiscounts(user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: { name: string; type: string; value: number; scope?: string; targetItems?: string[] }) {
    return this.svc.createDiscount(user.branchId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.svc.updateDiscount(id, user.branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.deleteDiscount(id, user.branchId);
  }

  // ── Coupons ────────────────────────────────────────────────────────────────

  @Get('coupons')
  findAllCoupons(@CurrentUser() user: JwtPayload) {
    return this.svc.findAllCoupons(user.branchId);
  }

  @Post('coupons')
  createCoupon(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.svc.createCoupon(user.branchId, dto);
  }

  @Patch('coupons/:id')
  updateCoupon(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.svc.updateCoupon(id, user.branchId, dto);
  }

  @Delete('coupons/:id')
  removeCoupon(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.deleteCoupon(id, user.branchId);
  }

  // ── Menu Item Discounts ────────────────────────────────────────────────────

  @Get('menu-discounts')
  findMenuDiscounts(@CurrentUser() user: JwtPayload) {
    return this.svc.findMenuItemDiscounts(user.branchId);
  }

  @Post('menu-discounts')
  createMenuDiscount(@Body() dto: any) {
    return this.svc.createMenuItemDiscount(dto);
  }

  @Patch('menu-discounts/:id')
  updateMenuDiscount(@Param('id') id: string, @Body() dto: any) {
    return this.svc.updateMenuItemDiscount(id, dto);
  }

  @Delete('menu-discounts/:id')
  removeMenuDiscount(@Param('id') id: string) {
    return this.svc.deleteMenuItemDiscount(id);
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

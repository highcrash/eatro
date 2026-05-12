import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class LoyaltyController {
  constructor(private readonly service: LoyaltyService) {}

  @Get('customers')
  customers(
    @CurrentUser() user: JwtPayload,
    @Query('minBalance') minBalance?: string,
    @Query('expiringBefore') expiringBefore?: string,
  ) {
    return this.service.listCustomers(user.branchId, {
      minBalance: minBalance ? Number(minBalance) : undefined,
      expiringBefore,
    });
  }

  @Get('transactions/:customerId')
  transactions(@Param('customerId') customerId: string, @CurrentUser() user: JwtPayload) {
    return this.service.listTransactions(user.branchId, customerId);
  }

  @Post('adjust')
  adjust(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { customerId: string; points: number; reason: string },
  ) {
    return this.service.adjust(user.branchId, user, dto);
  }

  /**
   * Manual trigger for the daily expiry sweep — useful for testing
   * and for "we just changed validityDays, run it now" admin moments.
   */
  @Post('expire-now')
  expireNow() {
    return this.service.runExpirySweep();
  }

  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.service.getSettings(user.branchId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      loyaltyEnabled?: boolean;
      loyaltyTakaPerPoint?: number;
      loyaltyTakaPerPointRedeem?: number;
      loyaltyValidityDays?: number;
      firstVisitCouponEnabled?: boolean;
      firstVisitCouponType?: 'PERCENTAGE' | 'FLAT';
      firstVisitCouponValue?: number;
      firstVisitCouponValidityDays?: number;
    },
  ) {
    return this.service.updateSettings(user.branchId, dto);
  }
}

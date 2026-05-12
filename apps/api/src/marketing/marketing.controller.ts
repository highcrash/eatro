import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import type { DiscountType } from '@prisma/client';
import { MarketingService } from './marketing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class MarketingController {
  constructor(private readonly service: MarketingService) {}

  @Get('customers/segment')
  segment(
    @CurrentUser() user: JwtPayload,
    @Query('minSpent') minSpent?: string,
    @Query('minVisits') minVisits?: string,
    @Query('maxLastVisitDays') maxLastVisitDays?: string,
    @Query('minLoyaltyPoints') minLoyaltyPoints?: string,
  ) {
    return this.service.segmentCustomers(user.branchId, {
      minSpent: minSpent ? Number(minSpent) : undefined,
      minVisits: minVisits ? Number(minVisits) : undefined,
      maxLastVisitDays: maxLastVisitDays ? Number(maxLastVisitDays) : undefined,
      minLoyaltyPoints: minLoyaltyPoints ? Number(minLoyaltyPoints) : undefined,
    });
  }

  @Get('campaigns')
  listCampaigns(@CurrentUser() user: JwtPayload) {
    return this.service.listCampaigns(user.branchId);
  }

  @Get('campaigns/:id')
  getCampaign(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getCampaign(user.branchId, id);
  }

  @Post('campaigns')
  createCampaign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      name: string;
      couponType: DiscountType;
      couponValue: number;
      validityDays: number;
      smsTemplate: string;
      minSpent?: number;
      minVisits?: number;
      maxLastVisitDays?: number;
      minLoyaltyPoints?: number;
    },
  ) {
    return this.service.createCampaign(user.branchId, user, dto);
  }

  @Post('campaigns/:id/send')
  sendCampaign(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.sendCampaign(user.branchId, user, id);
  }

  @Delete('campaigns/:id')
  removeCampaign(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.removeCampaign(user.branchId, user, id);
  }

  @Post('loyalty-blast')
  loyaltyBlast(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      smsTemplate: string;
      minSpent?: number;
      minVisits?: number;
      maxLastVisitDays?: number;
      minLoyaltyPoints?: number;
    },
  ) {
    return this.service.loyaltyBlast(user.branchId, user, dto);
  }
}

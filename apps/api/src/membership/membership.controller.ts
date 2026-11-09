import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { JwtPayload, MembershipPlanRuleInput } from '@restora/types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MembershipService } from './membership.service';

@Controller('membership')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class MembershipController {
  constructor(private readonly svc: MembershipService) {}

  @Get('plans')
  listPlans(@CurrentUser() user: JwtPayload) {
    return this.svc.listPlans(user.branchId);
  }

  @Post('plans')
  createPlan(@CurrentUser() user: JwtPayload, @Body() dto: { name: string; discountPercent: number; validityMonths?: number }) {
    return this.svc.createPlan(user.branchId, dto);
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; discountPercent?: number; validityMonths?: number; isActive?: boolean },
  ) {
    return this.svc.updatePlan(id, user.branchId, dto);
  }

  @Put('plans/:id/rules')
  setRules(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { rules: MembershipPlanRuleInput[] }) {
    return this.svc.setRules(id, user.branchId, dto.rules ?? []);
  }

  @Get('cards')
  listCards(@CurrentUser() user: JwtPayload) {
    return this.svc.listCards(user.branchId);
  }

  @Post('cards/generate')
  generate(@CurrentUser() user: JwtPayload, @Body() dto: { planId: string; quantity: number; batchLabel?: string }) {
    return this.svc.generateCards(user.branchId, dto, user);
  }

  // Cashiers hand cards over at the till.
  @Post('cards/activate')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  activate(@CurrentUser() user: JwtPayload, @Body() dto: { number: string; phone: string; name?: string }) {
    return this.svc.activate(user.branchId, dto, user);
  }

  @Post('cards/:id/block')
  block(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { reason?: string }) {
    return this.svc.block(id, user.branchId, dto.reason, user);
  }

  @Post('cards/:id/unblock')
  unblock(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.unblock(id, user.branchId, user);
  }

  @Post('cards/:id/renew')
  renew(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.renew(id, user.branchId, user);
  }

  @Post('cards/:id/replace')
  replace(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { number: string }) {
    return this.svc.replace(id, user.branchId, dto.number, user);
  }
}

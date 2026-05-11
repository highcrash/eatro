import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import type { LeaveType } from '@prisma/client';
import { LeaveBalanceService } from './leave-balance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('leave-balances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class LeaveBalanceController {
  constructor(private readonly service: LeaveBalanceService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('staffId') staffId?: string) {
    return this.service.listForBranch(user.branchId, staffId);
  }

  @Post('adjust')
  adjust(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { staffId: string; leaveType: LeaveType; delta: number; reason: string },
  ) {
    return this.service.adjust(user.branchId, user, dto);
  }

  /**
   * Manual trigger — runs both monthly + annual accrual now. Useful
   * for "freshly hired staff just assigned a rule, need their first
   * balance immediately" + for testing. Idempotent.
   */
  @Post('accrue')
  accrue() {
    return this.service.accrueAll();
  }
}

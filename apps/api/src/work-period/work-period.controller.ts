import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { WorkPeriodService } from './work-period.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('work-periods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkPeriodController {
  constructor(private readonly service: WorkPeriodService) {}

  @Get('current')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  getCurrent(@CurrentUser() user: JwtPayload) {
    return this.service.getCurrent(user.branchId);
  }

  @Get('last-closing')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  getLastClosing(@CurrentUser() user: JwtPayload) {
    return this.service.getLastClosing(user.branchId);
  }

  @Post('start')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  start(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      notes?: string;
      openingBalances?: Record<string, number>;
      openingCash?: number;
      openingMFS?: number;
      openingCard?: number;
    },
  ) {
    return this.service.start(user.branchId, user.sub, body);
  }

  @Post('end')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  end(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      closingBalances?: Record<string, number>;
      closingCash?: number;
      closingMFS?: number;
      closingCard?: number;
    },
  ) {
    return this.service.end(user.branchId, user.sub, body);
  }

  @Get(':id/summary')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR')
  getSummary(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getSummary(user.branchId, id);
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(user.branchId, from, to);
  }
}

import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, ReconciliationSubmitDto } from '@restora/types';

@Controller('reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('sheet')
  sheet(
    @CurrentUser() user: JwtPayload,
    @Query('windowDays') windowDays?: string,
  ) {
    const days = windowDays ? Math.max(1, Math.min(365, Number(windowDays) || 7)) : 7;
    return this.service.buildSheet(user.branchId, days);
  }

  @Post('submit')
  submit(@CurrentUser() user: JwtPayload, @Body() dto: ReconciliationSubmitDto) {
    return this.service.submit(user, dto);
  }
}

import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateLeaveDto } from '@restora/types';

@Controller('leave')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  findAll(@CurrentUser() user: JwtPayload, @Query('staffId') staffId?: string) {
    return this.leaveService.findAll(user.branchId, staffId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLeaveDto) {
    return this.leaveService.create(user.branchId, dto);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'MANAGER')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.leaveService.approve(id, user.branchId, user.sub);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'MANAGER')
  reject(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.leaveService.reject(id, user.branchId, user.sub);
  }
}

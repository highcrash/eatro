import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import type { LeaveType } from '@prisma/client';
import { LeaveRuleService } from './leave-rule.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

interface UpsertBody {
  name: string;
  notes?: string;
  entries: Array<{
    leaveType: LeaveType;
    accrualPerMonth?: number;
    annualGrant?: number;
    balanceCap?: number | null;
  }>;
}

@Controller('leave-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class LeaveRuleController {
  constructor(private readonly service: LeaveRuleService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(user.branchId, id);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: UpsertBody) {
    return this.service.create(user.branchId, user, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertBody) {
    return this.service.update(user.branchId, id, user, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user.branchId, id, user);
  }

  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { staffIds: string[] },
  ) {
    return this.service.assign(user.branchId, id, user, dto);
  }
}

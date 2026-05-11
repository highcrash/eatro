import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SalaryStructureService } from './salary-structure.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('salary-structures')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class SalaryStructureController {
  constructor(private readonly service: SalaryStructureService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(user.branchId, id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name: string; notes?: string; latesPerAbsent?: number; halfDaysPerAbsent?: number; components: Array<{ name: string; type: 'EARNING' | 'DEDUCTION'; amount: number; sortOrder?: number }> },
  ) {
    return this.service.create(user.branchId, user, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name: string; notes?: string; latesPerAbsent?: number; halfDaysPerAbsent?: number; components: Array<{ name: string; type: 'EARNING' | 'DEDUCTION'; amount: number; sortOrder?: number }> },
  ) {
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

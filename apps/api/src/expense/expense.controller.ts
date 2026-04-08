import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateExpenseDto, UpdateExpenseDto } from '@restora/types';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    return this.expenseService.findAll(user.branchId, { from, to, category });
  }

  @Get('summary')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultTo = now.toISOString().split('T')[0];
    return this.expenseService.getSummary(user.branchId, from ?? defaultFrom, to ?? defaultTo);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateExpenseDto) {
    return this.expenseService.create(user.branchId, user.sub, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateExpenseDto) {
    return this.expenseService.update(id, user.branchId, dto);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'MANAGER')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expenseService.approve(id, user.branchId, user.sub);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expenseService.remove(id, user.branchId);
  }
}

import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateAccountDto, AdjustBalanceDto } from '@restora/types';

@Controller('accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  // POS Start-Day dialog fetches /accounts to show the opening-cash
  // picker — advisors + waiters running the register need this read
  // too (same cashier-tier POS access). Write endpoints below stay
  // OWNER/MANAGER.
  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.accountService.findAll(user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto) {
    return this.accountService.create(user.branchId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: Partial<CreateAccountDto>) {
    return this.accountService.update(id, user.branchId, dto);
  }

  @Post(':id/adjust')
  adjustBalance(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AdjustBalanceDto) {
    return this.accountService.adjustBalance(id, user.branchId, dto);
  }

  @Post('transfer')
  transfer(@CurrentUser() user: JwtPayload, @Body() dto: { fromAccountId: string; toAccountId: string; amount: number; description?: string }) {
    return this.accountService.transfer(user.branchId, { ...dto, amount: Math.round(dto.amount) });
  }

  @Get(':id/statement')
  getStatement(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    return this.accountService.getStatement(user.branchId, id, from ?? defaultFrom, to ?? now.toISOString().split('T')[0]);
  }

  @Get('transactions')
  getTransactions(@CurrentUser() user: JwtPayload, @Query('accountId') accountId?: string) {
    return this.accountService.getTransactions(user.branchId, accountId);
  }

  @Get('pnl')
  getPnl(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultTo = now.toISOString().split('T')[0];
    return this.accountService.getPnl(user.branchId, from ?? defaultFrom, to ?? defaultTo);
  }
}

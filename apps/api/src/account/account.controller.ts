import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateAccountDto, AdjustBalanceDto } from '@restora/types';

@Controller('accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly activityLog: ActivityLogService,
  ) {}

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
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto) {
    const created = await this.accountService.create(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'ACCOUNT', action: 'CREATE',
      entityType: 'account', entityId: created.id, entityName: created.name,
      after: created as any,
      summary: `Created ${created.type} account "${created.name}"`,
    });
    return created;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: Partial<CreateAccountDto>) {
    const before = await this.accountService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.accountService.update(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'ACCOUNT', action: 'UPDATE',
      entityType: 'account', entityId: updated.id, entityName: updated.name,
      before: before as any, after: updated as any,
      summary: `Updated account "${updated.name}"`,
    });
    return updated;
  }

  @Post(':id/adjust')
  async adjustBalance(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AdjustBalanceDto) {
    const acct = await this.accountService.findOne(id, user.branchId).catch(() => null);
    const result = await this.accountService.adjustBalance(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'ACCOUNT', action: 'UPDATE',
      entityType: 'account', entityId: id, entityName: acct?.name ?? id,
      after: { adjustment: dto } as any,
      summary: `Manual balance adjustment ${(Number(dto.amount) / 100).toFixed(2)}: ${dto.description}`,
    });
    return result;
  }

  @Post('transfer')
  async transfer(@CurrentUser() user: JwtPayload, @Body() dto: { fromAccountId: string; toAccountId: string; amount: number; description?: string }) {
    const result = await this.accountService.transfer(user.branchId, { ...dto, amount: Math.round(dto.amount) });
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'ACCOUNT', action: 'UPDATE',
      entityType: 'accountTransfer', entityId: `${dto.fromAccountId}->${dto.toAccountId}`,
      entityName: 'Account transfer',
      after: dto as any,
      summary: `Transfer ${(Number(dto.amount) / 100).toFixed(2)} (${dto.description ?? ''})`,
    });
    return result;
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

  /**
   * One-shot retroactive sweep that posts an AccountTransaction for any
   * SupplierPayment that resolves to an Account but never had a ledger
   * entry written. Use after the bKash/MFS dropdown fix to fix up
   * historical balances. Idempotent — re-running is a no-op.
   * Pass `?dryRun=1` to preview without writing.
   */
  @Post('backfill-supplier-payments')
  @Roles('OWNER')
  async backfillSupplierPayments(
    @CurrentUser() user: JwtPayload,
    @Query('dryRun') dryRun?: string,
  ) {
    const result = await this.accountService.backfillSupplierPaymentPostings(user.branchId, {
      dryRun: dryRun === '1' || dryRun === 'true',
    });
    if (!result.dryRun && result.posted > 0) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'ACCOUNT', action: 'UPDATE',
        entityType: 'account', entityId: 'bulk-backfill', entityName: 'Supplier-payment backfill',
        after: { posted: result.posted, byAccount: result.byAccount } as any,
        summary: `Backfilled ${result.posted} supplier-payment postings (skipped ${result.skippedAlreadyPosted} existing, ${result.skippedNoAccount} unlinked)`,
      });
    }
    return result;
  }
}

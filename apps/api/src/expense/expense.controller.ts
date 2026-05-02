import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateExpenseDto, UpdateExpenseDto } from '@restora/types';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseController {
  constructor(
    private readonly expenseService: ExpenseService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    return this.expenseService.findAll(user.branchId, { from, to, category });
  }

  @Get('summary')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
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
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateExpenseDto) {
    const created = await this.expenseService.create(user.branchId, user.sub, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'EXPENSE', action: 'CREATE',
      entityType: 'expense', entityId: created.id,
      entityName: dto.description ?? dto.category ?? 'expense',
      after: created as any,
      summary: `${dto.category} ${(Number(dto.amount) / 100).toFixed(2)} via ${dto.paymentMethod ?? 'CASH'}`,
    });
    return created;
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateExpenseDto) {
    const before = await this.expenseService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.expenseService.update(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'EXPENSE', action: 'UPDATE',
      entityType: 'expense', entityId: updated.id,
      entityName: (updated as any).description ?? (updated as any).category ?? 'expense',
      before: before as any, after: updated as any,
      summary: `Updated expense`,
    });
    return updated;
  }

  // Approve = authorise payment. Keep to OWNER/MANAGER so advisors
  // can log + edit expense entries but can't sign off on money.
  @Post(':id/approve')
  @Roles('OWNER', 'MANAGER')
  async approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.expenseService.approve(id, user.branchId, user.sub);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'EXPENSE', action: 'UPDATE',
      entityType: 'expense', entityId: id,
      entityName: (result as any).description ?? (result as any).category ?? 'expense',
      after: { approved: true, approvedAt: (result as any).approvedAt } as any,
      summary: `Approved expense`,
    });
    return result;
  }

  // Delete wipes the audit trail. OWNER/MANAGER only to match the
  // restriction on approve; advisors can edit rows they entered.
  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.expenseService.findOne(id, user.branchId).catch(() => null);
    const result = await this.expenseService.remove(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'EXPENSE', action: 'DELETE',
        entityType: 'expense', entityId: before.id,
        entityName: (before as any).description ?? (before as any).category ?? 'expense',
        before: before as any,
        summary: `Deleted expense`,
      });
    }
    return result;
  }
}

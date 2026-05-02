import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateSupplierDto, UpdateSupplierDto, RecordSupplierAdjustmentDto } from '@restora/types';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class SupplierController {
  constructor(
    private readonly supplierService: SupplierService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR')
  findAll(@CurrentUser() user: JwtPayload) {
    // Cashiers only see suppliers explicitly enabled for POS purchasing.
    const cashierVisibleOnly = user.role === 'CASHIER';
    return this.supplierService.findAll(user.branchId, { cashierVisibleOnly });
  }

  // Payment routes BEFORE :id routes to avoid conflicts
  @Get('payments/all')
  getPayments(@CurrentUser() user: JwtPayload, @Query('supplierId') supplierId?: string) {
    return this.supplierService.getPayments(user.branchId, supplierId);
  }

  @Post('payments')
  async makePayment(@CurrentUser() user: JwtPayload, @Body() dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    const result = await this.supplierService.makePayment(user.branchId, user.sub, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'SUPPLIER', action: 'UPDATE',
      entityType: 'supplier', entityId: dto.supplierId,
      entityName: (result as any)?.supplier?.name ?? `supplier ${dto.supplierId}`,
      after: { payment: dto } as any,
      summary: `Supplier payment ${(Number(dto.amount) / 100).toFixed(2)} via ${dto.paymentMethod ?? 'CASH'}`,
    });
    return result;
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierService.findOne(id, user.branchId);
  }

  @Get(':id/ledger')
  getLedger(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierService.getSupplierLedger(id, user.branchId);
  }

  // Manual ledger correction. Owner/Manager only — Advisor/Cashier
  // are blocked even though they have read access. Pure ledger-only;
  // no cash account is touched (see SupplierService.recordAdjustment).
  @Post(':id/adjust')
  @Roles('OWNER', 'MANAGER')
  async recordAdjustment(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordSupplierAdjustmentDto,
  ) {
    const result = await this.supplierService.recordAdjustment(user.branchId, id, user.sub, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'SUPPLIER', action: 'UPDATE',
      entityType: 'supplier', entityId: id,
      entityName: (result as any)?.supplier?.name ?? `supplier ${id}`,
      after: dto as any,
      summary: `Supplier ledger adjustment`,
    });
    return result;
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSupplierDto) {
    const created = await this.supplierService.create(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'SUPPLIER', action: 'CREATE',
      entityType: 'supplier', entityId: created.id, entityName: created.name,
      after: created as any,
      summary: `Created supplier "${created.name}"`,
    });
    return created;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateSupplierDto) {
    const before = await this.supplierService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.supplierService.update(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'SUPPLIER', action: 'UPDATE',
      entityType: 'supplier', entityId: updated.id, entityName: updated.name,
      before: before as any, after: updated as any,
      summary: `Updated supplier "${updated.name}"`,
    });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.supplierService.findOne(id, user.branchId).catch(() => null);
    const result = await this.supplierService.remove(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'SUPPLIER', action: 'DELETE',
        entityType: 'supplier', entityId: before.id, entityName: before.name,
        before: before as any,
        summary: `Deleted supplier "${before.name}"`,
      });
    }
    return result;
  }
}

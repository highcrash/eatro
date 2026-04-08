import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateSupplierDto, UpdateSupplierDto } from '@restora/types';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
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
  makePayment(@CurrentUser() user: JwtPayload, @Body() dto: { supplierId: string; purchaseOrderId?: string; amount: number; paymentMethod?: string; reference?: string; notes?: string }) {
    return this.supplierService.makePayment(user.branchId, user.sub, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierService.findOne(id, user.branchId);
  }

  @Get(':id/ledger')
  getLedger(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierService.getSupplierLedger(id, user.branchId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSupplierDto) {
    return this.supplierService.create(user.branchId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateSupplierDto) {
    return this.supplierService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.supplierService.remove(id, user.branchId);
  }
}

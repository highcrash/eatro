import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentMethodController {
  constructor(private readonly service: PaymentMethodService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: { code: string; name: string; sortOrder?: number }) {
    return this.service.create(user.branchId, dto);
  }

  // ── Payment Options (must be before :id) ──────────────────────────────

  @Get('options')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findAllOptions(@CurrentUser() user: JwtPayload) {
    return this.service.findAllOptions(user.branchId);
  }

  @Post('options')
  @Roles('OWNER', 'MANAGER')
  createOption(@CurrentUser() user: JwtPayload, @Body() dto: { categoryId: string; code: string; name: string; accountId?: string; isDefault?: boolean }) {
    return this.service.createOption(user.branchId, dto);
  }

  @Patch('options/:id')
  @Roles('OWNER', 'MANAGER')
  updateOption(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { name?: string; accountId?: string | null; isActive?: boolean; isDefault?: boolean }) {
    return this.service.updateOption(id, user.branchId, dto);
  }

  @Delete('options/:id')
  @Roles('OWNER', 'MANAGER')
  removeOption(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.removeOption(id, user.branchId);
  }

  // ── Category CRUD ─────────────────────────────────────────────────────

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { name?: string; isActive?: boolean; sortOrder?: number }) {
    return this.service.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.branchId);
  }
}

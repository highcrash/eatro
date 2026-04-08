import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { IngredientService } from './ingredient.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateIngredientDto, UpdateIngredientDto, AdjustStockDto } from '@restora/types';

@Controller('ingredients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ingredientService.findAll(user.branchId);
  }

  @Get('movements')
  @Roles('OWNER', 'MANAGER')
  getMovements(@CurrentUser() user: JwtPayload, @Query('ingredientId') ingredientId?: string) {
    return this.ingredientService.getMovements(user.branchId, ingredientId);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ingredientService.findOne(id, user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateIngredientDto) {
    return this.ingredientService.create(user.branchId, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateIngredientDto) {
    return this.ingredientService.update(id, user.branchId, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ingredientService.remove(id, user.branchId);
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER')
  bulkCreate(@CurrentUser() user: JwtPayload, @Body() dto: { items: { name: string; unit?: string; category?: string; itemCode?: string; minimumStock?: number; costPerUnit?: number; purchaseUnit?: string; purchaseUnitQty?: number; costPerPurchaseUnit?: number }[] }) {
    return this.ingredientService.bulkCreate(user.branchId, dto.items);
  }

  @Put(':id/suppliers')
  @Roles('OWNER', 'MANAGER')
  setSuppliers(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { supplierIds: string[] }) {
    return this.ingredientService.setSuppliers(id, user.branchId, dto.supplierIds);
  }

  @Post(':id/adjust')
  @Roles('OWNER', 'MANAGER')
  adjustStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AdjustStockDto) {
    return this.ingredientService.adjustStock(id, user.branchId, user.sub, dto);
  }
}

import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PreReadyService } from './pre-ready.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreatePreReadyItemDto, UpsertPreReadyRecipeDto, CreateProductionOrderDto, CompleteProductionDto } from '@restora/types';

@Controller('pre-ready')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PreReadyController {
  constructor(private readonly preReadyService: PreReadyService) {}

  // Items
  @Get('items')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  findAllItems(@CurrentUser() user: JwtPayload) {
    return this.preReadyService.findAllItems(user.branchId);
  }

  @Get('items/:id')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  findOneItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.findOneItem(id, user.branchId);
  }

  @Post('items')
  @Roles('OWNER', 'MANAGER')
  createItem(@CurrentUser() user: JwtPayload, @Body() dto: CreatePreReadyItemDto) {
    return this.preReadyService.createItem(user.branchId, dto);
  }

  @Patch('items/:id')
  @Roles('OWNER', 'MANAGER')
  updateItem(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { name?: string; minimumStock?: number }) {
    return this.preReadyService.updateItem(id, user.branchId, dto);
  }

  @Delete('items/:id')
  @Roles('OWNER', 'MANAGER')
  removeItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.removeItem(id, user.branchId);
  }

  // Recipes
  @Put('items/:id/recipe')
  @Roles('OWNER', 'MANAGER')
  upsertRecipe(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertPreReadyRecipeDto) {
    return this.preReadyService.upsertRecipe(id, user.branchId, dto);
  }

  @Post('recipes/bulk')
  @Roles('OWNER', 'MANAGER')
  bulkUpsertRecipes(
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      rows: {
        preReadyItemName: string;
        yieldQuantity?: number;
        yieldUnit?: string;
        ingredientName: string;
        quantity: number;
        unit?: string;
      }[];
    },
  ) {
    return this.preReadyService.bulkUpsertRecipes(user.branchId, dto.rows);
  }

  // Production Orders
  @Get('productions')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  findAllProductions(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.preReadyService.findAllProductions(user.branchId, status);
  }

  @Post('productions')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  createProduction(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductionOrderDto) {
    return this.preReadyService.createProduction(user.branchId, user.sub, dto);
  }

  @Post('productions/:id/approve')
  @Roles('OWNER', 'MANAGER')
  approveProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.approveProduction(id, user.branchId, user.sub);
  }

  @Post('productions/:id/start')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  startProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.startProduction(id, user.branchId);
  }

  @Post('productions/:id/complete')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  completeProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CompleteProductionDto) {
    return this.preReadyService.completeProduction(id, user.branchId, dto);
  }

  @Post('productions/:id/cancel')
  @Roles('OWNER', 'MANAGER')
  cancelProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.cancelProduction(id, user.branchId);
  }

  @Post('productions/:id/waste')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER')
  wasteProduction(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { reason?: string },
  ) {
    return this.preReadyService.wasteProduction(id, user.branchId, { reason: dto?.reason, staffId: user.sub });
  }

  // Batches
  @Get('batches')
  @Roles('OWNER', 'MANAGER', 'KITCHEN')
  findBatches(@CurrentUser() user: JwtPayload) {
    return this.preReadyService.findBatches(user.branchId);
  }

  @Get('batches/expiring')
  @Roles('OWNER', 'MANAGER', 'KITCHEN')
  getExpiringBatches(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    return this.preReadyService.getExpiringBatches(user.branchId, parseInt(days ?? '3'));
  }
}

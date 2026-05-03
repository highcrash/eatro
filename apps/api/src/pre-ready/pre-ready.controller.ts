import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PreReadyService } from './pre-ready.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreatePreReadyItemDto, UpsertPreReadyRecipeDto, CreateProductionOrderDto, CompleteProductionDto } from '@restora/types';

@Controller('pre-ready')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PreReadyController {
  constructor(
    private readonly preReadyService: PreReadyService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // Items
  @Get('items')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  findAllItems(@CurrentUser() user: JwtPayload) {
    return this.preReadyService.findAllItems(user.branchId);
  }

  @Get('items/:id')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  findOneItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.findOneItem(id, user.branchId);
  }

  @Post('items')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async createItem(@CurrentUser() user: JwtPayload, @Body() dto: CreatePreReadyItemDto) {
    const created = await this.preReadyService.createItem(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'CREATE',
      entityType: 'preReadyItem', entityId: (created as any).id, entityName: (created as any).name,
      after: created as any,
      summary: `Created pre-ready "${(created as any).name}"`,
    });
    return created;
  }

  @Patch('items/:id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async updateItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; minimumStock?: number; unit?: string; autoDeductInputs?: boolean; producesIngredientId?: string | null },
  ) {
    const before = await this.preReadyService.findOneItem(id, user.branchId).catch(() => null);
    const updated = await this.preReadyService.updateItem(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'UPDATE',
      entityType: 'preReadyItem', entityId: (updated as any).id, entityName: (updated as any).name,
      before: before as any, after: updated as any,
      summary: `Updated pre-ready "${(updated as any).name}"`,
    });
    return updated;
  }

  // Surfaces the menu recipes that reference this pre-ready's `[PR]`
  // mirror ingredient. UI uses it on the edit dialog so admin can see
  // which recipes need their unit / quantity re-entered before
  // changing the pre-ready's unit.
  @Get('items/:id/menu-recipes')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  getMenuRecipesUsing(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.getMenuRecipesUsingPreReady(id, user.branchId);
  }

  @Delete('items/:id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async removeItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.preReadyService.findOneItem(id, user.branchId).catch(() => null);
    const result = await this.preReadyService.removeItem(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'DELETE',
        entityType: 'preReadyItem', entityId: (before as any).id, entityName: (before as any).name,
        before: before as any,
        summary: `Deleted pre-ready "${(before as any).name}"`,
      });
    }
    return result;
  }

  @Post('items/:id/recalc-cost')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  recalcCost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.recalcCost(id, user.branchId);
  }

  @Post('items/recalc-cost-all')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  recalcAllCosts(@CurrentUser() user: JwtPayload) {
    return this.preReadyService.recalcAllCosts(user.branchId);
  }

  /**
   * One-shot retro-link: walks every unlinked PreReadyItem and stamps
   * producesIngredientId when a matching "[PR] <name>" Ingredient
   * exists, isn't already claimed, and isn't a variant-parent. Returns
   * a report so admin sees what got linked + which items need manual
   * attention. Idempotent — re-running is safe.
   */
  @Post('items/backfill-links')
  @Roles('OWNER', 'MANAGER')
  async backfillLinks(@CurrentUser() user: JwtPayload) {
    const result = await this.preReadyService.backfillLinks(user.branchId);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'UPDATE',
      entityType: 'preReadyItem', entityId: 'backfill-links', entityName: 'Backfill PR ↔ Inventory links',
      after: result as any,
      summary: `Backfill linked ${result.linkedCount} of ${result.scanned} unlinked pre-ready items (${result.skippedCount} skipped)`,
    });
    return result;
  }

  // Recipes
  @Put('items/:id/recipe')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async upsertRecipe(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertPreReadyRecipeDto) {
    // Capture the prior recipe so the activity log carries a real
    // before/after diff (the headline use-case is "who added that
    // missing 200ml of garlic to the Curry Sauce recipe last night?").
    const beforeItem = await this.preReadyService.findOneItem(id, user.branchId).catch(() => null);
    const before = (beforeItem as any)?.recipe ?? null;
    const updated = await this.preReadyService.upsertRecipe(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'UPDATE',
      entityType: 'preReadyRecipe', entityId: id,
      entityName: (beforeItem as any)?.name ?? `pre-ready ${id}`,
      before: before as any, after: updated as any,
      summary: `Updated pre-ready recipe (${(dto as any)?.items?.length ?? 0} ingredient lines, yield ${(dto as any)?.yieldQuantity ?? '?'} ${(dto as any)?.yieldUnit ?? ''})`,
    });
    return updated;
  }

  @Post('recipes/bulk')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async bulkUpsertRecipes(
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
    const result = await this.preReadyService.bulkUpsertRecipes(user.branchId, dto.rows);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'UPDATE',
      entityType: 'preReadyRecipe', entityId: 'bulk',
      entityName: `Bulk recipe import (${dto.rows.length} rows)`,
      after: result as any,
      summary: `Bulk pre-ready recipe import: ${dto.rows.length} row(s)`,
    });
    return result;
  }

  // Production Orders
  @Get('productions')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  findAllProductions(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.preReadyService.findAllProductions(user.branchId, status);
  }

  @Post('productions')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  createProduction(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductionOrderDto) {
    return this.preReadyService.createProduction(user.branchId, user.sub, dto);
  }

  @Post('productions/:id/approve')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  approveProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.approveProduction(id, user.branchId, user.sub);
  }

  @Post('productions/:id/start')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  startProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.startProduction(id, user.branchId);
  }

  @Post('productions/:id/complete')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  async completeProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CompleteProductionDto) {
    const result = await this.preReadyService.completeProduction(id, user.branchId, dto);
    const itemName = (result as any)?.preReadyItem?.name ?? (result as any)?.preReadyItemId ?? id;
    const qty = (result as any)?.quantity ?? '?';
    const unit = (result as any)?.preReadyItem?.unit ?? '';
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'PRE_READY', action: 'UPDATE',
      entityType: 'productionOrder', entityId: id, entityName: `${itemName} batch`,
      after: result as any,
      summary: `Production completed: ${itemName} ×${qty}${unit ? ' ' + unit : ''}`,
    });
    return result;
  }

  @Post('productions/:id/cancel')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  cancelProduction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.preReadyService.cancelProduction(id, user.branchId);
  }

  @Post('productions/:id/waste')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'CASHIER', 'ADVISOR')
  wasteProduction(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { reason?: string },
  ) {
    return this.preReadyService.wasteProduction(id, user.branchId, { reason: dto?.reason, staffId: user.sub });
  }

  // Batches
  @Get('batches')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'ADVISOR')
  findBatches(@CurrentUser() user: JwtPayload) {
    return this.preReadyService.findBatches(user.branchId);
  }

  @Get('batches/expiring')
  @Roles('OWNER', 'MANAGER', 'KITCHEN', 'ADVISOR')
  getExpiringBatches(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    return this.preReadyService.getExpiringBatches(user.branchId, parseInt(days ?? '3'));
  }
}

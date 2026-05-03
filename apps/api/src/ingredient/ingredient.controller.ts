import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { IngredientService } from './ingredient.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, CreateIngredientDto, UpdateIngredientDto, AdjustStockDto, CreateVariantDto } from '@restora/types';

@Controller('ingredients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IngredientController {
  constructor(
    private readonly ingredientService: IngredientService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ingredientService.findAll(user.branchId);
  }

  @Get('movements')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  getMovements(
    @CurrentUser() user: JwtPayload,
    @Query('ingredientId') ingredientId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ingredientService.getMovements(user.branchId, {
      ingredientId,
      search,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Correct a stock-movement's recorded quantity post-hoc. Used when
   *  a recipe typo (e.g. "10 KG" instead of "10 G") deducted the wrong
   *  amount from stock — admin enters the correct quantity, the
   *  delta rebalances `Ingredient.currentStock`, and reports
   *  automatically pick up the new value. The original quantity is
   *  preserved on the row in `correctedFromQuantity` for audit. */
  @Post('movements/:id/correct')
  @Roles('OWNER', 'MANAGER')
  correctMovement(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { quantity: number; reason?: string },
  ) {
    return this.ingredientService.correctMovement(id, user.branchId, dto);
  }

  // Per-ingredient usage map across menu recipes + pre-ready recipes.
  // Used by InventoryPage's "Unused" filter pill so admin can see what
  // they're paying to stock but never selling. Pure read-only — no
  // schema, no migration, no side effects.
  @Get('usage')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  getUsage(@CurrentUser() user: JwtPayload) {
    return this.ingredientService.getIngredientUsage(user.branchId);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ingredientService.findOne(id, user.branchId);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateIngredientDto) {
    const created = await this.ingredientService.create(user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'INGREDIENT', action: 'CREATE',
      entityType: 'ingredient', entityId: created.id, entityName: created.name,
      after: created as any,
      summary: `Created ingredient "${created.name}"`,
    });
    return created;
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateIngredientDto & { autoMinStock?: boolean }) {
    const before = await this.ingredientService.findOne(id, user.branchId).catch(() => null);
    const updated = await this.ingredientService.update(id, user.branchId, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'INGREDIENT', action: 'UPDATE',
      entityType: 'ingredient', entityId: updated.id, entityName: updated.name,
      before: before as any, after: updated as any,
      summary: `Updated ingredient "${updated.name}"`,
    });
    return updated;
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const before = await this.ingredientService.findOne(id, user.branchId).catch(() => null);
    const result = await this.ingredientService.remove(id, user.branchId);
    if (before) {
      void this.activityLog.log({
        branchId: user.branchId, actor: user, category: 'INGREDIENT', action: 'DELETE',
        entityType: 'ingredient', entityId: before.id, entityName: before.name,
        before: before as any,
        summary: `Deleted ingredient "${before.name}"`,
      });
    }
    return result;
  }

  @Post('bulk')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  bulkCreate(@CurrentUser() user: JwtPayload, @Body() dto: { items: { name: string; unit?: string; category?: string; itemCode?: string; minimumStock?: number; costPerUnit?: number; purchaseUnit?: string; purchaseUnitQty?: number; costPerPurchaseUnit?: number }[] }) {
    return this.ingredientService.bulkCreate(user.branchId, dto.items);
  }

  @Post('bulk-stock-update')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  bulkStockUpdate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { items: Array<{ itemCode?: string; sku?: string; currentStock: number }> },
  ) {
    return this.ingredientService.bulkStockUpdate(user.branchId, user.sub, dto.items);
  }

  @Put(':id/suppliers')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  setSuppliers(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { supplierIds: string[] }) {
    return this.ingredientService.setSuppliers(id, user.branchId, dto.supplierIds);
  }

  @Post(':id/adjust')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async adjustStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: AdjustStockDto) {
    const before = await this.ingredientService.findOne(id, user.branchId).catch(() => null);
    const result = await this.ingredientService.adjustStock(id, user.branchId, user.sub, dto);
    void this.activityLog.log({
      branchId: user.branchId, actor: user, category: 'INGREDIENT', action: 'UPDATE',
      entityType: 'ingredient', entityId: id, entityName: before?.name ?? id,
      after: { adjustment: dto } as any,
      summary: `Stock adjusted: ${(dto as any).quantity ?? '?'} ${(dto as any).unit ?? ''} (${(dto as any).reason ?? 'no reason'})`,
    });
    return result;
  }

  // ─── Variants ─────────────────────────────────────────────────────────────

  @Get(':id/variants')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'ADVISOR', 'WAITER')
  getVariants(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ingredientService.getVariants(id, user.branchId);
  }

  @Post(':id/variants')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  createVariant(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateVariantDto) {
    return this.ingredientService.createVariant(id, user.branchId, dto);
  }

  @Patch(':id/convert-to-parent')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  convertToParent(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ingredientService.convertToParent(id, user.branchId);
  }

  // One-shot fix for installs seeded before variant cost-per-unit was
  // derived automatically. Rewrites every variant's costPerUnit from its
  // costPerPurchaseUnit / purchaseUnitQty and re-syncs parent aggregates.
  @Post('repair-variant-costs')
  @Roles('OWNER')
  repairVariantCosts(@CurrentUser() user: JwtPayload) {
    return this.ingredientService.repairVariantCosts(user.branchId);
  }

  // One-shot recompute of every variant-parent aggregate. Use after
  // a syncParentStock logic change to refresh stuck per-parent
  // costPerUnit / currentStock values without waiting for the next
  // stock movement.
  @Post('resync-variant-parents')
  @Roles('OWNER')
  resyncVariantParents(@CurrentUser() user: JwtPayload) {
    return this.ingredientService.resyncAllVariantParents(user.branchId);
  }

  /**
   * Recompute every eligible ingredient's minimumStock from its
   * recent SALE + OPERATIONAL_USE consumption. Drives the manual
   * "Recompute Min Stock" button on the Inventory page; mirrors the
   * nightly IngredientScheduler (same service method).
   *
   * Optional `days` body field overrides the saved
   * BranchSetting.autoMinStockDays for one-off "what would 60 days
   * look like?" experiments without changing the saved setting.
   * OWNER + MANAGER (it can rewrite hundreds of minimums in one
   * click — keep it gated tighter than read-only operations).
   */
  @Post('recompute-minimum-stock')
  @Roles('OWNER', 'MANAGER')
  recomputeMinimumStock(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { days?: number } = {},
  ) {
    return this.ingredientService.recomputeMinimumStock(
      user.branchId,
      dto?.days,
      { sub: user.sub, role: user.role },
    );
  }
}

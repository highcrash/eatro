import { Controller, Get, Put, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { RecipeService } from './recipe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload, UpsertRecipeDto } from '@restora/types';

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class RecipeController {
  constructor(
    private readonly recipeService: RecipeService,
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Denormalise a Recipe row into a small audit-friendly snapshot so
   *  the Activity Log feed reads naturally even after an ingredient
   *  rename or unit change downstream. */
  private snapshotRecipe(recipe: {
    notes?: string | null;
    items: Array<{ quantity: { toNumber(): number } | number; unit: string; ingredient: { id: string; name: string } }>;
  } | null): { notes: string | null; items: Array<{ ingredientId: string; ingredientName: string; quantity: number; unit: string }> } | null {
    if (!recipe) return null;
    return {
      notes: recipe.notes ?? null,
      items: recipe.items.map((it) => ({
        ingredientId: it.ingredient.id,
        ingredientName: it.ingredient.name,
        quantity: typeof it.quantity === 'number' ? it.quantity : it.quantity.toNumber(),
        unit: it.unit,
      })),
    };
  }

  @Get('costs')
  getAllCosts(@CurrentUser() user: JwtPayload) {
    return this.recipeService.getAllCosts(user.branchId);
  }

  @Get('ingredient-map')
  getIngredientMap(@CurrentUser() user: JwtPayload) {
    return this.recipeService.getIngredientMap(user.branchId);
  }

  @Get('menu-item/:menuItemId')
  findByMenuItem(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipeService.findByMenuItem(menuItemId, user.branchId);
  }

  @Get('menu-item/:menuItemId/cost')
  getCostPerServing(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    return this.recipeService.getCostPerServing(menuItemId, user.branchId);
  }

  @Put('menu-item/:menuItemId')
  async upsert(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertRecipeDto) {
    // Snapshot BEFORE so the activity log can show what changed
    // (added / removed / quantity-edited rows). The log writes
    // ingredient names alongside ids so the feed reads naturally
    // after a future rename.
    const before = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
    });
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId: user.branchId, deletedAt: null },
      select: { name: true },
    });
    const result = await this.recipeService.upsert(menuItemId, user.branchId, dto);
    const after = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
    });
    const beforeCount = before?.items.length ?? 0;
    const afterCount = after?.items.length ?? 0;
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'RECIPE',
      action: before ? 'UPDATE' : 'CREATE',
      entityType: 'recipe',
      entityId: menuItemId,
      entityName: `Recipe — ${menuItem?.name ?? 'Unknown'}`,
      before: this.snapshotRecipe(before) as any,
      after: this.snapshotRecipe(after) as any,
      summary: before
        ? `Updated recipe for "${menuItem?.name ?? 'Unknown'}" (${beforeCount} → ${afterCount} ingredient${afterCount === 1 ? '' : 's'})`
        : `Created recipe for "${menuItem?.name ?? 'Unknown'}" (${afterCount} ingredient${afterCount === 1 ? '' : 's'})`,
    });
    return result;
  }

  @Post('bulk')
  async bulkUpsert(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { rows: { menuItemName: string; ingredientName: string; quantity: number; unit?: string }[] },
  ) {
    const result = await this.recipeService.bulkUpsert(user.branchId, dto.rows);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'RECIPE',
      action: 'UPDATE',
      entityType: 'recipe',
      entityId: 'bulk',
      entityName: `Bulk recipe import (${dto.rows.length} rows)`,
      // No before/after diff for bulk — the audit feed only needs
      // the headline counts. Detail lives in the CSV the admin
      // uploaded plus the per-recipe activity entries the engine
      // would emit if we re-fired upsert per-row (we don't, for
      // performance — bulk uses recipe.upsert direct, no per-item
      // logging). Embed errors so admins can troubleshoot.
      after: { updated: result.updated, skipped: result.skipped, errors: result.errors } as any,
      summary: `Bulk imported recipes — ${result.updated} updated, ${result.skipped} skipped (of ${dto.rows.length} rows)`,
    });
    return result;
  }

  @Delete('menu-item/:menuItemId')
  async remove(@Param('menuItemId') menuItemId: string, @CurrentUser() user: JwtPayload) {
    const before = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
    });
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId: user.branchId, deletedAt: null },
      select: { name: true },
    });
    const result = await this.recipeService.remove(menuItemId, user.branchId);
    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'RECIPE',
      action: 'DELETE',
      entityType: 'recipe',
      entityId: menuItemId,
      entityName: `Recipe — ${menuItem?.name ?? 'Unknown'}`,
      before: this.snapshotRecipe(before) as any,
      summary: `Removed recipe from "${menuItem?.name ?? 'Unknown'}" (${before?.items.length ?? 0} ingredient${(before?.items.length ?? 0) === 1 ? '' : 's'} cleared)`,
    });
    return result;
  }
}

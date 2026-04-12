import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpsertRecipeDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { IngredientService } from '../ingredient/ingredient.service';

@Injectable()
export class RecipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversionService: UnitConversionService,
    private readonly ingredientService: IngredientService,
  ) {}

  async findByMenuItem(menuItemId: string, branchId: string) {
    // Verify menu item belongs to branch
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);

    return this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: true } } },
    });
  }

  async upsert(menuItemId: string, branchId: string, dto: UpsertRecipeDto) {
    // Verify menu item belongs to branch
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);

    return this.prisma.recipe.upsert({
      where: { menuItemId },
      create: {
        menuItemId,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            unit: (i.unit ?? 'G') as any,
          })),
        },
      },
      update: {
        notes: dto.notes ?? null,
        items: {
          deleteMany: {},
          create: dto.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            unit: (i.unit ?? 'G') as any,
          })),
        },
      },
      include: { items: { include: { ingredient: true } } },
    });
  }

  async remove(menuItemId: string, branchId: string) {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId, deletedAt: null },
    });
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);

    return this.prisma.recipe.delete({ where: { menuItemId } });
  }

  async getAllCosts(branchId: string) {
    const recipes = await this.prisma.recipe.findMany({
      where: { menuItem: { branchId, deletedAt: null } },
      include: { items: { include: { ingredient: { select: { costPerUnit: true } } } } },
    });

    const costs: Record<string, number> = {};
    for (const recipe of recipes) {
      let total = 0;
      for (const item of recipe.items) {
        total += item.ingredient.costPerUnit.toNumber() * item.quantity.toNumber();
      }
      costs[recipe.menuItemId] = total;
    }
    return costs;
  }

  async getIngredientMap(branchId: string): Promise<Record<string, string[]>> {
    const recipes = await this.prisma.recipe.findMany({
      where: { menuItem: { branchId, deletedAt: null } },
      include: { items: { select: { ingredientId: true } } },
    });

    // Map: ingredientId → [menuItemId, ...]
    const map: Record<string, string[]> = {};
    for (const recipe of recipes) {
      for (const item of recipe.items) {
        if (!map[item.ingredientId]) map[item.ingredientId] = [];
        map[item.ingredientId].push(recipe.menuItemId);
      }
    }
    return map;
  }

  async getCostPerServing(menuItemId: string, _branchId: string) {
    const recipe = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: true } } },
    });
    if (!recipe) return null;

    let totalCost = 0;
    const breakdown: { ingredient: string; quantity: number; unit: string; cost: number }[] = [];

    for (const item of recipe.items) {
      const costPerUnit = item.ingredient.costPerUnit.toNumber();
      const qty = item.quantity.toNumber();
      const cost = costPerUnit * qty;
      totalCost += cost;
      breakdown.push({
        ingredient: item.ingredient.name,
        quantity: qty,
        unit: item.ingredient.unit,
        cost,
      });
    }

    return { menuItemId, totalCost, breakdown };
  }

  // Used by OrderService to deduct stock on order creation
  async deductStockForOrder(branchId: string, orderId: string, items: { menuItemId: string; quantity: number }[]) {
    const menuItemIds = items.map((i) => i.menuItemId);
    const recipes = await this.prisma.recipe.findMany({
      where: { menuItemId: { in: menuItemIds } },
      include: { items: { include: { ingredient: true } } },
    });

    if (recipes.length === 0) return; // No recipes configured, skip

    const movements: {
      branchId: string;
      ingredientId: string;
      type: 'SALE';
      quantity: number;
      orderId: string;
      notes: string;
    }[] = [];

    const stockUpdates: { id: string; decrement: number }[] = [];
    const parentSyncIds = new Set<string>();

    for (const orderItem of items) {
      const recipe = recipes.find((r) => r.menuItemId === orderItem.menuItemId);
      if (!recipe) continue;

      for (const recipeItem of recipe.items) {
        let totalQty = recipeItem.quantity.toNumber() * orderItem.quantity;
        // Convert if recipe item unit differs from ingredient's native unit
        if (recipeItem.unit !== recipeItem.ingredient.unit) {
          totalQty = await this.unitConversionService.convert(branchId, totalQty, recipeItem.unit, recipeItem.ingredient.unit);
        }

        if (recipeItem.ingredient.hasVariants) {
          // Resolve to variants — deduct from those with stock (FIFO)
          const variants = await this.prisma.ingredient.findMany({
            where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null, currentStock: { gt: 0 } },
            orderBy: { createdAt: 'asc' },
          });

          let remaining = totalQty;
          for (const variant of variants) {
            if (remaining <= 0) break;
            const available = Number(variant.currentStock);
            const deduct = Math.min(remaining, available);
            movements.push({ branchId, ingredientId: variant.id, type: 'SALE', quantity: -deduct, orderId, notes: 'Auto-deducted for order' });
            stockUpdates.push({ id: variant.id, decrement: deduct });
            remaining -= deduct;
          }
          // If still remaining, allow negative on first variant (or any available)
          if (remaining > 0) {
            const fallback = variants[0] ?? await this.prisma.ingredient.findFirst({
              where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null },
              orderBy: { createdAt: 'asc' },
            });
            if (fallback) {
              movements.push({ branchId, ingredientId: fallback.id, type: 'SALE', quantity: -remaining, orderId, notes: 'Auto-deducted for order (insufficient stock)' });
              stockUpdates.push({ id: fallback.id, decrement: remaining });
            }
          }
          parentSyncIds.add(recipeItem.ingredientId);
        } else {
          // Standard ingredient (no variants) — existing logic
          movements.push({ branchId, ingredientId: recipeItem.ingredientId, type: 'SALE', quantity: -totalQty, orderId, notes: 'Auto-deducted for order' });
          stockUpdates.push({ id: recipeItem.ingredientId, decrement: totalQty });
        }
      }
    }

    if (movements.length === 0) return;

    await this.prisma.$transaction([
      ...stockUpdates.map((u) =>
        this.prisma.ingredient.update({
          where: { id: u.id },
          data: { currentStock: { decrement: u.decrement } },
        }),
      ),
      this.prisma.stockMovement.createMany({ data: movements }),
    ]);

    // Sync parent aggregates outside transaction
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }
  }

  // Used by OrderService to restore stock on item void / order void
  async restoreStockForItems(branchId: string, orderId: string, items: { menuItemId: string; quantity: number }[]) {
    const menuItemIds = items.map((i) => i.menuItemId);
    const recipes = await this.prisma.recipe.findMany({
      where: { menuItemId: { in: menuItemIds } },
      include: { items: { include: { ingredient: true } } },
    });

    if (recipes.length === 0) return;

    const stockUpdates: { id: string; increment: number }[] = [];
    const movements: {
      branchId: string;
      ingredientId: string;
      type: 'VOID_RETURN';
      quantity: number;
      orderId: string;
      notes: string;
    }[] = [];
    const parentSyncIds = new Set<string>();

    for (const orderItem of items) {
      const recipe = recipes.find((r) => r.menuItemId === orderItem.menuItemId);
      if (!recipe) continue;

      for (const recipeItem of recipe.items) {
        const totalQty = recipeItem.quantity.toNumber() * orderItem.quantity;

        if (recipeItem.ingredient.hasVariants) {
          // Look up the SALE movements for this order to find which variants were deducted
          const saleMovements = await this.prisma.stockMovement.findMany({
            where: {
              orderId,
              type: 'SALE',
              ingredient: { parentId: recipeItem.ingredientId },
            },
          });

          if (saleMovements.length > 0) {
            // Restore to the exact variants that were deducted
            for (const mv of saleMovements) {
              const restoreQty = Math.abs(Number(mv.quantity));
              stockUpdates.push({ id: mv.ingredientId, increment: restoreQty });
              movements.push({ branchId, ingredientId: mv.ingredientId, type: 'VOID_RETURN', quantity: restoreQty, orderId, notes: 'Stock returned on void' });
            }
          } else {
            // Fallback: restore to first variant
            const firstVariant = await this.prisma.ingredient.findFirst({
              where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null },
              orderBy: { createdAt: 'asc' },
            });
            if (firstVariant) {
              stockUpdates.push({ id: firstVariant.id, increment: totalQty });
              movements.push({ branchId, ingredientId: firstVariant.id, type: 'VOID_RETURN', quantity: totalQty, orderId, notes: 'Stock returned on void' });
            }
          }
          parentSyncIds.add(recipeItem.ingredientId);
        } else {
          stockUpdates.push({ id: recipeItem.ingredientId, increment: totalQty });
          movements.push({ branchId, ingredientId: recipeItem.ingredientId, type: 'VOID_RETURN', quantity: totalQty, orderId, notes: 'Stock returned on void' });
        }
      }
    }

    if (stockUpdates.length === 0) return;

    await this.prisma.$transaction([
      ...stockUpdates.map((u) =>
        this.prisma.ingredient.update({
          where: { id: u.id },
          data: { currentStock: { increment: u.increment } },
        }),
      ),
      this.prisma.stockMovement.createMany({ data: movements }),
    ]);

    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }
  }
}

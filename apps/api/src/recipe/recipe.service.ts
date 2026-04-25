import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

    // Block SUPPLY-category ingredients from recipe lines. Supplies
    // (parcel bags, cleaner, tissues) are tracked via the manual
    // "Record Usage" log on Inventory → Supplies, not via recipe
    // deduction — otherwise their consumption would double-count.
    if (dto.items.length > 0) {
      const ids = dto.items.map((i) => i.ingredientId);
      const supplies = await this.prisma.ingredient.findMany({
        where: { id: { in: ids }, branchId, category: 'SUPPLY' },
        select: { id: true, name: true },
      });
      if (supplies.length > 0) {
        const names = supplies.map((s) => s.name).join(', ');
        throw new BadRequestException(
          `Supplies cannot be added to recipes — record their usage from Inventory → Supplies (${names})`,
        );
      }
    }

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

  /**
   * Bulk upsert recipes from a flat CSV-style list. Groups rows by menu
   * item (matched by name case-insensitively), resolves ingredients by
   * name, and rewrites each menu item's recipe.
   *
   * Rows whose menu item isn't found, or whose ingredient isn't found,
   * are skipped with a reason recorded. Each menu item's recipe is
   * upserted in one go — so if the CSV supplies 3 rows for "Chicken
   * Curry", the final recipe has exactly those 3 items (not appended).
   *
   * Variant ingredients can be targeted by their full display name
   * ("Parent — Brand") or by just the parent's name (in which case the
   * recipe line uses the parent and stock deducts FIFO across variants
   * at order time).
   */
  async bulkUpsert(
    branchId: string,
    rows: {
      menuItemName: string;
      ingredientName: string;
      quantity: number;
      unit?: string;
    }[],
  ) {
    // Resolve menu items + ingredients once
    const menuItems = await this.prisma.menuItem.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true },
    });
    const menuItemByName = new Map(menuItems.map((m) => [m.name.toLowerCase(), m.id] as const));

    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true, unit: true, parentId: true, category: true },
    });
    const ingredientByName = new Map(ingredients.map((i) => [i.name.toLowerCase(), i] as const));

    // Group rows by menu item
    interface Grouped { menuItemId: string; items: { ingredientId: string; quantity: number; unit: string }[]; }
    const grouped = new Map<string, Grouped>();
    const errors: string[] = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const miName = row.menuItemName?.trim().toLowerCase();
      const ingName = row.ingredientName?.trim().toLowerCase();
      if (!miName || !ingName) {
        errors.push(`Row ${i + 1}: missing menu_item_name or ingredient_name`);
        skipped++;
        continue;
      }

      const menuItemId = menuItemByName.get(miName);
      if (!menuItemId) {
        errors.push(`Row ${i + 1}: menu item "${row.menuItemName}" not found`);
        skipped++;
        continue;
      }

      const ing = ingredientByName.get(ingName);
      if (!ing) {
        errors.push(`Row ${i + 1}: ingredient "${row.ingredientName}" not found`);
        skipped++;
        continue;
      }

      if (ing.category === 'SUPPLY') {
        errors.push(`Row ${i + 1}: "${row.ingredientName}" is a Supply — track via Inventory → Supplies, not recipes`);
        skipped++;
        continue;
      }

      const qty = Number(row.quantity);
      if (!qty || qty <= 0 || isNaN(qty)) {
        errors.push(`Row ${i + 1}: invalid quantity "${row.quantity}"`);
        skipped++;
        continue;
      }

      const existing = grouped.get(menuItemId) ?? { menuItemId, items: [] };
      existing.items.push({
        ingredientId: ing.id,
        quantity: qty,
        unit: (row.unit?.trim().toUpperCase() || ing.unit),
      });
      grouped.set(menuItemId, existing);
    }

    // Upsert each menu item's recipe in its own txn so one bad menu
    // item doesn't block the others.
    let updated = 0;
    for (const [menuItemId, group] of grouped) {
      try {
        await this.prisma.recipe.upsert({
          where: { menuItemId },
          create: {
            menuItemId,
            items: {
              create: group.items.map((i) => ({
                ingredientId: i.ingredientId,
                quantity: i.quantity,
                unit: i.unit as any,
              })),
            },
          },
          update: {
            items: {
              deleteMany: {},
              create: group.items.map((i) => ({
                ingredientId: i.ingredientId,
                quantity: i.quantity,
                unit: i.unit as any,
              })),
            },
          },
        });
        updated++;
      } catch (e: any) {
        const miName = menuItems.find((m) => m.id === menuItemId)?.name ?? menuItemId;
        errors.push(`Menu item "${miName}": ${e.message?.slice(0, 80)}`);
        skipped++;
      }
    }

    return { updated, skipped, errors, totalRows: rows.length };
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

  /**
   * Used by OrderService to deduct stock on order creation. Each
   * `items[]` entry may carry `removedIngredientIds` — recipe lines
   * referencing one of those IDs are skipped, so a "no garlic" mod
   * doesn't pull garlic stock for that line.
   */
  async deductStockForOrder(branchId: string, orderId: string, items: { menuItemId: string; quantity: number; removedIngredientIds?: string[] }[]) {
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

      const removed = new Set(orderItem.removedIngredientIds ?? []);

      for (const recipeItem of recipe.items) {
        // Honour per-line removals: skip any recipe line whose
        // ingredient (or its parent, when applicable) was removed.
        if (removed.has(recipeItem.ingredientId)) continue;
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

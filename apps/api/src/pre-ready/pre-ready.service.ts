import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreatePreReadyItemDto, UpsertPreReadyRecipeDto, CreateProductionOrderDto, CompleteProductionDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { IngredientService } from '../ingredient/ingredient.service';

@Injectable()
export class PreReadyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversionService: UnitConversionService,
    private readonly ingredientService: IngredientService,
  ) {}

  // ── Pre-Ready Items ───────────────────────────────────────────────────────

  findAllItems(branchId: string) {
    return this.prisma.preReadyItem.findMany({
      where: { branchId, deletedAt: null },
      include: { recipe: { include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOneItem(id: string, branchId: string) {
    const item = await this.prisma.preReadyItem.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        recipe: { include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } },
        batches: { where: { remainingQty: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
      },
    });
    if (!item) throw new NotFoundException(`Pre-ready item ${id} not found`);
    return item;
  }

  /**
   * Create a pre-ready item AND mirror it as an inventory ingredient with
   * a `[PR] ` prefix immediately — no need to wait for the first
   * production run. Cost defaults to 0 because the recipe doesn't exist
   * yet; admin clicks Recalculate Cost after wiring the recipe to fill
   * it in. The mirrored ingredient is what menu items reference when
   * a pre-ready food appears in a recipe.
   */
  async createItem(branchId: string, dto: CreatePreReadyItemDto) {
    const item = await this.prisma.preReadyItem.create({
      data: { branchId, name: dto.name, unit: dto.unit as any, minimumStock: dto.minimumStock ?? 0 },
    });

    const ingredientName = `[PR] ${item.name}`;
    const existing = await this.prisma.ingredient.findFirst({
      where: { branchId, name: ingredientName, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.ingredient.create({
        data: {
          branchId,
          name: ingredientName,
          unit: item.unit,
          category: 'OTHER',
          currentStock: 0,
          minimumStock: 0,
          costPerUnit: 0,
          itemCode: `PR-${item.id.slice(-6).toUpperCase()}`,
        },
      });
    }

    return item;
  }

  async updateItem(id: string, branchId: string, dto: { name?: string; minimumStock?: number }) {
    await this.findOneItem(id, branchId);
    return this.prisma.preReadyItem.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
      },
    });
  }

  async removeItem(id: string, branchId: string) {
    const item = await this.findOneItem(id, branchId);

    // Check stock
    if (item.currentStock.toNumber() > 0) {
      throw new BadRequestException(`Cannot delete: ${item.name} has ${item.currentStock.toNumber()} ${item.unit} in stock. Adjust stock to 0 first.`);
    }

    // Check if used in any production orders (non-completed/cancelled)
    const activeProductions = await this.prisma.productionOrder.count({
      where: { preReadyItemId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    });
    if (activeProductions > 0) {
      throw new BadRequestException(`Cannot delete: ${item.name} has ${activeProductions} active production order(s).`);
    }

    // Check if item has batches with remaining stock
    const activeBatches = await this.prisma.preReadyBatch.count({
      where: { preReadyItemId: id, remainingQty: { gt: 0 } },
    });
    if (activeBatches > 0) {
      throw new BadRequestException(`Cannot delete: ${item.name} has ${activeBatches} active batch(es) with remaining stock.`);
    }

    return this.prisma.preReadyItem.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  // ── Recipes ───────────────────────────────────────────────────────────────

  async upsertRecipe(preReadyItemId: string, branchId: string, dto: UpsertPreReadyRecipeDto) {
    await this.findOneItem(preReadyItemId, branchId);
    const recipe = await this.prisma.preReadyRecipe.upsert({
      where: { preReadyItemId },
      create: {
        preReadyItemId,
        yieldQuantity: dto.yieldQuantity,
        yieldUnit: dto.yieldUnit as any,
        notes: dto.notes ?? null,
        items: { create: dto.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity, unit: (i.unit ?? 'G') as any })) },
      },
      update: {
        yieldQuantity: dto.yieldQuantity,
        yieldUnit: dto.yieldUnit as any,
        notes: dto.notes ?? null,
        items: { deleteMany: {}, create: dto.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity, unit: (i.unit ?? 'G') as any })) },
      },
      include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
    });

    // Recipe just changed — refresh the cached cost-per-unit so the
    // pre-ready list and the mirrored inventory ingredient stay current
    // even if no production happens yet.
    await this.recalcCost(preReadyItemId, branchId).catch(() => {});

    return recipe;
  }

  /**
   * Bulk upsert pre-ready recipes from a flat CSV-style list. One row per
   * ingredient; grouped by pre_ready_item_name. Each group also carries
   * yield_quantity + yield_unit — we take those from the first row of
   * each group (Excel users repeat the same yield across all rows, but
   * mismatches silently favor the first).
   *
   * Existing recipes are overwritten (deleteMany+createMany), same as
   * the menu recipe bulk endpoint.
   */
  async bulkUpsertRecipes(
    branchId: string,
    rows: {
      preReadyItemName: string;
      yieldQuantity?: number;
      yieldUnit?: string;
      ingredientName: string;
      quantity: number;
      unit?: string;
    }[],
  ) {
    // Resolve pre-ready items + ingredients once
    const preReadyItems = await this.prisma.preReadyItem.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true, unit: true },
    });
    const itemByName = new Map(preReadyItems.map((m) => [m.name.toLowerCase(), m] as const));

    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true, unit: true },
    });
    const ingredientByName = new Map(ingredients.map((i) => [i.name.toLowerCase(), i] as const));

    interface Grouped {
      itemId: string;
      itemName: string;
      defaultUnit: string;
      yieldQuantity: number;
      yieldUnit: string;
      items: { ingredientId: string; quantity: number; unit: string }[];
    }
    const grouped = new Map<string, Grouped>();
    const errors: string[] = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const prName = row.preReadyItemName?.trim().toLowerCase();
      const ingName = row.ingredientName?.trim().toLowerCase();
      if (!prName || !ingName) {
        errors.push(`Row ${i + 1}: missing pre_ready_item_name or ingredient_name`);
        skipped++;
        continue;
      }

      const pri = itemByName.get(prName);
      if (!pri) {
        errors.push(`Row ${i + 1}: pre-ready item "${row.preReadyItemName}" not found`);
        skipped++;
        continue;
      }

      const ing = ingredientByName.get(ingName);
      if (!ing) {
        errors.push(`Row ${i + 1}: ingredient "${row.ingredientName}" not found`);
        skipped++;
        continue;
      }

      const qty = Number(row.quantity);
      if (!qty || qty <= 0 || isNaN(qty)) {
        errors.push(`Row ${i + 1}: invalid quantity "${row.quantity}"`);
        skipped++;
        continue;
      }

      let group = grouped.get(pri.id);
      if (!group) {
        // First row of the group carries the yield fields. Missing yield
        // → default to 1 unit in the pre-ready item's own unit.
        const yq = Number(row.yieldQuantity);
        group = {
          itemId: pri.id,
          itemName: pri.name,
          defaultUnit: pri.unit,
          yieldQuantity: !isNaN(yq) && yq > 0 ? yq : 1,
          yieldUnit: (row.yieldUnit?.trim().toUpperCase() || pri.unit),
          items: [],
        };
        grouped.set(pri.id, group);
      }

      group.items.push({
        ingredientId: ing.id,
        quantity: qty,
        unit: (row.unit?.trim().toUpperCase() || ing.unit),
      });
    }

    let updated = 0;
    for (const [itemId, group] of grouped) {
      try {
        await this.prisma.preReadyRecipe.upsert({
          where: { preReadyItemId: itemId },
          create: {
            preReadyItemId: itemId,
            yieldQuantity: group.yieldQuantity,
            yieldUnit: group.yieldUnit as any,
            items: {
              create: group.items.map((i) => ({
                ingredientId: i.ingredientId,
                quantity: i.quantity,
                unit: i.unit as any,
              })),
            },
          },
          update: {
            yieldQuantity: group.yieldQuantity,
            yieldUnit: group.yieldUnit as any,
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
        errors.push(`Pre-ready "${group.itemName}": ${e.message?.slice(0, 80)}`);
        skipped++;
      }
    }

    return { updated, skipped, errors, totalRows: rows.length };
  }

  // ── Production Orders ─────────────────────────────────────────────────────

  findAllProductions(branchId: string, status?: string) {
    return this.prisma.productionOrder.findMany({
      where: { branchId, ...(status ? { status: status as any } : {}) },
      include: {
        preReadyItem: { select: { id: true, name: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  createProduction(branchId: string, staffId: string, dto: CreateProductionOrderDto) {
    return this.prisma.productionOrder.create({
      data: {
        branchId,
        preReadyItemId: dto.preReadyItemId,
        quantity: dto.quantity,
        notes: dto.notes ?? null,
        requestedById: staffId,
      },
      include: {
        preReadyItem: { select: { id: true, name: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async approveProduction(id: string, branchId: string, approverId: string) {
    const po = await this.prisma.productionOrder.findFirst({ where: { id, branchId } });
    if (!po) throw new NotFoundException(`Production order ${id} not found`);
    if (po.status !== 'PENDING') throw new BadRequestException('Only PENDING orders can be approved');
    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
      include: {
        preReadyItem: { select: { id: true, name: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async startProduction(id: string, branchId: string) {
    const po = await this.prisma.productionOrder.findFirst({ where: { id, branchId } });
    if (!po) throw new NotFoundException(`Production order ${id} not found`);
    if (po.status !== 'APPROVED') throw new BadRequestException('Only APPROVED orders can be started');
    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
      include: {
        preReadyItem: { select: { id: true, name: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async completeProduction(id: string, branchId: string, dto: CompleteProductionDto) {
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, branchId },
      include: { preReadyItem: { include: { recipe: { include: { items: true } } } } },
    });
    if (!po) throw new NotFoundException(`Production order ${id} not found`);
    if (po.status !== 'IN_PROGRESS' && po.status !== 'APPROVED') {
      throw new BadRequestException('Only IN_PROGRESS or APPROVED orders can be completed');
    }

    const recipe = po.preReadyItem.recipe;
    const producedQty = po.quantity.toNumber();

    // Pre-compute unit conversions outside the transaction
    const conversions: number[] = [];
    if (recipe && recipe.items.length > 0) {
      const yieldQty = recipe.yieldQuantity.toNumber();
      const ratio = producedQty / yieldQty;

      for (const recipeItem of recipe.items) {
        let deductQty = recipeItem.quantity.toNumber() * ratio;
        // Fetch ingredient to get native unit
        const ingredient = await this.prisma.ingredient.findUnique({ where: { id: recipeItem.ingredientId }, select: { unit: true } });
        if (ingredient && recipeItem.unit !== ingredient.unit) {
          deductQty = await this.unitConversionService.convert(branchId, deductQty, recipeItem.unit, ingredient.unit);
        }
        conversions.push(deductQty);
      }
    }

    // Pre-fetch ingredient costs for total production cost calculation
    const ingredientCosts: { deductQty: number; costPerUnit: number }[] = [];
    if (recipe && recipe.items.length > 0) {
      for (let idx = 0; idx < recipe.items.length; idx++) {
        const recipeItem = recipe.items[idx];
        const ing = await this.prisma.ingredient.findUnique({
          where: { id: recipeItem.ingredientId },
          select: { costPerUnit: true, unit: true },
        });
        // deductQty is already in the ingredient's native unit (converted above)
        const deductQty = conversions[idx];
        // costPerUnit is stored in paisa per native unit
        ingredientCosts.push({ deductQty, costPerUnit: ing?.costPerUnit.toNumber() ?? 0 });
      }
    }

    // Total raw material cost for this production run
    const totalProductionCost = ingredientCosts.reduce((sum, ic) => sum + ic.deductQty * ic.costPerUnit, 0);
    // Cost per unit of produced pre-ready item (in paisa)
    const costPerProducedUnit = producedQty > 0 ? Math.round(totalProductionCost / producedQty) : 0;

    const parentSyncIds = new Set<string>();

    const txResult = await this.prisma.$transaction(async (tx) => {
      // 1. Deduct raw ingredients based on recipe (proportional to production qty)
      if (recipe && recipe.items.length > 0) {
        for (let idx = 0; idx < recipe.items.length; idx++) {
          const recipeItem = recipe.items[idx];
          const deductQty = conversions[idx];

          // Check if ingredient has variants
          const ingredient = await tx.ingredient.findUnique({ where: { id: recipeItem.ingredientId }, select: { hasVariants: true } });
          if (ingredient?.hasVariants) {
            // Resolve to variants (FIFO)
            const variants = await tx.ingredient.findMany({
              where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null, currentStock: { gt: 0 } },
              orderBy: { createdAt: 'asc' },
            });
            let remaining = deductQty;
            for (const variant of variants) {
              if (remaining <= 0) break;
              const available = Number(variant.currentStock);
              const deduct = Math.min(remaining, available);
              await tx.ingredient.update({ where: { id: variant.id }, data: { currentStock: { decrement: deduct } } });
              await tx.stockMovement.create({ data: { branchId, ingredientId: variant.id, type: 'SALE', quantity: -deduct, notes: `Pre-ready production: ${po.preReadyItem.name} x${producedQty}` } });
              remaining -= deduct;
            }
            if (remaining > 0) {
              const fallback = variants[0] ?? await tx.ingredient.findFirst({ where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
              if (fallback) {
                await tx.ingredient.update({ where: { id: fallback.id }, data: { currentStock: { decrement: remaining } } });
                await tx.stockMovement.create({ data: { branchId, ingredientId: fallback.id, type: 'SALE', quantity: -remaining, notes: `Pre-ready production: ${po.preReadyItem.name} x${producedQty} (insufficient)` } });
              }
            }
            parentSyncIds.add(recipeItem.ingredientId);
          } else {
            await tx.ingredient.update({
              where: { id: recipeItem.ingredientId },
              data: { currentStock: { decrement: deductQty } },
            });
            await tx.stockMovement.create({
              data: {
                branchId,
                ingredientId: recipeItem.ingredientId,
                type: 'SALE',
                quantity: -deductQty,
                notes: `Pre-ready production: ${po.preReadyItem.name} x${producedQty}`,
              },
            });
          }
        }
      }

      // 2. Add to pre-ready item stock
      await tx.preReadyItem.update({
        where: { id: po.preReadyItemId },
        data: { currentStock: { increment: producedQty } },
      });

      // 3. Create batch record with dates
      await tx.preReadyBatch.create({
        data: {
          branchId,
          preReadyItemId: po.preReadyItemId,
          quantity: producedQty,
          remainingQty: producedQty,
          makingDate: new Date(dto.makingDate),
          expiryDate: new Date(dto.expiryDate),
        },
      });

      // 4. Auto-add to Inventory with calculated cost per unit
      //    Cost = sum(each ingredient's deductQty × costPerUnit) / producedQty
      const ingredientName = `[PR] ${po.preReadyItem.name}`;
      let ingredient = await tx.ingredient.findFirst({
        where: { branchId, name: ingredientName, deletedAt: null },
      });
      if (!ingredient) {
        ingredient = await tx.ingredient.create({
          data: {
            branchId,
            name: ingredientName,
            unit: po.preReadyItem.unit,
            category: 'OTHER',
            currentStock: producedQty,
            minimumStock: 0,
            costPerUnit: costPerProducedUnit,
            itemCode: `PR-${po.preReadyItemId.slice(-6).toUpperCase()}`,
          },
        });
      } else {
        // Recalculate weighted average cost:
        // (existing stock × existing cost + new qty × new cost) / total stock
        const existingStock = ingredient.currentStock.toNumber();
        const existingCost = ingredient.costPerUnit.toNumber();
        const totalStock = existingStock + producedQty;
        const weightedAvgCost = totalStock > 0
          ? Math.round((existingStock * existingCost + producedQty * costPerProducedUnit) / totalStock)
          : costPerProducedUnit;

        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: {
            currentStock: { increment: producedQty },
            costPerUnit: weightedAvgCost,
          },
        });
      }

      // Create stock movement for the inventory ingredient
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: ingredient.id,
          type: 'PURCHASE',
          quantity: producedQty,
          notes: `Pre-ready production completed: ${po.preReadyItem.name} x${producedQty}`,
        },
      });

      // 5. Mark production complete
      return tx.productionOrder.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        include: {
          preReadyItem: { select: { id: true, name: true, unit: true } },
          requestedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      });
    });

    // Sync parent aggregates for variant deductions
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }

    return txResult;
  }

  /**
   * Mark a production as WASTED — kitchen used the ingredients but the result was bad,
   * so we still deduct stock + create WasteLog entries (so admin sees the loss in
   * end-of-day reports), but no PreReadyBatch is created.
   */
  async wasteProduction(id: string, branchId: string, dto: { reason?: string; staffId: string }) {
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, branchId },
      include: { preReadyItem: { include: { recipe: { include: { items: true } } } } },
    });
    if (!po) throw new NotFoundException(`Production order ${id} not found`);
    // Cast through string so the WASTED check works before prisma generate runs.
    const currentStatus = po.status as string;
    if (currentStatus === 'COMPLETED' || currentStatus === 'WASTED' || currentStatus === 'CANCELLED') {
      throw new BadRequestException('Production cannot be wasted from current status');
    }

    const recipe = po.preReadyItem.recipe;
    const producedQty = po.quantity.toNumber();

    // Pre-compute ingredient deductions in native units (same as complete)
    const conversions: { ingredientId: string; deductQty: number }[] = [];
    if (recipe && recipe.items.length > 0) {
      const yieldQty = recipe.yieldQuantity.toNumber();
      const ratio = producedQty / yieldQty;
      for (const recipeItem of recipe.items) {
        let deductQty = recipeItem.quantity.toNumber() * ratio;
        const ingredient = await this.prisma.ingredient.findUnique({
          where: { id: recipeItem.ingredientId },
          select: { unit: true },
        });
        if (ingredient && recipeItem.unit !== ingredient.unit) {
          deductQty = await this.unitConversionService.convert(branchId, deductQty, recipeItem.unit, ingredient.unit);
        }
        conversions.push({ ingredientId: recipeItem.ingredientId, deductQty });
      }
    }

    const wasteSyncIds = new Set<string>();

    const wasteResult = await this.prisma.$transaction(async (tx) => {
      for (const c of conversions) {
        const ing = await tx.ingredient.findUnique({ where: { id: c.ingredientId }, select: { hasVariants: true } });
        const wasteNotes = `Pre-ready production wasted: ${po.preReadyItem.name} x${producedQty}${dto.reason ? ` — ${dto.reason}` : ''}`;

        if (ing?.hasVariants) {
          // Resolve to variants
          const variants = await tx.ingredient.findMany({
            where: { parentId: c.ingredientId, isActive: true, deletedAt: null, currentStock: { gt: 0 } },
            orderBy: { createdAt: 'asc' },
          });
          let remaining = c.deductQty;
          for (const v of variants) {
            if (remaining <= 0) break;
            const deduct = Math.min(remaining, Number(v.currentStock));
            await tx.ingredient.update({ where: { id: v.id }, data: { currentStock: { decrement: deduct } } });
            await tx.stockMovement.create({ data: { branchId, ingredientId: v.id, type: 'WASTE', quantity: -deduct, notes: wasteNotes } });
            await tx.wasteLog.create({ data: { branchId, ingredientId: v.id, quantity: deduct, reason: 'PREPARATION_ERROR', notes: wasteNotes, recordedById: dto.staffId } });
            remaining -= deduct;
          }
          if (remaining > 0) {
            const fallback = variants[0] ?? await tx.ingredient.findFirst({ where: { parentId: c.ingredientId, isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
            if (fallback) {
              await tx.ingredient.update({ where: { id: fallback.id }, data: { currentStock: { decrement: remaining } } });
              await tx.stockMovement.create({ data: { branchId, ingredientId: fallback.id, type: 'WASTE', quantity: -remaining, notes: wasteNotes } });
              await tx.wasteLog.create({ data: { branchId, ingredientId: fallback.id, quantity: remaining, reason: 'PREPARATION_ERROR', notes: wasteNotes, recordedById: dto.staffId } });
            }
          }
          wasteSyncIds.add(c.ingredientId);
        } else {
          await tx.ingredient.update({
            where: { id: c.ingredientId },
            data: { currentStock: { decrement: c.deductQty } },
          });
          await tx.stockMovement.create({ data: { branchId, ingredientId: c.ingredientId, type: 'WASTE', quantity: -c.deductQty, notes: wasteNotes } });
          await tx.wasteLog.create({ data: { branchId, ingredientId: c.ingredientId, quantity: c.deductQty, reason: 'PREPARATION_ERROR', notes: wasteNotes, recordedById: dto.staffId } });
        }
      }

      return tx.productionOrder.update({
        where: { id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { status: 'WASTED' as any, completedAt: new Date(), notes: dto.reason ?? po.notes },
        include: {
          preReadyItem: { select: { id: true, name: true, unit: true } },
          requestedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      });
    });

    for (const parentId of wasteSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }

    return wasteResult;
  }

  async cancelProduction(id: string, branchId: string) {
    const po = await this.prisma.productionOrder.findFirst({ where: { id, branchId } });
    if (!po) throw new NotFoundException(`Production order ${id} not found`);
    if (po.status === 'COMPLETED') throw new BadRequestException('Cannot cancel completed order');
    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        preReadyItem: { select: { id: true, name: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ── Batches ───────────────────────────────────────────────────────────────

  findBatches(branchId: string) {
    return this.prisma.preReadyBatch.findMany({
      where: { branchId, remainingQty: { gt: 0 } },
      include: { preReadyItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: 'asc' },
    });
  }

  async getExpiringBatches(branchId: string, daysAhead = 3) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    return this.prisma.preReadyBatch.findMany({
      where: { branchId, remainingQty: { gt: 0 }, expiryDate: { lte: cutoff } },
      include: { preReadyItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: 'asc' },
    });
  }

  // ── Cost calculator ──────────────────────────────────────────────────────

  /**
   * Compute the cost-per-produced-unit for a pre-ready item from its
   * recipe. Walks each recipe ingredient, converts the recipe quantity
   * into the ingredient's native unit, multiplies by current
   * costPerUnit (paisa), and divides the sum by yield. For variant-
   * parents the cheapest active variant's cost is used (matches the
   * cost a fresh production would actually deduct against). Items with
   * no recipe or no yield return 0.
   */
  private async computeCostPerUnit(branchId: string, preReadyItemId: string): Promise<number> {
    const item = await this.prisma.preReadyItem.findFirst({
      where: { id: preReadyItemId, branchId },
      include: { recipe: { include: { items: true } } },
    });
    if (!item?.recipe || item.recipe.items.length === 0) return 0;

    const yieldQty = item.recipe.yieldQuantity.toNumber();
    if (yieldQty <= 0) return 0;

    let totalCost = 0;
    for (const ri of item.recipe.items) {
      const ing = await this.prisma.ingredient.findUnique({
        where: { id: ri.ingredientId },
        select: { id: true, unit: true, costPerUnit: true, hasVariants: true },
      });
      if (!ing) continue;

      let deductQty = ri.quantity.toNumber();
      if (ri.unit !== ing.unit) {
        try {
          deductQty = await this.unitConversionService.convert(branchId, deductQty, ri.unit, ing.unit);
        } catch {
          // Conversion missing — skip this line so the rest of the
          // recipe still contributes to the cost estimate.
          continue;
        }
      }

      let unitCost = ing.costPerUnit.toNumber();
      if (ing.hasVariants && unitCost === 0) {
        // Parent's costPerUnit is often 0 because real cost lives on
        // variants. Take the cheapest active variant's cost so the
        // estimate reflects what a production would actually consume.
        const variants = await this.prisma.ingredient.findMany({
          where: { parentId: ing.id, isActive: true, deletedAt: null },
          select: { costPerUnit: true },
        });
        const positive = variants.map((v) => v.costPerUnit.toNumber()).filter((c) => c > 0);
        if (positive.length > 0) unitCost = Math.min(...positive);
      }

      totalCost += deductQty * unitCost;
    }

    return Math.round(totalCost / yieldQty);
  }

  /**
   * Refresh the cached cost-per-unit on a pre-ready item AND on its
   * mirrored `[PR] <name>` inventory ingredient. Returns the updated
   * pre-ready item with its recipe so the UI can re-render in place.
   * Safe to call repeatedly — pure function of current ingredient
   * costs + recipe.
   */
  async recalcCost(preReadyItemId: string, branchId: string) {
    const item = await this.findOneItem(preReadyItemId, branchId);
    const cost = await this.computeCostPerUnit(branchId, preReadyItemId);

    await this.prisma.preReadyItem.update({
      where: { id: preReadyItemId },
      data: { costPerUnit: cost },
    });

    // Also refresh the mirrored ingredient so menu-recipe valuations
    // and reports pick up the new cost. We only update the cost field
    // — stock + everything else is owned by production runs.
    const ingredientName = `[PR] ${item.name}`;
    const mirror = await this.prisma.ingredient.findFirst({
      where: { branchId, name: ingredientName, deletedAt: null },
      select: { id: true },
    });
    if (mirror) {
      await this.prisma.ingredient.update({
        where: { id: mirror.id },
        data: { costPerUnit: cost },
      });
    }

    return this.findOneItem(preReadyItemId, branchId);
  }

  /**
   * Recalculate cost for every pre-ready item in the branch. Used by the
   * one-click "Recalculate All" button on the admin Pre-Ready page.
   */
  async recalcAllCosts(branchId: string) {
    const items = await this.prisma.preReadyItem.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true },
    });
    let updated = 0;
    for (const it of items) {
      try {
        await this.recalcCost(it.id, branchId);
        updated++;
      } catch {
        // Skip items whose recipe is broken; they stay at the previous
        // cost rather than blocking the bulk refresh.
      }
    }
    return { updated, total: items.length };
  }
}

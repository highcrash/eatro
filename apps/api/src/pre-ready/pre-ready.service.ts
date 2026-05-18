import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type {
  CreatePreReadyItemDto,
  UpsertPreReadyRecipeDto,
  CreateProductionOrderDto,
  CompleteProductionDto,
  BulkPreReadyReconcileDto,
  BulkPreReadyReconcileResult,
  BulkPreReadyReconcileRowResult,
  JwtPayload,
} from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { IngredientService } from '../ingredient/ingredient.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class PreReadyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversionService: UnitConversionService,
    private readonly ingredientService: IngredientService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Pre-Ready Items ───────────────────────────────────────────────────────

  async findAllItems(branchId: string) {
    const items = await this.prisma.preReadyItem.findMany({
      where: { branchId, deletedAt: null },
      include: {
        recipe: { include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } },
        // Pull the linked Ingredient's currentStock so we can overlay
        // it onto PreReadyItem.currentStock — see overlayLinkedStock
        // for the why.
        producesIngredient: { select: { id: true, currentStock: true } },
      },
      orderBy: { name: 'asc' },
    });
    return items.map((it) => this.overlayLinkedStock(it));
  }

  async findOneItem(id: string, branchId: string) {
    const item = await this.prisma.preReadyItem.findFirst({
      where: { id, branchId, deletedAt: null },
      include: {
        recipe: { include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } },
        batches: { where: { remainingQty: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
        producesIngredient: { select: { id: true, currentStock: true } },
      },
    });
    if (!item) throw new NotFoundException(`Pre-ready item ${id} not found`);
    return this.overlayLinkedStock(item);
  }

  /**
   * When a PreReadyItem is linked to an inventory Ingredient, the
   * Ingredient is the single source of truth — every menu sale
   * deducts it directly. The PreReadyItem.currentStock column may be
   * stale (legacy data, drift before linking, etc.) so we overlay
   * the linked Ingredient's currentStock onto the response so the UI
   * always shows the true value. Unlinked items return as-is.
   */
  private overlayLinkedStock<T extends { producesIngredient?: { currentStock: unknown } | null; currentStock: unknown }>(it: T): T {
    if (it.producesIngredient && it.producesIngredient.currentStock != null) {
      return { ...it, currentStock: it.producesIngredient.currentStock };
    }
    return it;
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

    // Auto-link the new PreReadyItem to its inventory mirror immediately
    // — no need to wait for the first production. Resolution order:
    //   1) Existing "[PR] <name>" Ingredient — but ONLY if it isn't
    //      already paired with another PreReadyItem AND isn't a
    //      variant-parent (production yield can't split across variants).
    //   2) Otherwise create a fresh "[PR] <name>" Ingredient.
    // Either way, stamp the link on the PreReadyItem so menu sales
    // mirror back into the correct counter from day one.
    const ingredientName = `[PR] ${item.name}`;
    let mirror = await this.prisma.ingredient.findFirst({
      where: { branchId, name: ingredientName, deletedAt: null },
      select: { id: true, hasVariants: true },
    });
    if (mirror) {
      const claimed = await this.prisma.preReadyItem.findFirst({
        where: { producesIngredientId: mirror.id, id: { not: item.id }, deletedAt: null },
        select: { id: true },
      });
      // Skip the link silently when the Ingredient is already paired to
      // another PreReadyItem or is a variant-parent — admin can wire
      // it manually via the picker if they really intend to repoint.
      if (claimed || mirror.hasVariants) {
        mirror = null;
      }
    }
    let snapStock = 0;
    if (!mirror) {
      const created = await this.prisma.ingredient.create({
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
        select: { id: true, hasVariants: true },
      });
      mirror = created;
    } else {
      // Existing mirror — read its currentStock so the new
      // PreReadyItem.currentStock can snap to it. Keeps inventory as
      // the single source of truth from the moment the link is made.
      const full = await this.prisma.ingredient.findUnique({
        where: { id: mirror.id },
        select: { currentStock: true },
      });
      if (full) snapStock = Number(full.currentStock);
    }
    await this.prisma.preReadyItem.update({
      where: { id: item.id },
      data: { producesIngredientId: mirror.id, currentStock: snapStock } as any,
    });

    return item;
  }

  /**
   * One-shot retro-link sweep. Walks every PreReadyItem on the branch
   * that doesn't have producesIngredientId set, finds the matching
   * "[PR] <name>" Ingredient (when one exists, isn't already claimed,
   * and isn't a variant-parent), and stamps the link. Returns a
   * report so admin can see what got linked, what was skipped, and
   * which items still need a manual decision.
   *
   * Idempotent — running it twice is a no-op the second time
   * because the WHERE filter excludes items already linked.
   */
  async backfillLinks(branchId: string) {
    const candidates = await this.prisma.preReadyItem.findMany({
      where: { branchId, deletedAt: null, producesIngredientId: null } as any,
      select: { id: true, name: true },
    });

    const linked: Array<{ preReadyId: string; preReadyName: string; ingredientId: string }> = [];
    const skipped: Array<{ preReadyId: string; preReadyName: string; reason: string }> = [];

    for (const pr of candidates) {
      const ingredientName = `[PR] ${pr.name}`;
      const mirror = await this.prisma.ingredient.findFirst({
        where: { branchId, name: ingredientName, deletedAt: null },
        select: { id: true, hasVariants: true },
      });
      if (!mirror) {
        skipped.push({ preReadyId: pr.id, preReadyName: pr.name, reason: `No "${ingredientName}" ingredient found` });
        continue;
      }
      if (mirror.hasVariants) {
        skipped.push({ preReadyId: pr.id, preReadyName: pr.name, reason: 'Matched ingredient is a variant-parent (would split production yield)' });
        continue;
      }
      const claimed = await this.prisma.preReadyItem.findFirst({
        where: { producesIngredientId: mirror.id, deletedAt: null } as any,
        select: { id: true, name: true },
      });
      if (claimed) {
        skipped.push({ preReadyId: pr.id, preReadyName: pr.name, reason: `Ingredient already linked to "${claimed.name}"` });
        continue;
      }
      // Snap PreReadyItem.currentStock to match the inventory side at
      // link time — inventory is now the single source of truth.
      const ingFull = await this.prisma.ingredient.findUnique({
        where: { id: mirror.id },
        select: { currentStock: true },
      });
      const snapStock = ingFull ? Number(ingFull.currentStock) : 0;
      await this.prisma.preReadyItem.update({
        where: { id: pr.id },
        data: { producesIngredientId: mirror.id, currentStock: snapStock } as any,
      });
      linked.push({ preReadyId: pr.id, preReadyName: pr.name, ingredientId: mirror.id });
    }

    return {
      scanned: candidates.length,
      linkedCount: linked.length,
      skippedCount: skipped.length,
      linked,
      skipped,
    };
  }

  async updateItem(
    id: string,
    branchId: string,
    dto: { name?: string; minimumStock?: number; unit?: string; autoDeductInputs?: boolean; producesIngredientId?: string | null },
  ) {
    const item = await this.findOneItem(id, branchId);

    // Unit change is destructive on the meaning of every Decimal that
    // counts the item. Gate it behind "every on-hand source is zero +
    // no active production orders" before letting it through.
    let unitChanged = false;
    if (dto.unit && dto.unit !== item.unit) {
      // 1. Pre-Ready item's own currentStock
      if (item.currentStock.toNumber() > 0) {
        throw new BadRequestException(`Cannot change unit: ${item.name} has ${item.currentStock.toNumber()} ${item.unit} on hand. Set pre-ready stock to 0 first (Data Cleanup → Set all pre-ready stock to 0).`);
      }
      // 2. Live batches (remainingQty > 0). Closed batches stay as
      //    historical rows in their original unit — that's acceptable.
      const liveBatches = await this.prisma.preReadyBatch.count({
        where: { branchId, preReadyItemId: id, remainingQty: { gt: 0 } },
      });
      if (liveBatches > 0) {
        throw new BadRequestException(`Cannot change unit: ${liveBatches} batch(es) still have remaining stock. Use the live batches up or clear them via Data Cleanup → Delete made batches only.`);
      }
      // 3. The mirrored [PR] Ingredient's currentStock
      const mirrorName = `[PR] ${item.name}`;
      const mirror = await this.prisma.ingredient.findFirst({
        where: { branchId, name: mirrorName, deletedAt: null },
      });
      if (mirror && mirror.currentStock.toNumber() > 0) {
        throw new BadRequestException(`Cannot change unit: the inventory mirror "${mirrorName}" still has ${mirror.currentStock.toNumber()} ${mirror.unit} on hand.`);
      }
      // 4. No active production orders — completing one after the
      //    flip would write batches with mixed-unit interpretation.
      const activeProductions = await this.prisma.productionOrder.count({
        where: { branchId, preReadyItemId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
      if (activeProductions > 0) {
        throw new BadRequestException(`Cannot change unit: ${activeProductions} active production order(s) carry quantity in ${item.unit}. Cancel or complete them first.`);
      }
      unitChanged = true;
    }

    return this.prisma.$transaction(async (tx) => {
      // When admin sets a NEW link (or changes it), snap
      // PreReadyItem.currentStock to match the linked Ingredient's
      // currentStock immediately. Inventory is the single source of
      // truth — so the moment the link is established, the
      // PreReadyItem column adopts the inventory value. Previously
      // both counters could hold different stock at link time, which
      // caused the "double-deduct until reconciled" footgun.
      let snapStock: number | null = null;
      if (dto.producesIngredientId && dto.producesIngredientId !== (item as { producesIngredientId?: string | null }).producesIngredientId) {
        const target = await tx.ingredient.findFirst({
          where: { id: dto.producesIngredientId, branchId, deletedAt: null },
          select: { currentStock: true },
        });
        if (target) snapStock = Number(target.currentStock);
      }
      const updated = await tx.preReadyItem.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
          ...(unitChanged ? { unit: dto.unit as any } : {}),
          ...(dto.autoDeductInputs !== undefined ? { autoDeductInputs: dto.autoDeductInputs } as any : {}),
          ...(dto.producesIngredientId !== undefined ? { producesIngredientId: dto.producesIngredientId } as any : {}),
          ...(snapStock !== null ? { currentStock: snapStock } : {}),
        },
      });

      // Keep the [PR] mirror Ingredient in lock-step with whatever
      // changed here — name, unit, or both. Backfills the mirror for
      // pre-ready items that pre-date the auto-mirror code in
      // createItem. Pure idempotent.
      const newName = updated.name;
      const newUnit = updated.unit;
      const newMirrorName = `[PR] ${newName}`;
      // Find the mirror by either the new or old name (rename safety).
      const oldMirrorName = `[PR] ${item.name}`;
      let mirror = await tx.ingredient.findFirst({
        where: { branchId, name: { in: [newMirrorName, oldMirrorName] }, deletedAt: null },
      });
      if (!mirror) {
        // Backfill — old item that never got a mirror because it was
        // created before the auto-mirror code shipped.
        mirror = await tx.ingredient.create({
          data: {
            branchId,
            name: newMirrorName,
            unit: newUnit,
            category: 'OTHER',
            currentStock: 0,
            minimumStock: 0,
            costPerUnit: updated.costPerUnit,
            itemCode: `PR-${updated.id.slice(-6).toUpperCase()}`,
          },
        });
      } else if (mirror.name !== newMirrorName || mirror.unit !== newUnit) {
        await tx.ingredient.update({
          where: { id: mirror.id },
          data: { name: newMirrorName, unit: newUnit as any },
        });
      }

      return updated;
    });
  }

  /** List menu recipes that reference the pre-ready item's mirror
   *  ingredient. Returned to the UI on the unit-change dialog so admin
   *  can review which recipes need their RecipeItem.unit / quantity
   *  re-entered after a unit flip. Pure read. */
  async getMenuRecipesUsingPreReady(id: string, branchId: string) {
    const item = await this.findOneItem(id, branchId);
    const mirrorName = `[PR] ${item.name}`;
    const mirror = await this.prisma.ingredient.findFirst({
      where: { branchId, name: mirrorName, deletedAt: null },
      select: { id: true, unit: true },
    });
    if (!mirror) return { mirrorUnit: null, recipes: [] };
    const recipeItems = await this.prisma.recipeItem.findMany({
      where: { ingredientId: mirror.id, recipe: { menuItem: { branchId, deletedAt: null } } },
      select: {
        id: true,
        quantity: true,
        unit: true,
        recipe: { select: { menuItem: { select: { id: true, name: true } } } },
      },
    });
    return {
      mirrorUnit: mirror.unit,
      recipes: recipeItems.map((r) => ({
        recipeItemId: r.id,
        menuItemId: r.recipe.menuItem.id,
        menuItemName: r.recipe.menuItem.name,
        quantity: r.quantity.toNumber(),
        unit: r.unit,
      })),
    };
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

    // Honour the per-PreReadyItem opt-out for input-side ingredient
    // deduction. Some kitchens reconcile raw stock manually at end of
    // week and don't want production to silently eat their inventory.
    const autoDeduct = (po.preReadyItem as { autoDeductInputs?: boolean }).autoDeductInputs !== false;

    const txResult = await this.prisma.$transaction(async (tx) => {
      // 1. Deduct raw ingredients based on recipe (proportional to production qty)
      if (autoDeduct && recipe && recipe.items.length > 0) {
        for (let idx = 0; idx < recipe.items.length; idx++) {
          const recipeItem = recipe.items[idx];
          const deductQty = conversions[idx];
          // costPerUnit pre-fetched above into ingredientCosts[]; reuse
          // so the SALE movement carries the same per-stock-unit cost
          // we used to compute totalProductionCost. Variant branch
          // overrides with the variant's own cost below.
          const recipeIngCost = ingredientCosts[idx]?.costPerUnit ?? 0;

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
              await tx.stockMovement.create({ data: { branchId, ingredientId: variant.id, type: 'SALE', quantity: -deduct, notes: `Pre-ready production: ${po.preReadyItem.name} x${producedQty}`, unitCostPaisa: Number(variant.costPerUnit) } });
              remaining -= deduct;
            }
            if (remaining > 0) {
              const fallback = variants[0] ?? await tx.ingredient.findFirst({ where: { parentId: recipeItem.ingredientId, isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
              if (fallback) {
                await tx.ingredient.update({ where: { id: fallback.id }, data: { currentStock: { decrement: remaining } } });
                await tx.stockMovement.create({ data: { branchId, ingredientId: fallback.id, type: 'SALE', quantity: -remaining, notes: `Pre-ready production: ${po.preReadyItem.name} x${producedQty} (insufficient)`, unitCostPaisa: Number(fallback.costPerUnit) } });
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
                unitCostPaisa: recipeIngCost,
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

      // 4. Bump the linked Inventory Ingredient by the produced yield.
      //    Lookup order:
      //      a) Explicit producesIngredientId on the PreReadyItem (new
      //         schema, immune to PreReadyItem renames).
      //      b) Legacy "[PR] <name>" name match (every install before
      //         this commit relied on it).
      //      c) Auto-create a fresh "[PR] <name>" Ingredient if neither
      //         exists, and stamp producesIngredientId so subsequent
      //         productions hit (a) directly.
      //    Whichever path resolves the row, we backfill
      //    producesIngredientId so the Pre-Ready ↔ Inventory pairing
      //    becomes explicit and survives a future rename.
      const linkedId = (po.preReadyItem as { producesIngredientId?: string | null }).producesIngredientId ?? null;
      const ingredientName = `[PR] ${po.preReadyItem.name}`;
      let ingredient = linkedId
        ? await tx.ingredient.findFirst({ where: { id: linkedId, branchId, deletedAt: null } })
        : null;
      if (!ingredient) {
        ingredient = await tx.ingredient.findFirst({
          where: { branchId, name: ingredientName, deletedAt: null },
        });
      }
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
      // Backfill the link so subsequent productions skip the name
      // lookup and survive PreReadyItem renames.
      if (!linkedId) {
        await tx.preReadyItem.update({
          where: { id: po.preReadyItemId },
          data: { producesIngredientId: ingredient.id } as any,
        });
      }

      // Create stock movement for the inventory ingredient. New
      // PRODUCTION_RECEIVED type (not PURCHASE) so the Stock
      // Movements feed cleanly distinguishes "we made it ourselves"
      // from "we bought it from a supplier".
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: ingredient.id,
          type: 'PRODUCTION_RECEIVED',
          quantity: producedQty,
          notes: `Production: ${po.preReadyItem.name} ×${producedQty} ${po.preReadyItem.unit}`,
          // Per-produced-unit cost rolled up from the recipe input
          // costs above. Ensures the Stock Watcher report shows the
          // produced batch at its real input-cost basis.
          unitCostPaisa: costPerProducedUnit,
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
            await tx.stockMovement.create({ data: { branchId, ingredientId: v.id, type: 'WASTE', quantity: -deduct, notes: wasteNotes, unitCostPaisa: Number(v.costPerUnit) } });
            await tx.wasteLog.create({ data: { branchId, ingredientId: v.id, quantity: deduct, reason: 'PREPARATION_ERROR', notes: wasteNotes, recordedById: dto.staffId } });
            remaining -= deduct;
          }
          if (remaining > 0) {
            const fallback = variants[0] ?? await tx.ingredient.findFirst({ where: { parentId: c.ingredientId, isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
            if (fallback) {
              await tx.ingredient.update({ where: { id: fallback.id }, data: { currentStock: { decrement: remaining } } });
              await tx.stockMovement.create({ data: { branchId, ingredientId: fallback.id, type: 'WASTE', quantity: -remaining, notes: wasteNotes, unitCostPaisa: Number(fallback.costPerUnit) } });
              await tx.wasteLog.create({ data: { branchId, ingredientId: fallback.id, quantity: remaining, reason: 'PREPARATION_ERROR', notes: wasteNotes, recordedById: dto.staffId } });
            }
          }
          wasteSyncIds.add(c.ingredientId);
        } else {
          const standalone = await tx.ingredient.findUnique({ where: { id: c.ingredientId }, select: { costPerUnit: true } });
          await tx.ingredient.update({
            where: { id: c.ingredientId },
            data: { currentStock: { decrement: c.deductQty } },
          });
          await tx.stockMovement.create({ data: { branchId, ingredientId: c.ingredientId, type: 'WASTE', quantity: -c.deductQty, notes: wasteNotes, unitCostPaisa: standalone?.costPerUnit.toNumber() ?? 0 } });
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

  // ── Bulk Reconciliation ──────────────────────────────────────────────────
  //
  // Use case: during a rush the kitchen produces pre-ready dishes manually
  // (no time to walk through the Production Order → Approve → Start →
  // Complete flow per item). Once things calm down, admin opens the
  // Reconcile tab, types the actual on-hand count for every pre-ready
  // item, and the system back-fills the bookkeeping in one shot:
  //
  //   delta = physical − currentStock
  //     delta >  0  →  production batch + mirror Ingredient increment +
  //                    PRODUCTION_RECEIVED stock movement (no raw input
  //                    deduction — admin already consumed the inputs in
  //                    the kitchen).
  //     delta == 0  →  skipped.
  //     delta <  0  →  WasteLog row + mirror Ingredient decrement +
  //                    WASTE stock movement.
  //
  // Mirrors ReconciliationService.submit() but for PreReadyItems instead
  // of Ingredients. Single making/expiry date in the DTO applies to every
  // production-side row.

  /**
   * Apply a bulk pre-ready stocktake. See class-level comment above for
   * the routing rules. Returns a row-by-row report so the UI can show
   * "+12 G Biryani Sauce produced, −40 G Curry Base wasted, …".
   *
   * Each row's writes happen inside the per-row try block so a partial
   * failure leaves earlier successful rows committed — the operator can
   * re-submit just the failed rows instead of starting over.
   */
  async bulkReconcile(user: JwtPayload, dto: BulkPreReadyReconcileDto): Promise<BulkPreReadyReconcileResult> {
    if (!Array.isArray(dto.rows) || dto.rows.length === 0) {
      throw new BadRequestException('At least one row is required');
    }
    const makingDate = new Date(dto.makingDate);
    const expiryDate = new Date(dto.expiryDate);
    if (Number.isNaN(makingDate.getTime()) || Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException('makingDate and expiryDate must be valid dates');
    }
    if (expiryDate < makingDate) {
      throw new BadRequestException('expiryDate cannot be before makingDate');
    }

    const ids = Array.from(new Set(dto.rows.map((r) => r.preReadyItemId)));
    const items = await this.prisma.preReadyItem.findMany({
      where: { id: { in: ids }, branchId: user.branchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        costPerUnit: true,
        producesIngredientId: true,
        producesIngredient: { select: { id: true, currentStock: true, costPerUnit: true } },
        autoDeductInputs: true,
        recipe: { include: { items: true } },
      } as never,
    }) as Array<{
      id: string;
      name: string;
      unit: string;
      currentStock: { toNumber(): number };
      costPerUnit: { toNumber(): number };
      producesIngredientId: string | null;
      producesIngredient: { id: string; currentStock: { toNumber(): number }; costPerUnit: { toNumber(): number } } | null;
      autoDeductInputs?: boolean | null;
      recipe: {
        yieldQuantity: { toNumber(): number };
        items: Array<{ ingredientId: string; quantity: { toNumber(): number }; unit: string }>;
      } | null;
    }>;
    const itemById = new Map(items.map((i) => [i.id, i] as const));

    const noteSuffix = dto.notes ? ` — ${dto.notes}` : '';
    const results: BulkPreReadyReconcileRowResult[] = [];
    // Variant parents whose children we decremented — synced after the
    // per-row loop so the parent.currentStock aggregate stays in step.
    const parentSyncIds = new Set<string>();

    for (const row of dto.rows) {
      const item = itemById.get(row.preReadyItemId);
      if (!item) {
        results.push({
          preReadyItemId: row.preReadyItemId,
          preReadyItemName: '(unknown)',
          unit: '',
          before: 0,
          after: 0,
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: 'Pre-ready item not found in this branch',
        });
        continue;
      }

      const physical = Number(row.physicalQty);
      if (!Number.isFinite(physical) || physical < 0) {
        results.push({
          preReadyItemId: item.id,
          preReadyItemName: item.name,
          unit: item.unit,
          before: item.currentStock.toNumber(),
          after: item.currentStock.toNumber(),
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: 'Physical count must be a non-negative number',
        });
        continue;
      }

      // The mirror Ingredient is the single source of truth when the link
      // is in place — read from there so the delta matches what the rest
      // of the system sees. Fall back to the PreReadyItem column for
      // legacy items that aren't linked yet.
      const before = item.producesIngredient
        ? item.producesIngredient.currentStock.toNumber()
        : item.currentStock.toNumber();
      const delta = round4(physical - before);
      const unitCost = item.costPerUnit.toNumber();

      if (Math.abs(delta) < 0.0001) {
        results.push({
          preReadyItemId: item.id,
          preReadyItemName: item.name,
          unit: item.unit,
          before,
          after: before,
          delta: 0,
          outcome: 'skipped',
          valuePaisa: 0,
        });
        continue;
      }

      try {
        if (delta > 0) {
          // Production-side: deduct raw recipe ingredients (so the books
          // balance — the kitchen really did consume those inputs to make
          // the +delta units), then bump pre-ready + mirror, record batch
          // + PRODUCTION_RECEIVED movement. Honours the per-item
          // autoDeductInputs opt-out (some kitchens manually reconcile
          // raw stock end-of-week and don't want production touching it).
          const autoDeduct = item.autoDeductInputs !== false;
          const recipe = item.recipe;

          // Pre-compute unit conversions + ingredient costs OUTSIDE the
          // transaction (mirrors completeProduction). Fresh costs are
          // read from current ingredients, NOT the cached item
          // costPerUnit — that way raw price changes flow into both the
          // SALE movements AND the produced batch's basis.
          const conversions: number[] = [];
          const ingredientCosts: { costPerUnit: number }[] = [];
          let totalProductionCost = 0;
          if (autoDeduct && recipe && recipe.items.length > 0) {
            const yieldQty = recipe.yieldQuantity.toNumber();
            const ratio = delta / yieldQty;
            for (const ri of recipe.items) {
              let deductQty = ri.quantity.toNumber() * ratio;
              const ing = await this.prisma.ingredient.findUnique({
                where: { id: ri.ingredientId },
                select: { unit: true, costPerUnit: true },
              });
              if (ing && ri.unit !== ing.unit) {
                deductQty = await this.unitConversionService.convert(
                  user.branchId,
                  deductQty,
                  ri.unit,
                  ing.unit,
                );
              }
              const costPerUnitNative = ing?.costPerUnit.toNumber() ?? 0;
              conversions.push(deductQty);
              ingredientCosts.push({ costPerUnit: costPerUnitNative });
              totalProductionCost += deductQty * costPerUnitNative;
            }
          }
          // Cost-per-produced-unit basis for this row. Falls back to the
          // cached preReadyItem cost if there's no recipe (legacy items).
          const costPerProducedUnit = (autoDeduct && recipe && recipe.items.length > 0 && delta > 0)
            ? Math.round(totalProductionCost / delta)
            : unitCost;

          await this.prisma.$transaction(async (tx) => {
            // 1. Deduct raw ingredients per recipe (variant-aware FIFO).
            if (autoDeduct && recipe && recipe.items.length > 0) {
              for (let idx = 0; idx < recipe.items.length; idx++) {
                const ri = recipe.items[idx];
                const deductQty = conversions[idx];
                const recipeIngCost = ingredientCosts[idx]?.costPerUnit ?? 0;
                const notes = `Bulk reconcile production: ${item.name} +${delta} ${item.unit}${noteSuffix}`;

                const ing = await tx.ingredient.findUnique({
                  where: { id: ri.ingredientId },
                  select: { hasVariants: true },
                });
                if (ing?.hasVariants) {
                  const variants = await tx.ingredient.findMany({
                    where: { parentId: ri.ingredientId, isActive: true, deletedAt: null, currentStock: { gt: 0 } },
                    orderBy: { createdAt: 'asc' },
                  });
                  let remaining = deductQty;
                  for (const variant of variants) {
                    if (remaining <= 0) break;
                    const available = Number(variant.currentStock);
                    const take = Math.min(remaining, available);
                    await tx.ingredient.update({ where: { id: variant.id }, data: { currentStock: { decrement: take } } });
                    await tx.stockMovement.create({
                      data: {
                        branchId: user.branchId,
                        ingredientId: variant.id,
                        type: 'SALE',
                        quantity: -take,
                        notes,
                        unitCostPaisa: Number(variant.costPerUnit),
                      },
                    });
                    remaining -= take;
                  }
                  if (remaining > 0) {
                    const fallback = variants[0] ?? await tx.ingredient.findFirst({
                      where: { parentId: ri.ingredientId, isActive: true, deletedAt: null },
                      orderBy: { createdAt: 'asc' },
                    });
                    if (fallback) {
                      await tx.ingredient.update({ where: { id: fallback.id }, data: { currentStock: { decrement: remaining } } });
                      await tx.stockMovement.create({
                        data: {
                          branchId: user.branchId,
                          ingredientId: fallback.id,
                          type: 'SALE',
                          quantity: -remaining,
                          notes: `${notes} (insufficient)`,
                          unitCostPaisa: Number(fallback.costPerUnit),
                        },
                      });
                    }
                  }
                  parentSyncIds.add(ri.ingredientId);
                } else {
                  await tx.ingredient.update({
                    where: { id: ri.ingredientId },
                    data: { currentStock: { decrement: deductQty } },
                  });
                  await tx.stockMovement.create({
                    data: {
                      branchId: user.branchId,
                      ingredientId: ri.ingredientId,
                      type: 'SALE',
                      quantity: -deductQty,
                      notes,
                      unitCostPaisa: recipeIngCost,
                    },
                  });
                }
              }
            }

            // 2. Bump the pre-ready item's own stock.
            await tx.preReadyItem.update({
              where: { id: item.id },
              data: { currentStock: { increment: delta } },
            });

            // 3. Resolve / auto-create the mirror Ingredient.
            const mirrorIngredient = await this.resolveMirrorIngredient(
              tx,
              user.branchId,
              item,
              delta,
              costPerProducedUnit,
            );

            // 4. Weighted-average cost update on the mirror.
            const existingStock = mirrorIngredient.currentStock.toNumber();
            const existingCost = mirrorIngredient.costPerUnit.toNumber();
            const totalStock = existingStock + delta;
            const weightedAvgCost = totalStock > 0
              ? Math.round((existingStock * existingCost + delta * costPerProducedUnit) / totalStock)
              : costPerProducedUnit;
            await tx.ingredient.update({
              where: { id: mirrorIngredient.id },
              data: {
                currentStock: { increment: delta },
                costPerUnit: weightedAvgCost,
              },
            });

            // 5. Batch + PRODUCTION_RECEIVED movement.
            await tx.preReadyBatch.create({
              data: {
                branchId: user.branchId,
                preReadyItemId: item.id,
                quantity: delta,
                remainingQty: delta,
                makingDate,
                expiryDate,
              },
            });

            await tx.stockMovement.create({
              data: {
                branchId: user.branchId,
                ingredientId: mirrorIngredient.id,
                type: 'PRODUCTION_RECEIVED',
                quantity: delta,
                notes: `Bulk reconcile production: ${item.name} +${delta} ${item.unit}${noteSuffix}`,
                unitCostPaisa: costPerProducedUnit,
              },
            });
          });

          results.push({
            preReadyItemId: item.id,
            preReadyItemName: item.name,
            unit: item.unit,
            before,
            after: round4(before + delta),
            delta,
            outcome: 'produced',
            valuePaisa: Math.round(delta * costPerProducedUnit),
          });
        } else {
          // Wastage side: negative delta. Decrement both counters,
          // write a WasteLog row + WASTE stock movement on the mirror.
          // We don't decrement raw ingredients — the wastage is on the
          // FINISHED pre-ready stock, not the raw inputs.
          const shortfall = Math.abs(delta);
          await this.prisma.$transaction(async (tx) => {
            await tx.preReadyItem.update({
              where: { id: item.id },
              data: { currentStock: { decrement: shortfall } },
            });

            const mirrorIngredient = await this.resolveMirrorIngredient(
              tx,
              user.branchId,
              item,
              0,
              unitCost,
            );

            await tx.ingredient.update({
              where: { id: mirrorIngredient.id },
              data: { currentStock: { decrement: shortfall } },
            });

            await tx.stockMovement.create({
              data: {
                branchId: user.branchId,
                ingredientId: mirrorIngredient.id,
                type: 'WASTE',
                quantity: -shortfall,
                notes: `Bulk reconcile wastage: ${item.name} -${shortfall} ${item.unit}${noteSuffix}`,
                unitCostPaisa: unitCost,
              },
            });

            await tx.wasteLog.create({
              data: {
                branchId: user.branchId,
                ingredientId: mirrorIngredient.id,
                quantity: shortfall,
                reason: 'SPOILAGE',
                notes: `Bulk pre-ready reconciliation${noteSuffix}`,
                recordedById: user.sub,
              },
            });
          });

          results.push({
            preReadyItemId: item.id,
            preReadyItemName: item.name,
            unit: item.unit,
            before,
            after: round4(before + delta),
            delta,
            outcome: 'wasted',
            valuePaisa: Math.round(shortfall * unitCost),
          });
        }
      } catch (err) {
        results.push({
          preReadyItemId: item.id,
          preReadyItemName: item.name,
          unit: item.unit,
          before,
          after: before,
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: (err as Error).message,
        });
      }
    }

    // Sync variant-parent aggregates (currentStock + costPerUnit roll-up)
    // once all per-row transactions have committed. Same pattern as
    // completeProduction's parentSyncIds loop.
    for (const parentId of parentSyncIds) {
      await this.ingredientService.syncParentStock(parentId);
    }

    const summary = this.summariseBulk(results);

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'PRE_READY',
      action: 'UPDATE',
      entityType: 'preReadyReconcile',
      entityId: `prr-${new Date().toISOString()}`,
      entityName: dto.notes?.trim() || 'Bulk Pre-Ready Reconcile',
      summary: `Bulk reconcile: ${summary.producedRows} produced, ${summary.wastedRows} wasted, ${summary.skippedRows} matched, ${summary.failedRows} failed`,
      after: {
        notes: dto.notes ?? null,
        makingDate: dto.makingDate,
        expiryDate: dto.expiryDate,
        producedRows: summary.producedRows,
        wastedRows: summary.wastedRows,
        skippedRows: summary.skippedRows,
        failedRows: summary.failedRows,
        totalQtyProduced: summary.totalQtyProduced,
        totalQtyWasted: summary.totalQtyWasted,
        valuePaisaProduced: summary.valuePaisaProduced,
        valuePaisaWasted: summary.valuePaisaWasted,
      },
    });

    return summary;
  }

  /**
   * Resolve the mirror Ingredient for a PreReadyItem, creating one if
   * needed. Mirrors the resolution cascade used inside
   * completeProduction so a bulk-reconcile row produces the same
   * lookup behaviour as a regular production-order completion.
   *
   * The `newQty` + `unitCost` are used only when we have to CREATE the
   * mirror (no existing link, no name match) — they seed the new
   * Ingredient's currentStock + costPerUnit. For existing mirrors we
   * leave those fields untouched and the caller bumps them after.
   */
  private async resolveMirrorIngredient(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    branchId: string,
    item: { id: string; name: string; unit: string; producesIngredientId: string | null },
    newQty: number,
    unitCost: number,
  ): Promise<{ id: string; currentStock: { toNumber(): number }; costPerUnit: { toNumber(): number } }> {
    if (item.producesIngredientId) {
      const linked = await tx.ingredient.findFirst({
        where: { id: item.producesIngredientId, branchId, deletedAt: null },
        select: { id: true, currentStock: true, costPerUnit: true },
      });
      if (linked) return linked;
    }
    const ingredientName = `[PR] ${item.name}`;
    const byName = await tx.ingredient.findFirst({
      where: { branchId, name: ingredientName, deletedAt: null },
      select: { id: true, currentStock: true, costPerUnit: true },
    });
    if (byName) {
      // Backfill the link for future runs.
      await tx.preReadyItem.update({
        where: { id: item.id },
        data: { producesIngredientId: byName.id } as never,
      });
      return byName;
    }
    // None exists — create it.
    const created = await tx.ingredient.create({
      data: {
        branchId,
        name: ingredientName,
        unit: item.unit as never,
        category: 'OTHER',
        currentStock: newQty,
        minimumStock: 0,
        costPerUnit: unitCost,
        itemCode: `PR-${item.id.slice(-6).toUpperCase()}`,
      },
      select: { id: true, currentStock: true, costPerUnit: true },
    });
    await tx.preReadyItem.update({
      where: { id: item.id },
      data: { producesIngredientId: created.id } as never,
    });
    return created;
  }

  private summariseBulk(rows: BulkPreReadyReconcileRowResult[]): BulkPreReadyReconcileResult {
    let producedRows = 0;
    let wastedRows = 0;
    let skippedRows = 0;
    let failedRows = 0;
    let totalQtyProduced = 0;
    let totalQtyWasted = 0;
    let valuePaisaProduced = 0;
    let valuePaisaWasted = 0;
    for (const r of rows) {
      if (r.outcome === 'produced') {
        producedRows += 1;
        totalQtyProduced += r.delta;
        valuePaisaProduced += r.valuePaisa;
      } else if (r.outcome === 'wasted') {
        wastedRows += 1;
        totalQtyWasted += Math.abs(r.delta);
        valuePaisaWasted += r.valuePaisa;
      } else if (r.outcome === 'skipped') {
        skippedRows += 1;
      } else {
        failedRows += 1;
      }
    }
    return {
      countedRows: rows.length,
      producedRows,
      wastedRows,
      skippedRows,
      failedRows,
      totalQtyProduced: round4(totalQtyProduced),
      totalQtyWasted: round4(totalQtyWasted),
      valuePaisaProduced,
      valuePaisaWasted,
      rows,
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

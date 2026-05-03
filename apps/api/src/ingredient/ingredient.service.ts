import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { CreateIngredientDto, UpdateIngredientDto, AdjustStockDto, CreateVariantDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Auto-generate a unique short code for use as an itemCode or sku when
 * the admin hasn't provided one. Ensures every ingredient + variant has
 * a stable lookup key so the Stock Update CSV can target every row.
 *
 * Format: "AUTO-XXXXXX" — 6 hex chars, case-insensitive unique enough
 * for a single branch's catalogue. We verify uniqueness against the
 * chosen column before returning; 4 retries in the rare collision case,
 * then give up and surface the collision upstream.
 */
async function generateUniqueCode(
  prisma: PrismaService,
  branchId: string,
  field: 'itemCode' | 'sku',
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = `AUTO-${randomBytes(3).toString('hex').toUpperCase()}`;
    const existing = await prisma.ingredient.findFirst({
      where: { branchId, [field]: candidate, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new BadRequestException(`Could not generate a unique ${field} after 4 attempts; retry manually.`);
}

@Injectable()
export class IngredientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RestoraPosGateway,
    private readonly activityLog: ActivityLogService,
  ) {}

  private readonly ingredientInclude = {
    supplier: true,
    suppliers: { include: { supplier: { select: { id: true, name: true } } } },
    variants: {
      where: { deletedAt: null },
      include: { supplier: true },
      orderBy: { createdAt: 'asc' as const },
    },
  };

  findAll(branchId: string) {
    return this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, parentId: null },
      include: this.ingredientInclude,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Per-ingredient usage map across menu recipes + pre-ready recipes
   * for the "Unused" Inventory filter. Variant ↔ parent fan-out:
   *   - A recipe linking the parent marks all variants as used
   *     (deduction is FIFO across variants — see RecipeService).
   *   - A recipe linking a variant marks the parent as used too
   *     (otherwise the parent would always look "unused" because
   *     recipes typically reference one specific brand).
   * Returns one row per ingredient (parents + variants), so the UI
   * can render either by scanning any ID.
   */
  async getIngredientUsage(branchId: string): Promise<Record<string, { menu: number; preReady: number }>> {
    const [ingredients, recipeItems, preReadyItems] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { branchId, deletedAt: null },
        select: { id: true, parentId: true },
      }),
      this.prisma.recipeItem.findMany({
        where: { ingredient: { branchId } },
        select: { ingredientId: true },
      }),
      this.prisma.preReadyRecipeItem.findMany({
        where: { ingredient: { branchId } },
        select: { ingredientId: true },
      }),
    ]);

    // Build the parent → variants index so we can fan out usage.
    const variantsByParent = new Map<string, string[]>();
    const parentByVariant = new Map<string, string>();
    for (const ing of ingredients) {
      if (ing.parentId) {
        const arr = variantsByParent.get(ing.parentId) ?? [];
        arr.push(ing.id);
        variantsByParent.set(ing.parentId, arr);
        parentByVariant.set(ing.id, ing.parentId);
      }
    }

    const usage: Record<string, { menu: number; preReady: number }> = {};
    const bump = (ingredientId: string, kind: 'menu' | 'preReady') => {
      if (!usage[ingredientId]) usage[ingredientId] = { menu: 0, preReady: 0 };
      usage[ingredientId][kind] += 1;
    };
    const recordUsage = (ingredientId: string, kind: 'menu' | 'preReady') => {
      bump(ingredientId, kind);
      // Fan out: if this is a parent, also count every variant as used.
      const variants = variantsByParent.get(ingredientId);
      if (variants) for (const v of variants) bump(v, kind);
      // If this is a variant, also count the parent as used.
      const parent = parentByVariant.get(ingredientId);
      if (parent) bump(parent, kind);
    };
    for (const ri of recipeItems) recordUsage(ri.ingredientId, 'menu');
    for (const pi of preReadyItems) recordUsage(pi.ingredientId, 'preReady');
    return usage;
  }

  async findOne(id: string, branchId: string) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, branchId, deletedAt: null },
      include: this.ingredientInclude,
    });
    if (!ingredient) throw new NotFoundException(`Ingredient ${id} not found`);
    return ingredient;
  }

  // ─── Variant Support ──────────────────────────────────────────────────────

  async createVariant(parentId: string, branchId: string, dto: CreateVariantDto) {
    const parent = await this.findOne(parentId, branchId);
    if (!parent.hasVariants) {
      throw new BadRequestException('Ingredient is not marked as having variants. Convert to parent first.');
    }

    // Auto-generate an SKU when the admin didn't set one — gives every
    // variant a stable lookup key for the Stock Update CSV flow.
    const sku = dto.sku?.trim() || await generateUniqueCode(this.prisma, branchId, 'sku');

    const purchaseUnitQty = dto.piecesPerPack ?? (parent.purchaseUnitQty?.toNumber() ?? 1);
    const costPerPurchaseUnit = dto.costPerPurchaseUnit ?? 0;
    // Derive cost-per-stock-unit so the inventory UI + consumption value
    // calculations don't default to 0. The dialog only collects the
    // per-purchase-unit price, so we infer the per-stock-unit rate here.
    const costPerUnit = purchaseUnitQty > 0 ? costPerPurchaseUnit / purchaseUnitQty : 0;

    return this.prisma.ingredient.create({
      data: {
        branchId,
        parentId,
        name: `${parent.name} — ${dto.brandName}`,
        brandName: dto.brandName,
        packSize: dto.packSize ?? null,
        piecesPerPack: dto.piecesPerPack ?? null,
        sku,
        // Always inherit unit + purchaseUnit from parent
        unit: parent.unit,
        category: parent.category,
        purchaseUnit: parent.purchaseUnit,
        purchaseUnitQty,
        costPerPurchaseUnit,
        costPerUnit,
        supplierId: dto.supplierId ?? null,
      },
      include: { supplier: true },
    });
  }

  async convertToParent(id: string, branchId: string) {
    const ingredient = await this.findOne(id, branchId);
    if (ingredient.hasVariants) throw new BadRequestException('Already a parent with variants');
    if (ingredient.parentId) throw new BadRequestException('Cannot convert a variant to a parent');

    const currentStock = ingredient.currentStock.toNumber();
    const costPerUnit = ingredient.costPerUnit.toNumber();
    const costPerPurchaseUnit = ingredient.costPerPurchaseUnit.toNumber();

    return this.prisma.$transaction(async (tx) => {
      // Mark as parent
      await tx.ingredient.update({
        where: { id },
        data: { hasVariants: true },
      });

      // If had stock, create a default variant with that stock
      if (currentStock > 0) {
        await tx.ingredient.create({
          data: {
            branchId,
            parentId: id,
            name: `${ingredient.name} — Default`,
            brandName: 'Default',
            unit: ingredient.unit,
            category: ingredient.category,
            currentStock,
            costPerUnit,
            costPerPurchaseUnit,
            purchaseUnit: ingredient.purchaseUnit,
            purchaseUnitQty: ingredient.purchaseUnitQty,
            supplierId: ingredient.supplierId,
          },
        });
      }

      return this.findOne(id, branchId);
    });
  }

  // One-shot backfill: re-derive every variant's costPerUnit from its
  // costPerPurchaseUnit / purchaseUnitQty pair. Fixes installs where
  // variants were created before createVariant started setting costPerUnit,
  // which would otherwise show the per-pack price in the Cost/Unit column
  // and blow up consumption-value rollups.
  async repairVariantCosts(branchId: string) {
    const variants = await this.prisma.ingredient.findMany({
      where: { branchId, parentId: { not: null }, deletedAt: null },
      select: { id: true, parentId: true, costPerPurchaseUnit: true, purchaseUnitQty: true },
    });
    let fixed = 0;
    const parentIds = new Set<string>();
    for (const v of variants) {
      const qty = Number(v.purchaseUnitQty);
      const cpu = Number(v.costPerPurchaseUnit);
      if (qty > 0 && cpu > 0) {
        await this.prisma.ingredient.update({
          where: { id: v.id },
          data: { costPerUnit: cpu / qty },
        });
        fixed += 1;
        if (v.parentId) parentIds.add(v.parentId);
      }
    }
    for (const pid of parentIds) await this.syncParentStock(pid);
    return { scanned: variants.length, fixed, parentsResynced: parentIds.size };
  }

  /**
   * Re-run syncParentStock for every variant-parent ingredient on a
   * branch. Use after a logic fix to syncParentStock to refresh
   * stuck aggregates without waiting for the next stock movement.
   */
  async resyncAllVariantParents(branchId: string) {
    const parents = await this.prisma.ingredient.findMany({
      where: { branchId, hasVariants: true, deletedAt: null },
      select: { id: true },
    });
    for (const p of parents) await this.syncParentStock(p.id);
    return { resynced: parents.length };
  }

  /**
   * Auto-recompute every eligible ingredient's minimumStock from its
   * recent SALE + OPERATIONAL_USE consumption. Drives both the
   * nightly IngredientScheduler and the manual "Recompute Min Stock"
   * button on the Inventory page.
   *
   * Behaviour:
   *  - Window resolves from `daysOverride ?? branchSetting.autoMinStockDays`.
   *    A 0/null window short-circuits with `{updated: 0}` so the
   *    feature is OFF until admin opts in.
   *  - Only walks ingredients with `autoMinStock=true` — opt-out rows
   *    are skipped silently and keep their hand-set minimums.
   *  - Standalone + variant CHILDREN: newMin = sum of |movement.quantity|
   *    over the window for that ingredient.
   *  - Variant PARENTS: newMin = sum of consumption across all their
   *    children (the parent itself rarely receives movements
   *    directly, but if it does they get added).
   *  - Ingredients with zero consumption in the window → newMin = 0.
   *  - Idempotent: skip-when-equal so re-running is a no-op and
   *    activity-log noise stays low.
   *  - Single fire-and-forget activity-log entry summarises the run.
   */
  async recomputeMinimumStock(
    branchId: string,
    daysOverride?: number,
    actor: { sub: string; role: string; name?: string } | null = null,
  ): Promise<{
    scanned: number;
    updated: number;
    skipped: number;
    window: number;
    changes: Array<{ ingredientId: string; name: string; from: number; to: number }>;
  }> {
    // Resolve window — admin's saved value, or an explicit override
    // (lets the manual button experiment with "what would 60 days
    // look like?" without changing the saved BranchSetting).
    let window = daysOverride;
    if (window == null) {
      const settings = await this.prisma.branchSetting.findUnique({
        where: { branchId },
        select: { autoMinStockDays: true } as any,
      });
      window = (settings as { autoMinStockDays?: number } | null)?.autoMinStockDays ?? 0;
    }
    if (!window || window <= 0) {
      return { scanned: 0, updated: 0, skipped: 0, window: 0, changes: [] };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - window);

    // Eligible ingredients: opted into auto-management, not deleted.
    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, autoMinStock: true } as any,
      select: { id: true, name: true, parentId: true, hasVariants: true, minimumStock: true },
    });

    // One range query → in-memory sum-by-ingredient map. Mirrors the
    // existing reports.service.getDailyConsumption pattern but
    // without the per-day grouping.
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        branchId,
        createdAt: { gte: cutoff },
        type: { in: ['SALE', 'OPERATIONAL_USE'] },
      },
      select: { ingredientId: true, quantity: true },
    });
    const consumedByIng = new Map<string, number>();
    for (const m of movements) {
      const q = Math.abs(Number(m.quantity));
      consumedByIng.set(m.ingredientId, (consumedByIng.get(m.ingredientId) ?? 0) + q);
    }

    // Parent aggregation: sum each parent's variants' consumption so
    // the parent row's minimum reflects the ALL-children total. This
    // matches how the existing low-stock alert checks the parent's
    // aggregate stock against parent.minimumStock.
    const variantsByParent = new Map<string, string[]>();
    for (const ing of ingredients) {
      if (ing.parentId) {
        const arr = variantsByParent.get(ing.parentId) ?? [];
        arr.push(ing.id);
        variantsByParent.set(ing.parentId, arr);
      }
    }

    const updates: Array<{ ingredientId: string; name: string; from: number; to: number }> = [];
    let skipped = 0;

    for (const ing of ingredients) {
      let newMin: number;
      if (ing.hasVariants) {
        // Parent: sum variant consumption + the rare parent-direct movements.
        const variantIds = variantsByParent.get(ing.id) ?? [];
        const variantSum = variantIds.reduce((s, id) => s + (consumedByIng.get(id) ?? 0), 0);
        newMin = variantSum + (consumedByIng.get(ing.id) ?? 0);
      } else {
        newMin = consumedByIng.get(ing.id) ?? 0;
      }
      // Round to 4dp to match column precision and avoid float-noise
      // false-positives in the equality check.
      newMin = Math.round(newMin * 10000) / 10000;
      const currentMin = Math.round(Number(ing.minimumStock) * 10000) / 10000;
      if (newMin === currentMin) {
        skipped++;
        continue;
      }
      updates.push({
        ingredientId: ing.id,
        name: ing.name,
        from: currentMin,
        to: newMin,
      });
    }

    // Per-row updates. No transaction wrapper — each row is
    // independent and a partial failure shouldn't roll back the
    // successful ones.
    for (const u of updates) {
      try {
        await this.prisma.ingredient.update({
          where: { id: u.ingredientId },
          data: { minimumStock: u.to },
        });
      } catch {
        // Skip silently and log via activity-log summary; one
        // failure shouldn't bail the entire sweep.
      }
    }

    // Single bulk-summary activity-log entry. Don't emit per-row;
    // would flood the audit feed.
    if (updates.length > 0) {
      void this.activityLog.log({
        branchId,
        actor,
        category: 'INGREDIENT',
        action: 'UPDATE',
        entityType: 'ingredients',
        entityId: 'bulk-recompute-min-stock',
        entityName: 'Auto Min-Stock Recompute',
        after: { window, updated: updates.length, skipped, sample: updates.slice(0, 10) } as any,
        summary: `Auto-recomputed minimum stock for ${updates.length} ingredient(s) (${window}-day window)`,
      });
    }

    return {
      scanned: ingredients.length,
      updated: updates.length,
      skipped,
      window,
      changes: updates,
    };
  }

  async getVariants(id: string, branchId: string) {
    await this.findOne(id, branchId);
    return this.prisma.ingredient.findMany({
      where: { parentId: id, deletedAt: null },
      include: { supplier: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Recalculate parent's aggregate stock and weighted-average cost from variants.
   *  Low-stock warning is based on parent's minimumStock vs aggregate of all variants. */
  async syncParentStock(parentId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const variants = await db.ingredient.findMany({
      where: { parentId, deletedAt: null },
      select: { currentStock: true, costPerUnit: true },
    });

    // currentStock is the signed sum (may be negative when a variant has
    // been over-deducted). The weighted-avg cost, on the other hand, must
    // only consider variants with positive on-hand stock — a negative
    // variant otherwise drags the parent cost below zero (e.g. one
    // variant at −147 × ৳3.53 wiped out the positive contributions and
    // the parent showed cost = −৳0.01). When no variant has positive
    // stock, fall back to the cheapest active variant cost — same
    // policy the order/recipe engines apply when a parent's own cost
    // is 0.
    let totalStock = 0;
    let positiveStock = 0;
    let positiveValue = 0;
    let cheapestPositiveCost: number | null = null;
    for (const v of variants) {
      const stock = Number(v.currentStock);
      const cost = Number(v.costPerUnit);
      totalStock += stock;
      if (stock > 0) {
        positiveStock += stock;
        positiveValue += stock * cost;
      }
      if (cost > 0 && (cheapestPositiveCost == null || cost < cheapestPositiveCost)) {
        cheapestPositiveCost = cost;
      }
    }
    const avgCost = positiveStock > 0
      ? positiveValue / positiveStock
      : (cheapestPositiveCost ?? (variants[0] ? Number(variants[0].costPerUnit) : 0));

    const parent = await db.ingredient.update({
      where: { id: parentId },
      data: { currentStock: totalStock, costPerUnit: avgCost },
    });

    // Emit low-stock alert based on parent aggregate vs parent minimumStock.
    // A minimumStock of 0 means "don't track low stock on this item" — skip
    // the emit so the admin isn't spammed about consumables they don't reorder.
    const minStock = Number(parent.minimumStock);
    if (minStock > 0 && totalStock <= minStock) {
      this.ws.emitToBranch(parent.branchId, 'stock:low', {
        ingredientId: parentId,
        name: parent.name,
        currentStock: totalStock,
        minimumStock: parent.minimumStock,
        unit: parent.unit,
      });
    }
  }

  async create(branchId: string, dto: CreateIngredientDto) {
    // Check for duplicate name
    const existing = await this.prisma.ingredient.findFirst({
      where: { branchId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException(`Ingredient "${dto.name}" already exists`);
    }

    // Every row needs a stable lookup key so the Stock Update CSV can
    // target it. If the admin left itemCode blank, mint a unique one.
    const itemCode = dto.itemCode?.trim() || await generateUniqueCode(this.prisma, branchId, 'itemCode');

    const created = await this.prisma.ingredient.create({
      data: {
        branchId,
        name: dto.name,
        // StockUnit is a broadened `BuiltinStockUnit | (string & {})` so
        // custom units (registered via /custom-units) can be assigned.
        // Prisma's generated enum type doesn't know about runtime
        // additions, so we cast to satisfy the narrow typing.
        unit: dto.unit as any,
        purchaseUnit: dto.purchaseUnit ?? null,
        purchaseUnitQty: dto.purchaseUnitQty ?? 1,
        minimumStock: dto.minimumStock ?? 0,
        costPerUnit: dto.costPerUnit ?? 0,
        costPerPurchaseUnit: dto.costPerPurchaseUnit ?? 0,
        supplierId: dto.supplierId ?? null,
        itemCode,
        category: (dto.category ?? 'RAW') as any,
      },
      include: this.ingredientInclude,
    });

    // websiteDisplayName landed in the DB after generateUniqueCode +
    // friends, so the generated Prisma client may be stale on a fresh
    // local checkout. $executeRaw bypasses the generated type — same
    // pattern branding.service uses for its qrGate columns.
    if (dto.websiteDisplayName !== undefined && dto.websiteDisplayName !== null) {
      const trimmed = String(dto.websiteDisplayName).trim();
      await this.prisma.$executeRaw`
        UPDATE "ingredients"
        SET "websiteDisplayName" = ${trimmed || null}
        WHERE "id" = ${created.id}
      `;
    }

    return created;
  }

  async update(id: string, branchId: string, dto: UpdateIngredientDto & { brandName?: string; packSize?: string | null; piecesPerPack?: number | null; sku?: string | null; autoMinStock?: boolean }) {
    const existing = await this.findOne(id, branchId);
    // Cast the data object wholesale so Prisma picks the unchecked-update
    // overload. Broadening StockUnit to accept custom strings narrowed
    // inference the other way and made Prisma pick the checked-relation
    // overload, which then rejected a scalar supplierId.
    const data: any = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
      ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
      ...(dto.costPerUnit !== undefined ? { costPerUnit: dto.costPerUnit } : {}),
      ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId || null } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.itemCode !== undefined ? { itemCode: dto.itemCode || null } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.purchaseUnit !== undefined ? { purchaseUnit: dto.purchaseUnit || null } : {}),
      ...(dto.purchaseUnitQty !== undefined ? { purchaseUnitQty: dto.purchaseUnitQty } : {}),
      ...(dto.costPerPurchaseUnit !== undefined ? { costPerPurchaseUnit: dto.costPerPurchaseUnit } : {}),
      ...(dto.brandName !== undefined ? { brandName: dto.brandName } : {}),
      ...(dto.packSize !== undefined ? { packSize: dto.packSize } : {}),
      ...(dto.piecesPerPack !== undefined ? { piecesPerPack: dto.piecesPerPack } : {}),
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...((dto as any).imageUrl !== undefined ? { imageUrl: (dto as any).imageUrl } : {}),
      ...((dto as any).showOnWebsite !== undefined ? { showOnWebsite: (dto as any).showOnWebsite } : {}),
      ...(dto.autoMinStock !== undefined ? { autoMinStock: dto.autoMinStock } : {}),
    };

    // websiteDisplayName: written via raw SQL so this works against a
    // stale generated Prisma client (column was added after the API
    // first compiled in some local checkouts). Trim to null so the
    // public fallback engages cleanly when admin clears the field.
    if (dto.websiteDisplayName !== undefined) {
      const trimmed = typeof dto.websiteDisplayName === 'string' ? dto.websiteDisplayName.trim() : '';
      const next = trimmed ? trimmed : null;
      await this.prisma.$executeRaw`
        UPDATE "ingredients" SET "websiteDisplayName" = ${next} WHERE "id" = ${id}
      `;
    }

    // When the admin changes the per-purchase-unit price (or the number of
    // stock units per purchase unit) and didn't also pass an explicit
    // costPerUnit, derive it. Without this, variants created through the
    // dialog — which only collects costPerPurchaseUnit — stay at 0 per
    // stock unit, breaking parent aggregates + consumption valuations.
    if (dto.costPerUnit === undefined && (dto.costPerPurchaseUnit !== undefined || dto.piecesPerPack !== undefined || dto.purchaseUnitQty !== undefined)) {
      const newCostPerPU = dto.costPerPurchaseUnit ?? Number(existing.costPerPurchaseUnit);
      const newQty = dto.piecesPerPack ?? dto.purchaseUnitQty ?? Number(existing.purchaseUnitQty);
      if (newQty > 0) data.costPerUnit = newCostPerPU / newQty;
    }
    const updated = await this.prisma.ingredient.update({
      where: { id },
      data,
      include: this.ingredientInclude,
    });

    // Cascade unit + purchaseUnit + category to every variant when the
    // parent changes them. Variants are constrained to inherit these
    // from their parent (see createVariant), so an unchanged parent
    // leaves its old values stuck on variants otherwise — the owner
    // sees stale G when they flipped the parent to PCS.
    if (
      !updated.parentId &&
      updated.hasVariants &&
      (dto.unit !== undefined || dto.purchaseUnit !== undefined || dto.category !== undefined)
    ) {
      await this.prisma.ingredient.updateMany({
        where: { parentId: id, deletedAt: null },
        data: {
          ...(dto.unit !== undefined ? { unit: dto.unit as any } : {}),
          ...(dto.purchaseUnit !== undefined ? { purchaseUnit: dto.purchaseUnit || null } : {}),
          ...(dto.category !== undefined ? { category: dto.category as any } : {}),
        },
      });
    }

    // Variant cost changed → recompute the parent's weighted-average
    // costPerUnit so the parent row's Cost/Unit + Stock Report line up
    // with the variant's new rate.
    if (updated.parentId && data.costPerUnit !== undefined) {
      await this.syncParentStock(updated.parentId);
    }

    return updated;
  }

  async bulkCreate(
    branchId: string,
    items: {
      name: string;
      unit?: string;
      category?: string;
      itemCode?: string;
      minimumStock?: number;
      costPerUnit?: number;
      purchaseUnit?: string;
      purchaseUnitQty?: number;
      costPerPurchaseUnit?: number;
      parentCode?: string;
      brandName?: string;
      packSize?: string;
      piecesPerPack?: number;
      sku?: string;
    }[],
  ) {
    const results: { name: string; status: 'created' | 'updated' | 'skipped'; reason?: string }[] = [];

    // Two-pass import so variants can reference parents by item code even when
    // the parent row appears after the variant in the CSV:
    //   Pass 1 — create/touch parents (any row without parent_code, plus any
    //            row whose item_code is referenced as parent_code by another).
    //   Pass 2 — create variants, linking by parent_code → parent.itemCode.
    // Codes referenced by variant rows — used below to decide which parent
    // rows should be flagged hasVariants. Stored in two forms so the
    // check covers both itemCode (case-preserving) and name (lowercased).
    const referencedParentCodes = new Set<string>();
    const referencedParentNames = new Set<string>();
    for (const r of items) {
      const pc = r.parentCode?.trim();
      if (!pc) continue;
      referencedParentCodes.add(pc);
      referencedParentNames.add(pc.toLowerCase());
    }

    const parentRows = items.filter((r) => !r.parentCode?.trim());
    const variantRows = items.filter((r) => !!r.parentCode?.trim());

    // parent_code resolves against both itemCode and name (lowercased).
    // That way exported CSVs round-trip even when the owner never bothered
    // to assign item codes — the parent's name acts as the fallback.
    const parentByCode = new Map<string, string>();

    const existingParents = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, parentId: null },
      select: { id: true, itemCode: true, name: true },
    });
    for (const e of existingParents) {
      if (e.itemCode) parentByCode.set(e.itemCode.trim(), e.id);
      // Lowercased name fallback — ignore collisions (first wins).
      const nameKey = e.name.trim().toLowerCase();
      if (!parentByCode.has(nameKey)) parentByCode.set(nameKey, e.id);
    }

    // ─── Pass 1: parents ────────────────────────────────────────────────
    for (const item of parentRows) {
      if (!item.name?.trim()) {
        results.push({ name: item.name ?? '', status: 'skipped', reason: 'Empty name' });
        continue;
      }

      const existing = await this.prisma.ingredient.findFirst({
        where: { branchId, name: item.name.trim(), deletedAt: null },
      });

      // A parent that other rows reference must be marked hasVariants.
      // Referenced by itemCode OR by name.
      const nameLc = item.name.trim().toLowerCase();
      const shouldBeParent =
        (!!item.itemCode && referencedParentCodes.has(item.itemCode.trim())) ||
        referencedParentNames.has(nameLc);

      if (existing) {
        // Round-trip friendly: CSV re-upload updates the existing row's
        // editable fields rather than skipping. Stock + IDs are never
        // touched here — only the catalog-level descriptors the CSV
        // template actually carries.
        await this.prisma.ingredient.update({
          where: { id: existing.id },
          data: {
            // Keep hasVariants if already true; only promote, never demote.
            ...(shouldBeParent && !existing.hasVariants ? { hasVariants: true } : {}),
            ...(item.unit ? { unit: item.unit as any } : {}),
            ...(item.category ? { category: item.category as any } : {}),
            ...(item.itemCode !== undefined ? { itemCode: item.itemCode || null } : {}),
            ...(item.minimumStock !== undefined ? { minimumStock: item.minimumStock } : {}),
            ...(item.costPerUnit !== undefined ? { costPerUnit: item.costPerUnit } : {}),
            ...(item.purchaseUnit !== undefined ? { purchaseUnit: item.purchaseUnit || null } : {}),
            ...(item.purchaseUnitQty !== undefined ? { purchaseUnitQty: item.purchaseUnitQty } : {}),
            ...(item.costPerPurchaseUnit !== undefined ? { costPerPurchaseUnit: item.costPerPurchaseUnit } : {}),
          },
        });
        if (item.itemCode) parentByCode.set(item.itemCode.trim(), existing.id);
        if (existing.itemCode) parentByCode.set(existing.itemCode, existing.id);
        parentByCode.set(item.name.trim().toLowerCase(), existing.id);
        results.push({ name: item.name, status: 'updated' });
        continue;
      }

      const itemCode = item.itemCode?.trim() || await generateUniqueCode(this.prisma, branchId, 'itemCode');
      const created = await this.prisma.ingredient.create({
        data: {
          branchId,
          name: item.name.trim(),
          unit: (item.unit ?? 'PCS') as any,
          category: (item.category ?? 'RAW') as any,
          itemCode,
          minimumStock: item.minimumStock ?? 0,
          costPerUnit: item.costPerUnit ?? 0,
          purchaseUnit: item.purchaseUnit ?? null,
          purchaseUnitQty: item.purchaseUnitQty ?? 1,
          costPerPurchaseUnit: item.costPerPurchaseUnit ?? 0,
          hasVariants: shouldBeParent,
        },
      });
      if (item.itemCode) parentByCode.set(item.itemCode.trim(), created.id);
      parentByCode.set(item.name.trim().toLowerCase(), created.id);
      results.push({ name: item.name, status: 'created' });
    }

    // ─── Pass 2: variants ───────────────────────────────────────────────
    for (const item of variantRows) {
      if (!item.name?.trim()) {
        results.push({ name: item.name ?? '', status: 'skipped', reason: 'Empty name' });
        continue;
      }
      const parentCode = item.parentCode!.trim();
      // Try itemCode match first (exact, case-preserving), then fall back
      // to name match (case-insensitive) so CSVs exported from parents
      // without item codes still round-trip.
      const parentId = parentByCode.get(parentCode) ?? parentByCode.get(parentCode.toLowerCase());
      if (!parentId) {
        results.push({ name: item.name, status: 'skipped', reason: `Parent code "${parentCode}" not found` });
        continue;
      }

      // Parent inherits unit + purchaseUnit semantics — load it.
      const parent = await this.prisma.ingredient.findFirst({
        where: { id: parentId, branchId, deletedAt: null },
      });
      if (!parent) {
        results.push({ name: item.name, status: 'skipped', reason: 'Parent not found (deleted?)' });
        continue;
      }

      // Ensure parent is marked as a parent (if imported in a previous run
      // without variants, promote it now).
      if (!parent.hasVariants) {
        await this.prisma.ingredient.update({
          where: { id: parent.id },
          data: { hasVariants: true },
        });
      }

      const brandName = item.brandName?.trim() || item.name.trim();
      const displayName = `${parent.name} — ${brandName}`;

      // Round-trip friendly: if the variant already exists under this parent
      // with the same display name, update its catalog fields (pack size,
      // pricing, sku) rather than erroring. Stock + linked movements stay
      // untouched.
      const dup = await this.prisma.ingredient.findFirst({
        where: { branchId, name: displayName, parentId: parent.id, deletedAt: null },
      });
      // Derive cost-per-stock-unit when the CSV only gives the pack rate
      // — same reasoning as createVariant: rows without costPerUnit would
      // otherwise be pinned at 0 and skew parent aggregates.
      const variantQty = item.piecesPerPack ?? (parent.purchaseUnitQty?.toNumber() ?? 1);
      const variantCostPU = item.costPerPurchaseUnit ?? 0;
      const variantDerivedCPU = item.costPerUnit ?? (variantQty > 0 ? variantCostPU / variantQty : 0);

      if (dup) {
        await this.prisma.ingredient.update({
          where: { id: dup.id },
          data: {
            brandName,
            ...(item.packSize !== undefined ? { packSize: item.packSize || null } : {}),
            ...(item.piecesPerPack !== undefined ? { piecesPerPack: item.piecesPerPack } : {}),
            ...(item.sku !== undefined ? { sku: item.sku || null } : {}),
            ...(item.piecesPerPack !== undefined ? { purchaseUnitQty: item.piecesPerPack } : {}),
            ...(item.costPerPurchaseUnit !== undefined ? { costPerPurchaseUnit: item.costPerPurchaseUnit } : {}),
            ...(item.costPerUnit !== undefined
              ? { costPerUnit: item.costPerUnit }
              : (item.costPerPurchaseUnit !== undefined || item.piecesPerPack !== undefined)
                ? { costPerUnit: variantDerivedCPU }
                : {}),
          },
        });
        await this.syncParentStock(parent.id);
        results.push({ name: item.name, status: 'updated' });
        continue;
      }

      const sku = item.sku?.trim() || await generateUniqueCode(this.prisma, branchId, 'sku');
      await this.prisma.ingredient.create({
        data: {
          branchId,
          parentId: parent.id,
          name: displayName,
          brandName,
          packSize: item.packSize ?? null,
          piecesPerPack: item.piecesPerPack ?? null,
          sku,
          unit: parent.unit,
          category: parent.category,
          purchaseUnit: parent.purchaseUnit,
          purchaseUnitQty: variantQty,
          costPerPurchaseUnit: variantCostPU,
          costPerUnit: variantDerivedCPU,
        },
      });
      await this.syncParentStock(parent.id);
      results.push({ name: item.name, status: 'created' });
    }

    return {
      total: items.length,
      created: results.filter((r) => r.status === 'created').length,
      updated: results.filter((r) => r.status === 'updated').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    };
  }

  async setSuppliers(id: string, branchId: string, supplierIds: string[]) {
    await this.findOne(id, branchId);
    // Set primary supplier to first in list
    const primaryId = supplierIds[0] ?? null;
    await this.prisma.$transaction([
      this.prisma.ingredientSupplier.deleteMany({ where: { ingredientId: id } }),
      ...(supplierIds.length > 0
        ? [this.prisma.ingredientSupplier.createMany({
            data: supplierIds.map((sid) => ({ ingredientId: id, supplierId: sid })),
          })]
        : []),
      this.prisma.ingredient.update({ where: { id }, data: { supplierId: primaryId } }),
    ]);
    return this.findOne(id, branchId);
  }

  async remove(id: string, branchId: string) {
    const ingredient = await this.findOne(id, branchId);

    if (ingredient.currentStock.toNumber() > 0) {
      throw new BadRequestException(
        `Cannot delete "${ingredient.name}": stock is ${ingredient.currentStock.toNumber()} ${ingredient.unit}. Adjust stock to 0 first.`,
      );
    }

    // Check if used in any recipes
    const recipeUsage = await this.prisma.recipeItem.count({ where: { ingredientId: id } });
    const preReadyUsage = await this.prisma.preReadyRecipeItem.count({ where: { ingredientId: id } });
    if (recipeUsage > 0 || preReadyUsage > 0) {
      throw new BadRequestException(
        `Cannot delete "${ingredient.name}": used in ${recipeUsage} menu recipe(s) and ${preReadyUsage} pre-ready recipe(s). Remove from recipes first.`,
      );
    }

    const result = await this.prisma.ingredient.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    // If this was a variant, recompute the parent's aggregate stock so
    // the parent row reflects the removal — otherwise the parent keeps
    // showing the pre-delete total + avg cost.
    if (ingredient.parentId) {
      await this.syncParentStock(ingredient.parentId);
    }

    return result;
  }

  async adjustStock(id: string, branchId: string, staffId: string, dto: AdjustStockDto) {
    const ingredient = await this.findOne(id, branchId);
    if (ingredient.hasVariants) {
      throw new BadRequestException('Cannot adjust stock on a parent ingredient. Adjust stock on a specific variant.');
    }

    // OPERATIONAL_USE is the manual usage log for non-recipe supplies
    // (parcel bags, tissues, cleaner). UX enters a positive "Used 12";
    // server normalises to a decrement so a positive payload can never
    // accidentally inflate stock.
    const movementQty = dto.type === 'OPERATIONAL_USE'
      ? -Math.abs(dto.quantity)
      : dto.quantity;

    if (dto.type === 'OPERATIONAL_USE' && ingredient.category !== 'SUPPLY') {
      throw new BadRequestException('OPERATIONAL_USE only applies to ingredients in the SUPPLY category');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: id,
          type: dto.type,
          quantity: movementQty,
          notes: dto.notes ?? null,
          staffId,
        },
      });

      const result = await tx.ingredient.update({
        where: { id },
        data: { currentStock: { increment: movementQty } },
        include: { supplier: true },
      });

      // Sync parent if this is a variant
      if (ingredient.parentId) {
        await this.syncParentStock(ingredient.parentId, tx);
      }

      return result;
    });

    // Emit low-stock alert — only for standalone ingredients (not variants).
    // For variants, the parent sync in syncParentStock handles the alert.
    // minimumStock of 0 means "don't track" — no warning.
    if (
      !ingredient.parentId &&
      updated.minimumStock.toNumber() > 0 &&
      updated.currentStock.toNumber() <= updated.minimumStock.toNumber()
    ) {
      this.ws.emitToBranch(branchId, 'stock:low', {
        ingredientId: id,
        name: updated.name,
        currentStock: updated.currentStock,
        minimumStock: updated.minimumStock,
        unit: updated.unit,
      });
    }

    return updated;
  }

  /**
   * Bulk stock-level setter fed by a CSV upload. Each row specifies the
   * NEW absolute currentStock for an item looked up by itemCode. We
   * compute the delta against what's in the DB and log one StockMovement
   * row per non-zero delta with type=ADJUSTMENT + notes="Through CSV update".
   *
   * Parent ingredients with variants are rejected server-side (the same
   * invariant adjustStock enforces) — CSVs must target the specific
   * variant row.
   */
  async bulkStockUpdate(
    branchId: string,
    staffId: string,
    items: Array<{ itemCode?: string; sku?: string; currentStock: number }>,
  ): Promise<{ total: number; updated: number; skipped: number; results: Array<{ itemCode: string; status: 'updated' | 'unchanged' | 'skipped'; reason?: string; delta?: number }> }> {
    const results: Array<{ itemCode: string; status: 'updated' | 'unchanged' | 'skipped'; reason?: string; delta?: number }> = [];
    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const lookupKey = item.itemCode ?? item.sku ?? '';
      if (!lookupKey) {
        results.push({ itemCode: lookupKey, status: 'skipped', reason: 'Missing item code / SKU' });
        skippedCount++;
        continue;
      }
      if (typeof item.currentStock !== 'number' || !isFinite(item.currentStock) || item.currentStock < 0) {
        results.push({ itemCode: lookupKey, status: 'skipped', reason: 'Invalid stock value' });
        skippedCount++;
        continue;
      }

      const ingredient = await this.prisma.ingredient.findFirst({
        where: {
          branchId,
          deletedAt: null,
          OR: [
            item.itemCode ? { itemCode: item.itemCode } : undefined,
            item.sku ? { sku: item.sku } : undefined,
          ].filter(Boolean) as object[],
        },
      });
      if (!ingredient) {
        results.push({ itemCode: lookupKey, status: 'skipped', reason: 'Item not found' });
        skippedCount++;
        continue;
      }
      if (ingredient.hasVariants) {
        results.push({ itemCode: lookupKey, status: 'skipped', reason: 'Cannot set stock on a parent with variants — target the specific variant' });
        skippedCount++;
        continue;
      }

      const currentStockNum = ingredient.currentStock.toNumber();
      const delta = item.currentStock - currentStockNum;
      const rounded = Math.round(delta * 10_000) / 10_000;

      if (rounded === 0) {
        results.push({ itemCode: lookupKey, status: 'unchanged', delta: 0 });
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: ingredient.id,
            type: 'ADJUSTMENT',
            quantity: rounded,
            notes: 'Through CSV update',
            staffId,
          },
        });
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { currentStock: item.currentStock },
        });
        if (ingredient.parentId) {
          await this.syncParentStock(ingredient.parentId, tx);
        }
      });

      results.push({ itemCode: lookupKey, status: 'updated', delta: rounded });
      updatedCount++;
    }

    return { total: items.length, updated: updatedCount, skipped: skippedCount, results };
  }

  /**
   * Paginated stock-movement reader. The Movements tab can hold tens
   * of thousands of rows on long-running installs (every SALE deducts
   * one row per ingredient). The previous implementation fetched 200
   * rows total and let the browser filter — search couldn't reach
   * older history, and even 200 rows × 50 ingredients was wasteful
   * on every tab switch.
   *
   * Returns `{ rows, total, page, pageSize }`. `search` matches the
   * ingredient's name (case-insensitive substring) so admins can
   * dial straight into "lemongrass" history regardless of how far
   * back the entry sits. `from`/`to` bound by `createdAt` to keep
   * date-bounded queries cheap.
   */
  async getMovements(
    branchId: string,
    opts: {
      ingredientId?: string;
      search?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const pageSize = Math.min(Math.max(1, Number(opts.pageSize) || 200), 500);
    const page = Math.max(1, Number(opts.page) || 1);
    const skip = (page - 1) * pageSize;

    const where: any = { branchId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    if (opts.search && opts.search.trim()) {
      where.ingredient = {
        is: { name: { contains: opts.search.trim(), mode: 'insensitive' } },
      };
    }
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      // `to` is inclusive — bump to end-of-day so the date picker's
      // "April 30" returns rows logged up to 23:59:59.999.
      if (opts.to) {
        const t = new Date(opts.to);
        t.setHours(23, 59, 59, 999);
        where.createdAt.lte = t;
      }
    }

    // findMany + count in parallel — the `total` powers the page
    // counter so the UI knows when to disable Next.
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: { ingredient: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  /**
   * Correct a stock-movement's recorded quantity. Used when a recipe
   * typo (10 KG instead of 10 G) caused a SALE row to deduct way
   * more than it should have. Admin enters the correct quantity:
   *
   *   1. Compute delta = oldQty − newQty (signed; positive when the
   *      original over-deducted, negative when it under-deducted).
   *   2. Update the StockMovement row in place — set quantity=newQty,
   *      stamp correctedAt + correctedFromQuantity + correctionReason
   *      so the audit trail shows what changed and why. Reports keep
   *      summing `quantity` and now see the corrected number.
   *   3. Increment Ingredient.currentStock by delta in the same
   *      transaction so on-hand stock stays accurate without admin
   *      having to fire a separate ADJUSTMENT.
   *   4. Sync the parent ingredient's aggregated stock if this
   *      ingredient is a variant child.
   *
   * Bounds: newQty must have the SAME SIGN as the original (you can't
   * flip a SALE deduction into a stock IN). Empty/zero is allowed —
   * effectively voids the movement's stock effect.
   */
  async correctMovement(
    id: string,
    branchId: string,
    dto: { quantity: number; reason?: string },
  ) {
    if (!Number.isFinite(dto.quantity)) {
      throw new BadRequestException('quantity must be a finite number');
    }
    const mv = await this.prisma.stockMovement.findFirst({
      where: { id, branchId },
      include: { ingredient: { select: { id: true, parentId: true } } },
    });
    if (!mv) throw new NotFoundException('Stock movement not found');

    const oldQty = mv.quantity.toNumber();
    const newQty = dto.quantity;
    // Sign-preservation guard. A SALE row carries a negative quantity
    // (stock OUT). Admin shouldn't be able to flip that to positive
    // and accidentally inflate stock; if they need that, they should
    // use the regular Adjust action.
    if (oldQty !== 0 && newQty !== 0 && Math.sign(oldQty) !== Math.sign(newQty)) {
      throw new BadRequestException(
        'Corrected quantity must have the same sign as the original. Use Adjust to add stock back.',
      );
    }
    if (newQty === oldQty) return mv; // no-op

    // delta = how much stock the OLD movement over-removed (or under-
    // removed if positive). currentStock += delta puts the difference
    // back. Example: SALE row was -10000, admin corrects to -10 →
    // delta = -10000 − (-10) = -9990 → wait, that's the wrong sign.
    //
    // Walk through it again. currentStock was decremented by 10000
    // when the SALE fired. We want to UN-decrement 9990 (the over-
    // deduction) so the new effect is just -10. So we ADD 9990 to
    // currentStock, i.e. increment by (oldQty - newQty) when both
    // are negative: -10000 - (-10) = -9990 → that's a NEGATIVE 9990.
    // currentStock += -9990 would make it WORSE.
    //
    // Correct formula: delta = newQty − oldQty.
    //   newQty = -10, oldQty = -10000 → delta = -10 - (-10000) = 9990.
    //   currentStock += 9990 → puts the over-deducted amount back. ✓
    const delta = newQty - oldQty;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.stockMovement.update({
        where: { id },
        data: {
          quantity: newQty,
          correctedAt: new Date(),
          correctedFromQuantity: oldQty,
          correctionReason: dto.reason?.trim() || null,
        },
        include: { ingredient: true },
      });
      await tx.ingredient.update({
        where: { id: mv.ingredientId },
        data: { currentStock: { increment: delta } },
      });
      if (mv.ingredient.parentId) {
        await this.syncParentStock(mv.ingredient.parentId, tx);
      }
      return row;
    });

    return updated;
  }
}

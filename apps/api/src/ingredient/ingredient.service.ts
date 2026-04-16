import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateIngredientDto, UpdateIngredientDto, AdjustStockDto, CreateVariantDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';

@Injectable()
export class IngredientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RestoraPosGateway,
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

    return this.prisma.ingredient.create({
      data: {
        branchId,
        parentId,
        name: `${parent.name} — ${dto.brandName}`,
        brandName: dto.brandName,
        packSize: dto.packSize ?? null,
        piecesPerPack: dto.piecesPerPack ?? null,
        sku: dto.sku ?? null,
        // Always inherit unit + purchaseUnit from parent
        unit: parent.unit,
        category: parent.category,
        purchaseUnit: parent.purchaseUnit,
        purchaseUnitQty: dto.piecesPerPack ?? (parent.purchaseUnitQty?.toNumber() ?? 1),
        costPerPurchaseUnit: dto.costPerPurchaseUnit ?? 0,
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

    let totalStock = 0;
    let totalValue = 0;
    for (const v of variants) {
      const stock = Number(v.currentStock);
      totalStock += stock;
      totalValue += stock * Number(v.costPerUnit);
    }
    const avgCost = totalStock > 0 ? totalValue / totalStock : (variants[0] ? Number(variants[0].costPerUnit) : 0);

    const parent = await db.ingredient.update({
      where: { id: parentId },
      data: { currentStock: totalStock, costPerUnit: avgCost },
    });

    // Emit low-stock alert based on parent aggregate vs parent minimumStock
    if (totalStock <= Number(parent.minimumStock)) {
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

    return this.prisma.ingredient.create({
      data: {
        branchId,
        name: dto.name,
        unit: dto.unit,
        purchaseUnit: dto.purchaseUnit ?? null,
        purchaseUnitQty: dto.purchaseUnitQty ?? 1,
        minimumStock: dto.minimumStock ?? 0,
        costPerUnit: dto.costPerUnit ?? 0,
        costPerPurchaseUnit: dto.costPerPurchaseUnit ?? 0,
        supplierId: dto.supplierId ?? null,
        itemCode: dto.itemCode ?? null,
        category: (dto.category ?? 'RAW') as any,
      },
      include: this.ingredientInclude,
    });
  }

  async update(id: string, branchId: string, dto: UpdateIngredientDto & { brandName?: string; packSize?: string | null; piecesPerPack?: number | null; sku?: string | null }) {
    await this.findOne(id, branchId);
    return this.prisma.ingredient.update({
      where: { id },
      data: {
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
        // Variant-specific fields
        ...(dto.brandName !== undefined ? { brandName: dto.brandName } : {}),
        ...(dto.packSize !== undefined ? { packSize: dto.packSize } : {}),
        ...(dto.piecesPerPack !== undefined ? { piecesPerPack: dto.piecesPerPack } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        // Website display fields
        ...((dto as any).imageUrl !== undefined ? { imageUrl: (dto as any).imageUrl } : {}),
        ...((dto as any).showOnWebsite !== undefined ? { showOnWebsite: (dto as any).showOnWebsite } : {}),
      },
      include: this.ingredientInclude,
    });
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
    const referencedParentCodes = new Set(
      items.map((r) => r.parentCode?.trim()).filter((c): c is string => !!c),
    );

    const parentRows = items.filter((r) => !r.parentCode?.trim());
    const variantRows = items.filter((r) => !!r.parentCode?.trim());

    // Map of itemCode -> ingredientId for variant linking
    const parentByCode = new Map<string, string>();

    // Prime map with existing ingredients in this branch (so variants can
    // attach to ingredients that were imported in a previous run).
    const existingWithCodes = await this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null, itemCode: { not: null } },
      select: { id: true, itemCode: true },
    });
    for (const e of existingWithCodes) {
      if (e.itemCode) parentByCode.set(e.itemCode, e.id);
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
      const shouldBeParent = !!item.itemCode && referencedParentCodes.has(item.itemCode.trim());

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
        // Expose itemCode already on the row so variants can still attach
        if (existing.itemCode) parentByCode.set(existing.itemCode, existing.id);
        results.push({ name: item.name, status: 'updated' });
        continue;
      }

      const created = await this.prisma.ingredient.create({
        data: {
          branchId,
          name: item.name.trim(),
          unit: (item.unit ?? 'PCS') as any,
          category: (item.category ?? 'RAW') as any,
          itemCode: item.itemCode ?? null,
          minimumStock: item.minimumStock ?? 0,
          costPerUnit: item.costPerUnit ?? 0,
          purchaseUnit: item.purchaseUnit ?? null,
          purchaseUnitQty: item.purchaseUnitQty ?? 1,
          costPerPurchaseUnit: item.costPerPurchaseUnit ?? 0,
          hasVariants: shouldBeParent,
        },
      });
      if (item.itemCode) parentByCode.set(item.itemCode.trim(), created.id);
      results.push({ name: item.name, status: 'created' });
    }

    // ─── Pass 2: variants ───────────────────────────────────────────────
    for (const item of variantRows) {
      if (!item.name?.trim()) {
        results.push({ name: item.name ?? '', status: 'skipped', reason: 'Empty name' });
        continue;
      }
      const parentCode = item.parentCode!.trim();
      const parentId = parentByCode.get(parentCode);
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
            ...(item.costPerUnit !== undefined ? { costPerUnit: item.costPerUnit } : {}),
          },
        });
        results.push({ name: item.name, status: 'updated' });
        continue;
      }

      await this.prisma.ingredient.create({
        data: {
          branchId,
          parentId: parent.id,
          name: displayName,
          brandName,
          packSize: item.packSize ?? null,
          piecesPerPack: item.piecesPerPack ?? null,
          sku: item.sku ?? null,
          unit: parent.unit,
          category: parent.category,
          purchaseUnit: parent.purchaseUnit,
          purchaseUnitQty: item.piecesPerPack ?? (parent.purchaseUnitQty?.toNumber() ?? 1),
          costPerPurchaseUnit: item.costPerPurchaseUnit ?? 0,
          costPerUnit: item.costPerUnit ?? 0,
        },
      });
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

    return this.prisma.ingredient.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async adjustStock(id: string, branchId: string, staffId: string, dto: AdjustStockDto) {
    const ingredient = await this.findOne(id, branchId);
    if (ingredient.hasVariants) {
      throw new BadRequestException('Cannot adjust stock on a parent ingredient. Adjust stock on a specific variant.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: id,
          type: dto.type,
          quantity: dto.quantity,
          notes: dto.notes ?? null,
          staffId,
        },
      });

      const result = await tx.ingredient.update({
        where: { id },
        data: { currentStock: { increment: dto.quantity } },
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
    if (!ingredient.parentId && updated.currentStock.toNumber() <= updated.minimumStock.toNumber()) {
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

  async getMovements(branchId: string, ingredientId?: string) {
    return this.prisma.stockMovement.findMany({
      where: {
        branchId,
        ...(ingredientId ? { ingredientId } : {}),
      },
      include: { ingredient: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

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
      },
      include: this.ingredientInclude,
    });
  }

  async bulkCreate(branchId: string, items: { name: string; unit?: string; category?: string; itemCode?: string; minimumStock?: number; costPerUnit?: number; purchaseUnit?: string; purchaseUnitQty?: number; costPerPurchaseUnit?: number }[]) {
    const results: { name: string; status: 'created' | 'skipped'; reason?: string }[] = [];

    for (const item of items) {
      if (!item.name?.trim()) {
        results.push({ name: item.name ?? '', status: 'skipped', reason: 'Empty name' });
        continue;
      }

      const existing = await this.prisma.ingredient.findFirst({
        where: { branchId, name: item.name.trim(), deletedAt: null },
      });

      if (existing) {
        results.push({ name: item.name, status: 'skipped', reason: 'Already exists' });
        continue;
      }

      await this.prisma.ingredient.create({
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
        },
      });
      results.push({ name: item.name, status: 'created' });
    }

    return { total: items.length, created: results.filter((r) => r.status === 'created').length, skipped: results.filter((r) => r.status === 'skipped').length, results };
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

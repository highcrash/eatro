import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CreateIngredientDto, UpdateIngredientDto, AdjustStockDto } from '@restora/types';
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
  };

  findAll(branchId: string) {
    return this.prisma.ingredient.findMany({
      where: { branchId, deletedAt: null },
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

  async update(id: string, branchId: string, dto: UpdateIngredientDto) {
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
    await this.findOne(id, branchId);

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

      return tx.ingredient.update({
        where: { id },
        data: { currentStock: { increment: dto.quantity } },
        include: { supplier: true },
      });
    });

    // Emit low-stock alert if needed
    if (updated.currentStock.toNumber() <= updated.minimumStock.toNumber()) {
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

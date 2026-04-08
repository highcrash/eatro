import { Injectable } from '@nestjs/common';
import type { CreateWasteLogDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { RestoraPosGateway } from '../ws-gateway/restora-pos.gateway';

@Injectable()
export class WasteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RestoraPosGateway,
  ) {}

  findAll(branchId: string, ingredientId?: string) {
    return this.prisma.wasteLog.findMany({
      where: {
        branchId,
        ...(ingredientId ? { ingredientId } : {}),
      },
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async create(branchId: string, staffId: string, dto: CreateWasteLogDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const wasteLog = await tx.wasteLog.create({
        data: {
          branchId,
          ingredientId: dto.ingredientId,
          quantity: dto.quantity,
          reason: dto.reason,
          notes: dto.notes ?? null,
          recordedById: staffId,
        },
        include: {
          ingredient: { select: { id: true, name: true, unit: true } },
          recordedBy: { select: { id: true, name: true } },
        },
      });

      const ingredient = await tx.ingredient.update({
        where: { id: dto.ingredientId },
        data: { currentStock: { decrement: dto.quantity } },
      });

      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: dto.ingredientId,
          type: 'WASTE',
          quantity: -dto.quantity,
          staffId,
          notes: `Waste: ${dto.reason}${dto.notes ? ` — ${dto.notes}` : ''}`,
        },
      });

      return { wasteLog, ingredient };
    });

    // Emit low-stock alert if needed
    if (result.ingredient.currentStock.toNumber() <= result.ingredient.minimumStock.toNumber()) {
      this.ws.emitToBranch(branchId, 'stock:low', {
        ingredientId: dto.ingredientId,
        name: result.ingredient.name,
        currentStock: result.ingredient.currentStock,
        minimumStock: result.ingredient.minimumStock,
        unit: result.ingredient.unit,
      });
    }

    return result.wasteLog;
  }

  async logMenuItemWaste(branchId: string, staffId: string, menuItemId: string, quantity: number, reason: string, notes?: string) {
    // Find recipe for this menu item
    const recipe = await this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: true } } },
    });
    if (!recipe || recipe.items.length === 0) return [];

    const logs = [];
    for (const recipeItem of recipe.items) {
      const wasteQty = recipeItem.quantity.toNumber() * quantity;
      const log = await this.create(branchId, staffId, {
        ingredientId: recipeItem.ingredientId,
        quantity: wasteQty,
        reason: reason as any,
        notes: notes ?? `Menu waste: ${quantity}× menu item`,
      });
      logs.push(log);
    }
    return logs;
  }
}

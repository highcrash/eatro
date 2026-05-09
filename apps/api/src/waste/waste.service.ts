import { Injectable } from '@nestjs/common';
import type { CreateWasteLogDto } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../ws-gateway/realtime.gateway';
import { IngredientService } from '../ingredient/ingredient.service';

@Injectable()
export class WasteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ws: RealtimeGateway,
    private readonly ingredientService: IngredientService,
  ) {}

  /**
   * Date-ranged waste log with valuation. Each row gets:
   *   - quantity (existing)
   *   - unitCostPaisa: looked up via the paired StockMovement (type
   *     WASTE) created in the same transaction. Falls back to current
   *     `Ingredient.costPerUnit` when the StockMovement is from
   *     before the unitCostPaisa migration (pre-2026-05-08) and the
   *     value is null.
   *   - valuePaisa: quantity × unitCostPaisa, the money value of
   *     this waste row.
   * Plus a `summary` block with totals so the admin Waste Log page
   * can render headline tiles (qty + value) without re-summing.
   */
  async findAll(
    branchId: string,
    opts: { ingredientId?: string; from?: string; to?: string } = {},
  ) {
    const { ingredientId, from, to } = opts;
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) {
      const f = new Date(from);
      f.setHours(0, 0, 0, 0);
      dateFilter.gte = f;
    }
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      dateFilter.lte = t;
    }

    const logs = await this.prisma.wasteLog.findMany({
      where: {
        branchId,
        ...(ingredientId ? { ingredientId } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      include: {
        ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: from || to ? 1000 : 200,
    });

    if (logs.length === 0) {
      return {
        rows: [],
        summary: {
          rowCount: 0,
          totalQty: 0,
          totalValuePaisa: 0,
          byIngredient: [] as Array<{ ingredientId: string; ingredientName: string; unit: string; qty: number; valuePaisa: number }>,
          byReason: [] as Array<{ reason: string; rowCount: number; qty: number; valuePaisa: number }>,
        },
      };
    }

    // Pull the paired WASTE StockMovements for this ingredient set in
    // the same date window so we can read the cost stamped at write
    // time. Match each WasteLog to a StockMovement by (ingredientId,
    // |quantity|, createdAt within ±5s) — same heuristic the Stock
    // Watcher report uses.
    const ingIds = Array.from(new Set(logs.map((l) => l.ingredientId)));
    const minTime = new Date(logs[logs.length - 1].createdAt.getTime() - 10_000);
    const maxTime = new Date(logs[0].createdAt.getTime() + 10_000);
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        branchId,
        ingredientId: { in: ingIds },
        type: 'WASTE',
        createdAt: { gte: minTime, lte: maxTime },
      },
      select: { id: true, ingredientId: true, quantity: true, unitCostPaisa: true, createdAt: true },
    });

    const movementMatched = new Set<string>();
    const findCost = (logRow: { ingredientId: string; quantity: { toNumber(): number }; createdAt: Date; ingredient: { costPerUnit: { toNumber(): number } } }): { unitCostPaisa: number; isApprox: boolean } => {
      const targetTime = logRow.createdAt.getTime();
      const targetQty = Math.abs(Number(logRow.quantity));
      const m = movements.find(
        (mv) =>
          !movementMatched.has(mv.id) &&
          mv.ingredientId === logRow.ingredientId &&
          Math.abs(mv.createdAt.getTime() - targetTime) < 5000 &&
          Math.abs(Math.abs(Number(mv.quantity)) - targetQty) < 0.0001,
      );
      if (m && m.unitCostPaisa != null) {
        movementMatched.add(m.id);
        return { unitCostPaisa: m.unitCostPaisa.toNumber(), isApprox: false };
      }
      return { unitCostPaisa: logRow.ingredient.costPerUnit.toNumber(), isApprox: true };
    };

    let totalQty = 0;
    let totalValue = 0;
    const byIngredient = new Map<string, { ingredientId: string; ingredientName: string; unit: string; qty: number; valuePaisa: number }>();
    const byReason = new Map<string, { reason: string; rowCount: number; qty: number; valuePaisa: number }>();

    const rows = logs.map((l) => {
      const { unitCostPaisa, isApprox } = findCost(l);
      const qty = Number(l.quantity);
      const valuePaisa = Math.round(qty * unitCostPaisa);
      totalQty += qty;
      totalValue += valuePaisa;

      const ingKey = l.ingredientId;
      const ingAgg = byIngredient.get(ingKey) ?? {
        ingredientId: l.ingredientId,
        ingredientName: l.ingredient.name,
        unit: l.ingredient.unit,
        qty: 0,
        valuePaisa: 0,
      };
      ingAgg.qty += qty;
      ingAgg.valuePaisa += valuePaisa;
      byIngredient.set(ingKey, ingAgg);

      const reasonKey = String(l.reason);
      const reasonAgg = byReason.get(reasonKey) ?? { reason: reasonKey, rowCount: 0, qty: 0, valuePaisa: 0 };
      reasonAgg.rowCount += 1;
      reasonAgg.qty += qty;
      reasonAgg.valuePaisa += valuePaisa;
      byReason.set(reasonKey, reasonAgg);

      return {
        id: l.id,
        ingredientId: l.ingredientId,
        ingredient: { id: l.ingredient.id, name: l.ingredient.name, unit: l.ingredient.unit },
        quantity: qty,
        unitCostPaisa,
        valuePaisa,
        isApprox,
        reason: l.reason,
        notes: l.notes,
        recordedBy: l.recordedBy,
        createdAt: l.createdAt,
      };
    });

    return {
      rows,
      summary: {
        rowCount: logs.length,
        totalQty,
        totalValuePaisa: totalValue,
        byIngredient: Array.from(byIngredient.values()).sort((a, b) => b.valuePaisa - a.valuePaisa),
        byReason: Array.from(byReason.values()).sort((a, b) => b.valuePaisa - a.valuePaisa),
      },
    };
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
          // Per-stock-unit cost AT TIME OF WASTE — preserved on the
          // movement so the Stock Watcher report values waste rows
          // historically. Read post-decrement is fine: costPerUnit
          // is unaffected by the stock decrement, only currentStock.
          unitCostPaisa: ingredient.costPerUnit.toNumber(),
        },
      });

      return { wasteLog, ingredient };
    });

    // Sync parent if this is a variant
    if (result.ingredient.parentId) {
      await this.ingredientService.syncParentStock(result.ingredient.parentId);
    }

    // Emit low-stock alert if needed. minimumStock of 0 means "don't track".
    if (
      result.ingredient.minimumStock.toNumber() > 0 &&
      result.ingredient.currentStock.toNumber() <= result.ingredient.minimumStock.toNumber()
    ) {
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

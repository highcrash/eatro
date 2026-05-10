import { Injectable, BadRequestException } from '@nestjs/common';
import type {
  ReconciliationSheet,
  ReconciliationSheetRow,
  ReconciliationSubmitDto,
  ReconciliationSubmitResult,
  ReconciliationRowResult,
  WasteReason,
} from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';
import { WasteService } from '../waste/waste.service';
import { IngredientService } from '../ingredient/ingredient.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { JwtPayload } from '@restora/types';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wasteService: WasteService,
    private readonly ingredientService: IngredientService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Build the print-and-count sheet payload. Returns every COUNTABLE
   * ingredient (standalone + variants — parents are excluded because
   * parent stock is the rolled-up sum of variants, never counted
   * directly), pre-flagged with whether it had any StockMovement
   * inside the requested window. The frontend uses that flag to push
   * dormant items to the bottom of the printed sheet so the human
   * counter sweeps the active bins first.
   */
  async buildSheet(branchId: string, windowDays: number): Promise<ReconciliationSheet> {
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        branchId,
        deletedAt: null,
        isActive: true,
        // Skip parent rows — they're the aggregate, not a physical bin.
        // Standalone rows (no variants, no parent) are counted directly.
        hasVariants: false,
      },
      include: {
        parent: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const lastMovementByIngredientId = await this.lastMovementMap(
      branchId,
      ingredients.map((i) => i.id),
    );

    const cutoff = Date.now() - Math.max(1, windowDays) * DAY_MS;

    const rows: ReconciliationSheetRow[] = ingredients.map((i) => {
      const lastMovedAt = lastMovementByIngredientId.get(i.id) ?? null;
      return {
        ingredientId: i.id,
        name: i.name,
        unit: i.unit,
        category: i.category ?? null,
        parentName: i.parent?.name ?? null,
        isVariant: i.parentId != null,
        currentStock: i.currentStock.toNumber(),
        costPerUnit: i.costPerUnit.toNumber(),
        lastMovementAt: lastMovedAt ? lastMovedAt.toISOString() : null,
        hasRecentMovement: lastMovedAt != null && lastMovedAt.getTime() >= cutoff,
      };
    });

    // Recent first, then alphabetical inside each bucket. The frontend
    // can re-bucket by category if the user picks the categorised view.
    rows.sort((a, b) => {
      if (a.hasRecentMovement !== b.hasRecentMovement) {
        return a.hasRecentMovement ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      generatedAt: new Date().toISOString(),
      movementWindowDays: windowDays,
      rows,
    };
  }

  /**
   * Apply a stocktake: for each row, diff physical against the live
   * currentStock and route to WasteService (negative delta) or
   * IngredientService.adjustStock (positive). Each row's write runs
   * in its own transaction so a partial failure leaves earlier
   * successful rows committed — the user can re-submit just the
   * failed rows instead of starting over.
   *
   * Writes a single ActivityLog entry summarising the run; does NOT
   * write per-row activity entries (would flood the audit feed).
   */
  async submit(
    user: JwtPayload,
    dto: ReconciliationSubmitDto,
  ): Promise<ReconciliationSubmitResult> {
    if (!Array.isArray(dto.rows) || dto.rows.length === 0) {
      throw new BadRequestException('At least one row is required');
    }

    const ids = Array.from(new Set(dto.rows.map((r) => r.ingredientId)));
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ids }, branchId: user.branchId, deletedAt: null },
      select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true, hasVariants: true },
    });
    const ingById = new Map(ingredients.map((i) => [i.id, i] as const));

    const noteSuffix = dto.notes ? ` — ${dto.notes}` : '';
    const results: ReconciliationRowResult[] = [];

    for (const row of dto.rows) {
      const ing = ingById.get(row.ingredientId);
      if (!ing) {
        results.push({
          ingredientId: row.ingredientId,
          ingredientName: '(unknown)',
          unit: '',
          before: 0,
          after: 0,
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: 'Ingredient not found in this branch',
        });
        continue;
      }
      if (ing.hasVariants) {
        results.push({
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          before: ing.currentStock.toNumber(),
          after: ing.currentStock.toNumber(),
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: 'Cannot reconcile a parent ingredient — count its variants directly',
        });
        continue;
      }

      const before = ing.currentStock.toNumber();
      const physical = Number(row.physicalQty);
      if (!Number.isFinite(physical) || physical < 0) {
        results.push({
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          before,
          after: before,
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: 'Physical count must be a non-negative number',
        });
        continue;
      }

      const delta = round4(physical - before);
      const unitCost = ing.costPerUnit.toNumber();

      if (Math.abs(delta) < 0.0001) {
        results.push({
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          before,
          after: before,
          delta: 0,
          outcome: 'skipped',
          valuePaisa: 0,
        });
        continue;
      }

      try {
        if (delta < 0) {
          await this.wasteService.create(user.branchId, user.sub, {
            ingredientId: ing.id,
            quantity: Math.abs(delta),
            reason: row.reason as WasteReason,
            notes: `Reconciliation${noteSuffix}`,
          });
          results.push({
            ingredientId: ing.id,
            ingredientName: ing.name,
            unit: ing.unit,
            before,
            after: round4(before + delta),
            delta,
            outcome: 'waste',
            valuePaisa: Math.round(Math.abs(delta) * unitCost),
          });
        } else {
          await this.ingredientService.adjustStock(ing.id, user.branchId, user.sub, {
            quantity: delta,
            type: 'ADJUSTMENT',
            notes: `Reconciliation${noteSuffix}`,
          });
          results.push({
            ingredientId: ing.id,
            ingredientName: ing.name,
            unit: ing.unit,
            before,
            after: round4(before + delta),
            delta,
            outcome: 'adjustment',
            valuePaisa: Math.round(delta * unitCost),
          });
        }
      } catch (err) {
        results.push({
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          before,
          after: before,
          delta: 0,
          outcome: 'failed',
          valuePaisa: 0,
          error: (err as Error).message,
        });
      }
    }

    const summary = this.summarise(results);

    void this.activityLog.log({
      branchId: user.branchId,
      actor: user,
      category: 'INGREDIENT',
      action: 'UPDATE',
      entityType: 'reconciliation',
      entityId: `reconcile-${new Date().toISOString()}`,
      entityName: dto.notes?.trim() || 'Stocktake',
      summary: `Stocktake: ${summary.wasteRows} waste, ${summary.adjustmentRows} adjustments, ${summary.skippedRows} matched, ${summary.failedRows} failed`,
      after: {
        notes: dto.notes ?? null,
        ...summary,
      },
    });

    return summary;
  }

  /**
   * Group-by query that returns the timestamp of the most recent
   * StockMovement per ingredient, scoped to the branch and the set
   * of ingredientIds passed in. Returns a Map for cheap lookup at
   * the row-build step.
   */
  private async lastMovementMap(branchId: string, ingredientIds: string[]): Promise<Map<string, Date>> {
    if (ingredientIds.length === 0) return new Map();
    const rows = await this.prisma.stockMovement.groupBy({
      by: ['ingredientId'],
      where: { branchId, ingredientId: { in: ingredientIds } },
      _max: { createdAt: true },
    });
    const out = new Map<string, Date>();
    for (const r of rows) {
      if (r._max.createdAt) out.set(r.ingredientId, r._max.createdAt);
    }
    return out;
  }

  private summarise(rows: ReconciliationRowResult[]): ReconciliationSubmitResult {
    let wasteRows = 0;
    let adjustmentRows = 0;
    let skippedRows = 0;
    let failedRows = 0;
    let totalQtyDown = 0;
    let totalQtyUp = 0;
    let valuePaisaDown = 0;
    let valuePaisaUp = 0;
    for (const r of rows) {
      if (r.outcome === 'waste') {
        wasteRows += 1;
        totalQtyDown += Math.abs(r.delta);
        valuePaisaDown += r.valuePaisa;
      } else if (r.outcome === 'adjustment') {
        adjustmentRows += 1;
        totalQtyUp += r.delta;
        valuePaisaUp += r.valuePaisa;
      } else if (r.outcome === 'skipped') {
        skippedRows += 1;
      } else {
        failedRows += 1;
      }
    }
    return {
      countedRows: rows.length,
      wasteRows,
      adjustmentRows,
      skippedRows,
      failedRows,
      totalQtyDown: round4(totalQtyDown),
      totalQtyUp: round4(totalQtyUp),
      valuePaisaDown,
      valuePaisaUp,
      rows,
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

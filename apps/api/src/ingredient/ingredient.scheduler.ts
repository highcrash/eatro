import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { IngredientService } from './ingredient.service';

/**
 * Nightly auto-recompute of every branch's ingredient minimumStock
 * from the previous N days of consumption (where N = the branch's
 * autoMinStockDays setting). Runs at 3 AM local — same slot as the
 * ActivityLogScheduler purge so the late-night quiet window holds
 * both jobs without overlap risk.
 *
 * Branches with autoMinStockDays = 0 (the default) are silently
 * skipped — the recomputeMinimumStock service short-circuits on
 * window <= 0 without touching any rows.
 *
 * Per-branch try/catch keeps one branch's failure from blocking the
 * rest of the fleet. The cron itself can never crash the API.
 */
@Injectable()
export class IngredientScheduler {
  private readonly logger = new Logger(IngredientScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredients: IngredientService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runAutoMinStock() {
    let branches: Array<{ branchId: string }> = [];
    try {
      // Only sweep branches that opted in (autoMinStockDays > 0). The
      // service still re-checks the window itself so an older branch
      // setting that flipped between read + execute can't surprise us.
      branches = await this.prisma.branchSetting.findMany({
        where: { autoMinStockDays: { gt: 0 } } as any,
        select: { branchId: true },
      });
    } catch (err) {
      this.logger.warn(`auto-min-stock cron: branch lookup failed: ${(err as Error).message}`);
      return;
    }
    if (branches.length === 0) return;

    let okCount = 0;
    for (const { branchId } of branches) {
      try {
        const res = await this.ingredients.recomputeMinimumStock(branchId);
        if (res.updated > 0) {
          this.logger.log(
            `auto-min-stock: branch ${branchId} → updated ${res.updated} of ${res.scanned} ingredient(s) (${res.window}-day window, ${res.skipped} unchanged)`,
          );
        }
        okCount++;
      } catch (err) {
        this.logger.warn(`auto-min-stock cron: branch ${branchId} failed: ${(err as Error).message}`);
      }
    }
    if (okCount > 0) {
      this.logger.log(`auto-min-stock cron complete — swept ${okCount}/${branches.length} branch(es)`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TipsoiSyncService } from './tipsoi.sync.service';

/**
 * Hourly Tipsoi attendance pull. Iterates branches with
 * `tipsoiEnabled=true` and a non-empty `tipsoiApiToken`, syncs the
 * trailing 36 hours so overnight clock-outs and late device uploads
 * land before payroll closes the period. Failures are logged + stamped
 * onto BranchSetting.tipsoiLastSyncStatus — never thrown — so a single
 * branch's bad token can't kill the cron loop for the rest.
 */
@Injectable()
export class TipsoiScheduler {
  private readonly logger = new Logger('TipsoiScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: TipsoiSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourlySync(): Promise<void> {
    const branches = await this.prisma.branchSetting.findMany({
      where: { tipsoiEnabled: true, tipsoiApiToken: { not: null } },
      select: { branchId: true },
    });
    if (branches.length === 0) return;

    const to = new Date();
    const from = new Date(to.getTime() - 36 * 60 * 60 * 1000);

    for (const b of branches) {
      try {
        const result = await this.sync.syncRange(b.branchId, from, to);
        this.logger.log(
          `[${b.branchId}] scanned=${result.scanned} created=${result.created} updated=${result.updated} ` +
          `skippedByOverride=${result.skippedByOverride} errors=${result.errors.length}`,
        );
      } catch (e) {
        this.logger.warn(`[${b.branchId}] sync threw: ${(e as Error).message}`);
      }
    }
  }
}

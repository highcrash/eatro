import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const RETENTION_DAYS = 90;

/**
 * Auto-purge old activity-log rows. Runs at 3 AM local time so the work
 * lands in the quietest stretch of the day. Hardcoded retention to keep
 * the table bounded; if the owner wants to extend, they can disable the
 * cron and run the manual purge endpoint with their own knob.
 */
@Injectable()
export class ActivityLogScheduler {
  private readonly log = new Logger(ActivityLogScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldRows() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    try {
      const res = await this.prisma.activityLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (res.count > 0) {
        this.log.log(`activity-log retention: purged ${res.count} row(s) older than ${RETENTION_DAYS}d`);
      }
    } catch (err) {
      this.log.warn(`activity-log retention sweep failed: ${(err as Error).message}`);
    }
  }
}

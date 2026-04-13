import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backupService: BackupService,
  ) {}

  /** Fire every hour on the hour; check whether a backup is due. */
  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    const s = await this.prisma.backupSchedule.findUnique({ where: { id: 'default' } });
    if (!s || s.frequency === 'OFF') return;

    const now = new Date();
    if (now.getHours() !== s.timeHour) return;

    if (s.lastRunAt) {
      const diffMs = now.getTime() - new Date(s.lastRunAt).getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      const thresholds = { DAILY: dayMs - 60_000, WEEKLY: 7 * dayMs - 60_000, MONTHLY: 28 * dayMs - 60_000 };
      const need = thresholds[s.frequency as keyof typeof thresholds];
      if (need && diffMs < need) return;
    }

    try {
      this.logger.log(`Running ${s.frequency} auto-backup...`);
      await this.backupService.createBackup('AUTO');
      await this.prisma.backupSchedule.update({
        where: { id: 'default' },
        data: { lastRunAt: now },
      });
    } catch (e) {
      this.logger.error(`Auto-backup failed: ${(e as Error).message}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';

/**
 * Periodically polls api.sms.net.bd's /report/request/:id endpoint for
 * every SmsLog row that was accepted by the gateway but hasn't settled
 * yet (QUEUED or SENT) and flips the status to DELIVERED / FAILED /
 * EXPIRED based on the response.
 *
 * Cadence: every 2 minutes. Batch of 50 per tick to stay inside the
 * gateway's rate limits and to keep each tick quick.
 */
@Injectable()
export class SmsStatusScheduler {
  private readonly logger = new Logger(SmsStatusScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async poll(): Promise<void> {
    const pending = await this.prisma.smsLog.findMany({
      where: {
        status: { in: ['QUEUED' as never, 'SENT' as never] },
        requestId: { not: null },
        // Don't re-check too aggressively — if we polled in the last minute,
        // skip this tick.
        OR: [
          { lastChecked: null },
          { lastChecked: { lte: new Date(Date.now() - 60_000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (!pending.length) return;
    this.logger.debug(`Polling ${pending.length} pending SMS log(s)`);
    for (const log of pending) {
      try {
        await this.sms.refreshLogStatus(log.id);
      } catch (err) {
        this.logger.warn(`Failed to refresh SMS log ${log.id}: ${(err as Error).message}`);
      }
    }
  }
}

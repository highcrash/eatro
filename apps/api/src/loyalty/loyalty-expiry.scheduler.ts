import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoyaltyService } from './loyalty.service';

/**
 * Daily 03:00 sweep — finds every customer with a non-zero balance
 * whose `loyaltyExpiresAt` has passed and zeros their points with an
 * EXPIRED ledger row. Idempotent — a same-day re-run is a no-op
 * because the expired customers have already been zero'd by the
 * previous run.
 *
 * 03:00 was chosen so the sweep runs after most branches have
 * closed but before the morning shift opens — minimises the chance
 * of a customer trying to redeem points that are about to expire
 * while the cron is running.
 */
@Injectable()
export class LoyaltyExpiryScheduler {
  private readonly logger = new Logger(LoyaltyExpiryScheduler.name);

  constructor(private readonly loyalty: LoyaltyService) {}

  @Cron('0 3 * * *')
  async run() {
    try {
      const result = await this.loyalty.runExpirySweep();
      if (result.expired > 0) {
        this.logger.log(`Loyalty expiry sweep cleared ${result.expired} customer balance(s)`);
      }
    } catch (err) {
      this.logger.error(`Loyalty expiry sweep failed: ${(err as Error).message}`);
    }
  }
}

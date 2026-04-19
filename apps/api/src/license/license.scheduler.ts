import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenseService } from './license.service';

/**
 * Hourly online revalidation. Three jobs:
 *   - keeps the cached verdict's `lastVerifiedAt` fresh (so offline grace
 *     never starts counting down while the machine is online)
 *   - picks up server-side revocations within ~1h
 *   - rolls signing-key kid changes into the local cache before the
 *     30-day retire window closes
 *
 * Failures are logged but never thrown — a transient license-server
 * outage must NEVER bring down a buyer's POS. The localVerdict path
 * keeps the install in 'grace' for up to 7 days while we retry.
 */
@Injectable()
export class LicenseScheduler {
  private readonly logger = new Logger('LicenseScheduler');

  constructor(private readonly license: LicenseService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourlyVerify(): Promise<void> {
    try {
      const v = await this.license.verifyOnline();
      this.logger.log(`hourly verify: ${v.mode} (${v.reason})`);
    } catch (err) {
      this.logger.warn(`hourly verify failed: ${(err as Error).message}`);
    }
  }
}

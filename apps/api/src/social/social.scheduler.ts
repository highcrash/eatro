import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialService } from './social.service';

/**
 * Once-per-minute cron that drains the FB scheduled-post queue.
 *
 * Same pattern as `TipsoiScheduler` — keep the cron handler tiny so
 * deploys can swap the container without losing in-flight work.
 * `runDuePosts` is idempotent (a row already POSTED short-circuits)
 * so a redeploy mid-tick is safe.
 */
@Injectable()
export class SocialScheduler {
  private readonly log = new Logger(SocialScheduler.name);

  constructor(private readonly social: SocialService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      const r = await this.social.runDuePosts();
      if (r.scanned > 0) {
        this.log.log(`tick: scanned=${r.scanned} posted=${r.posted} failed=${r.failed}`);
      }
    } catch (err) {
      this.log.error(`tick failed: ${(err as Error).message}`);
    }
  }
}

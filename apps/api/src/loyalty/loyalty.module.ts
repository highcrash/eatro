import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyExpiryScheduler } from './loyalty-expiry.scheduler';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [ActivityLogModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyExpiryScheduler],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}

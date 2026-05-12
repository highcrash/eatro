import { Module } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [ActivityLogModule, SmsModule],
  controllers: [MarketingController],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingModule {}

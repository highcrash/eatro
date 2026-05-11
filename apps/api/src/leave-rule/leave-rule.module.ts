import { Module } from '@nestjs/common';
import { LeaveRuleService } from './leave-rule.service';
import { LeaveRuleController } from './leave-rule.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [ActivityLogModule],
  controllers: [LeaveRuleController],
  providers: [LeaveRuleService],
  exports: [LeaveRuleService],
})
export class LeaveRuleModule {}

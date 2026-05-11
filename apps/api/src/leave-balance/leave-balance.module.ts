import { Module } from '@nestjs/common';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveBalanceController } from './leave-balance.controller';
import { LeaveAccrualScheduler } from './leave-accrual.scheduler';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [ActivityLogModule],
  controllers: [LeaveBalanceController],
  providers: [LeaveBalanceService, LeaveAccrualScheduler],
  exports: [LeaveBalanceService],
})
export class LeaveBalanceModule {}

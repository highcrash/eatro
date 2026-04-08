import { Module } from '@nestjs/common';
import { WorkPeriodService } from './work-period.service';
import { WorkPeriodController } from './work-period.controller';

@Module({
  controllers: [WorkPeriodController],
  providers: [WorkPeriodService],
})
export class WorkPeriodModule {}

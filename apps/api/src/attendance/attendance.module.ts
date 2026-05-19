import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { TipsoiModule } from '../tipsoi/tipsoi.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TipsoiModule, ActivityLogModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}

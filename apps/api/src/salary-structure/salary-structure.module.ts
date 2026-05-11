import { Module } from '@nestjs/common';
import { SalaryStructureService } from './salary-structure.service';
import { SalaryStructureController } from './salary-structure.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [ActivityLogModule],
  controllers: [SalaryStructureController],
  providers: [SalaryStructureService],
  exports: [SalaryStructureService],
})
export class SalaryStructureModule {}

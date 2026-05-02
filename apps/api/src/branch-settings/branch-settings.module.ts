import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService } from './branch-settings.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [BranchSettingsController],
  providers: [BranchSettingsService],
  exports: [BranchSettingsService],
})
export class BranchSettingsModule {}

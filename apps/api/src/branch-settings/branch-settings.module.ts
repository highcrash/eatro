import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService } from './branch-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [BranchSettingsController],
  providers: [BranchSettingsService],
  exports: [BranchSettingsService],
})
export class BranchSettingsModule {}

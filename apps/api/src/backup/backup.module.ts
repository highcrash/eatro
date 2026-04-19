import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupScheduler } from './backup.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [BackupController],
  providers: [BackupService, BackupScheduler],
  // Exported so UpdaterModule can inject BackupService for pre-apply
  // snapshots + rollback DB restores.
  exports: [BackupService],
})
export class BackupModule {}

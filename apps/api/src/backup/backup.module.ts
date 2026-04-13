import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupScheduler } from './backup.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [BackupController],
  providers: [BackupService, BackupScheduler],
})
export class BackupModule {}

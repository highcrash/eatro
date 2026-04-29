import { Module } from '@nestjs/common';
import { TipsoiClient } from './tipsoi.client';
import { TipsoiSyncService } from './tipsoi.sync.service';
import { TipsoiScheduler } from './tipsoi.scheduler';
import { TipsoiController } from './tipsoi.controller';

@Module({
  controllers: [TipsoiController],
  providers: [TipsoiClient, TipsoiSyncService, TipsoiScheduler],
  exports: [TipsoiSyncService],
})
export class TipsoiModule {}

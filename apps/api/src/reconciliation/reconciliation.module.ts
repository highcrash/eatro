import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { WasteModule } from '../waste/waste.module';
import { IngredientModule } from '../ingredient/ingredient.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [WasteModule, IngredientModule, ActivityLogModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}

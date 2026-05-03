import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { IngredientModule } from '../ingredient/ingredient.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [UnitConversionModule, IngredientModule, WhatsAppModule, ActivityLogModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}

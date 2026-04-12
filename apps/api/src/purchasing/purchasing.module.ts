import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { IngredientModule } from '../ingredient/ingredient.module';

@Module({
  imports: [UnitConversionModule, IngredientModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}

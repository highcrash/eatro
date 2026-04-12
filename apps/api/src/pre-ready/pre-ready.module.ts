import { Module } from '@nestjs/common';
import { PreReadyService } from './pre-ready.service';
import { PreReadyController } from './pre-ready.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { IngredientModule } from '../ingredient/ingredient.module';

@Module({
  imports: [UnitConversionModule, IngredientModule],
  controllers: [PreReadyController],
  providers: [PreReadyService],
  exports: [PreReadyService],
})
export class PreReadyModule {}

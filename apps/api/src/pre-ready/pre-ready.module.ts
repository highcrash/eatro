import { Module } from '@nestjs/common';
import { PreReadyService } from './pre-ready.service';
import { PreReadyController } from './pre-ready.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { IngredientModule } from '../ingredient/ingredient.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [UnitConversionModule, IngredientModule, ActivityLogModule],
  controllers: [PreReadyController],
  providers: [PreReadyService],
  exports: [PreReadyService],
})
export class PreReadyModule {}

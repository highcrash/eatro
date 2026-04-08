import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';

@Module({
  imports: [UnitConversionModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}

import { Module } from '@nestjs/common';
import { PreReadyService } from './pre-ready.service';
import { PreReadyController } from './pre-ready.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';

@Module({
  imports: [UnitConversionModule],
  controllers: [PreReadyController],
  providers: [PreReadyService],
  exports: [PreReadyService],
})
export class PreReadyModule {}

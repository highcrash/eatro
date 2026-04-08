import { Module } from '@nestjs/common';
import { CookingStationService } from './cooking-station.service';
import { CookingStationController } from './cooking-station.controller';

@Module({
  controllers: [CookingStationController],
  providers: [CookingStationService],
})
export class CookingStationModule {}

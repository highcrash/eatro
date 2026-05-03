import { Module } from '@nestjs/common';
import { IngredientService } from './ingredient.service';
import { IngredientController } from './ingredient.controller';
import { IngredientScheduler } from './ingredient.scheduler';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [WsGatewayModule, ActivityLogModule],
  controllers: [IngredientController],
  providers: [IngredientService, IngredientScheduler],
  exports: [IngredientService],
})
export class IngredientModule {}

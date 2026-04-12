import { Module } from '@nestjs/common';
import { WasteService } from './waste.service';
import { WasteController } from './waste.controller';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { IngredientModule } from '../ingredient/ingredient.module';

@Module({
  imports: [WsGatewayModule, IngredientModule],
  controllers: [WasteController],
  providers: [WasteService],
})
export class WasteModule {}

import { Module } from '@nestjs/common';
import { OrderController, QrOrderController } from './order.controller';
import { OrderService } from './order.service';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { RecipeModule } from '../recipe/recipe.module';
import { AccountModule } from '../account/account.module';
import { BranchSettingsModule } from '../branch-settings/branch-settings.module';
import { QrGateModule } from '../qr-gate/qr-gate.module';

@Module({
  imports: [WsGatewayModule, RecipeModule, AccountModule, BranchSettingsModule, QrGateModule],
  controllers: [OrderController, QrOrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}

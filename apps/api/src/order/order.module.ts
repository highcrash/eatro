import { Module } from '@nestjs/common';
import { OrderController, QrOrderController } from './order.controller';
import { OrderService } from './order.service';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { RecipeModule } from '../recipe/recipe.module';
import { AccountModule } from '../account/account.module';
import { BranchSettingsModule } from '../branch-settings/branch-settings.module';
import { QrGateModule } from '../qr-gate/qr-gate.module';
import { SmsModule } from '../sms/sms.module';
import { MushakModule } from '../mushak/mushak.module';

@Module({
  imports: [WsGatewayModule, RecipeModule, AccountModule, BranchSettingsModule, QrGateModule, SmsModule, MushakModule],
  controllers: [OrderController, QrOrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}

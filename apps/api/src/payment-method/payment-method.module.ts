import { Module } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { PaymentMethodController } from './payment-method.controller';

@Module({
  controllers: [PaymentMethodController],
  providers: [PaymentMethodService],
  exports: [PaymentMethodService],
})
export class PaymentMethodModule {}

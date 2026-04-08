import { Module } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [OrderModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}

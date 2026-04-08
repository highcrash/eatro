import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DiscountService } from './discount.service';
import { DiscountController, DiscountPosController, DiscountPublicController } from './discount.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DiscountController, DiscountPosController, DiscountPublicController],
  providers: [DiscountService],
  exports: [DiscountService],
})
export class DiscountModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DiscountService } from './discount.service';
import { DiscountController, DiscountPosController, DiscountPublicController } from './discount.controller';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [PrismaModule, SocialModule],
  controllers: [DiscountController, DiscountPosController, DiscountPublicController],
  providers: [DiscountService],
  exports: [DiscountService],
})
export class DiscountModule {}

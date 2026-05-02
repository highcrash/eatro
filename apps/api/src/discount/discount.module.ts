import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DiscountService } from './discount.service';
import { DiscountController, DiscountPosController, DiscountPublicController } from './discount.controller';
import { SocialModule } from '../social/social.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [PrismaModule, SocialModule, ActivityLogModule],
  controllers: [DiscountController, DiscountPosController, DiscountPublicController],
  providers: [DiscountService],
  exports: [DiscountService],
})
export class DiscountModule {}

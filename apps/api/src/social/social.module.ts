import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { SocialScheduler } from './social.scheduler';
import { FacebookClient } from './facebook.client';
import { SocialImageStore } from './image-store';

/**
 * Social module — auto-Facebook-post pipeline for menu discounts.
 *
 * Exports SocialService so DiscountModule can call
 * `scheduleForDiscount(...)` after a successful insert/update without
 * needing to wire the underlying clients itself.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SocialController],
  providers: [SocialService, SocialScheduler, FacebookClient, SocialImageStore],
  exports: [SocialService],
})
export class SocialModule {}

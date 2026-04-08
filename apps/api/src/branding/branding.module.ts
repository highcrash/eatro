import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BrandingService } from './branding.service';
import { BrandingController, BrandingPublicController } from './branding.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BrandingPublicController, BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}

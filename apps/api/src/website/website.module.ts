import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsiteService } from './website.service';
import { WebsiteController, WebsitePublicController } from './website.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WebsiteController, WebsitePublicController],
  providers: [WebsiteService],
  exports: [WebsiteService],
})
export class WebsiteModule {}

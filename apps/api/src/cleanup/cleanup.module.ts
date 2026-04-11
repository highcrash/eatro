import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CleanupService } from './cleanup.service';
import { CleanupController } from './cleanup.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CleanupController],
  providers: [CleanupService],
})
export class CleanupModule {}

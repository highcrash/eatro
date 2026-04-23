import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MushakService } from './mushak.service';
import { MushakController } from './mushak.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MushakController],
  providers: [MushakService],
  exports: [MushakService],
})
export class MushakModule {}

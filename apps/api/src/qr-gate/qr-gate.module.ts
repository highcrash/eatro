import { Module } from '@nestjs/common';
import { QrGateController } from './qr-gate.controller';
import { QrGateService } from './qr-gate.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QrGateController],
  providers: [QrGateService],
  exports: [QrGateService],
})
export class QrGateModule {}

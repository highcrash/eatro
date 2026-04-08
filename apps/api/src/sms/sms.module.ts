import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsService } from './sms.service';
import { SmsController, VoidOtpController, ApprovalOtpController } from './sms.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SmsController, VoidOtpController, ApprovalOtpController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}

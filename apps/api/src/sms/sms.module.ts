import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsService } from './sms.service';
import { SmsStatusScheduler } from './sms.scheduler';
import { SmsController, VoidOtpController, ApprovalOtpController, SmsAdminController } from './sms.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SmsController, VoidOtpController, ApprovalOtpController, SmsAdminController],
  providers: [SmsService, SmsStatusScheduler],
  exports: [SmsService],
})
export class SmsModule {}

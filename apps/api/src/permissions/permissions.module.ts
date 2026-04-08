import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';

@Module({
  imports: [PrismaModule, SmsModule],
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}

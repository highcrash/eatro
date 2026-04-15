import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicePublicController, DeviceAdminController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  imports: [PrismaModule],
  controllers: [DevicePublicController, DeviceAdminController],
  providers: [DeviceService],
  exports: [DeviceService],
})
export class DeviceModule {}

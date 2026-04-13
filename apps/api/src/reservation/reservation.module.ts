import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { ReservationService } from './reservation.service';
import { ReservationController, ReservationPublicController } from './reservation.controller';
import { ReservationScheduler } from './reservation.scheduler';

@Module({
  imports: [PrismaModule, SmsModule, WsGatewayModule],
  controllers: [ReservationPublicController, ReservationController],
  providers: [ReservationService, ReservationScheduler],
  exports: [ReservationService],
})
export class ReservationModule {}

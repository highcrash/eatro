import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [PrismaModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class WsGatewayModule {}

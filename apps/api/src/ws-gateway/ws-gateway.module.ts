import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RestoraPosGateway } from './restora-pos.gateway';

@Module({
  imports: [PrismaModule],
  providers: [RestoraPosGateway],
  exports: [RestoraPosGateway],
})
export class WsGatewayModule {}

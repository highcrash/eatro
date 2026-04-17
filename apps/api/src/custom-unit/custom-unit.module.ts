import { Module } from '@nestjs/common';
import { CustomUnitController } from './custom-unit.controller';
import { CustomUnitService } from './custom-unit.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomUnitController],
  providers: [CustomUnitService],
})
export class CustomUnitModule {}

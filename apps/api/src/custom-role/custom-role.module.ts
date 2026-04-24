import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomRoleService } from './custom-role.service';
import { CustomRoleController } from './custom-role.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CustomRoleController],
  providers: [CustomRoleService],
  exports: [CustomRoleService],
})
export class CustomRoleModule {}

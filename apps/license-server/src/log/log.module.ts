import { Global, Module } from '@nestjs/common';
import { LogService } from './log.service';
import { LogAdminController } from './log.admin.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

/** @Global() so license + admin services can write logs without
 *  importing this module everywhere. The admin read controller is
 *  co-located here for locality. */
@Global()
@Module({
  imports: [AdminAuthModule],
  controllers: [LogAdminController],
  providers: [LogService],
  exports: [LogService],
})
export class LogModule {}

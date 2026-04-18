import { Global, Module } from '@nestjs/common';
import { LogService } from './log.service';

/** @Global() so license + admin services can write logs without
 *  importing this module everywhere. */
@Global()
@Module({
  providers: [LogService],
  exports: [LogService],
})
export class LogModule {}

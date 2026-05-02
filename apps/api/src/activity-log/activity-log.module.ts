import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogScheduler } from './activity-log.scheduler';

/**
 * Generic admin-config audit trail. Other modules import this one and
 * inject ActivityLogService to emit log rows; the controller serves the
 * paginated list + per-entity drill-in for the admin viewer.
 *
 * Logging is fire-and-forget at the call site (`void log.log(...)`) so a
 * failure here cannot crash the underlying mutation.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ActivityLogController],
  providers: [ActivityLogService, ActivityLogScheduler],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}

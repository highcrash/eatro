import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

/**
 * Root module. Feature modules (product/purchase-code/license/admin-auth/
 * signing-key/log/envato) are wired in as they land in subsequent commits.
 * For now the server boots with just health + Prisma so we can verify the
 * scaffold compiles + runs end-to-end before adding business logic.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Global default throttle. Per-route limits (activate=5/min/IP,
    // verify=60/min/licenseId) live on the individual controllers.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: seconds(60), limit: 120 },
    ]),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}

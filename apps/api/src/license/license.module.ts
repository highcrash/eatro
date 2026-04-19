import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from '../prisma/prisma.module';
import { LicenseController } from './license.controller';
import { LicenseGuard } from './license.guard';
import { LicenseScheduler } from './license.scheduler';
import { LicenseService } from './license.service';

/**
 * @Global() so the four hot services (order, payment, staff, branch)
 * can `constructor(private readonly license: LicenseService) {}` without
 * importing this module everywhere. The APP_GUARD registration here is
 * what makes the gate run on every route — alternative would be a
 * `@UseGuards(LicenseGuard)` on every controller, which is easy to
 * forget when adding a new feature.
 *
 * Order of registration in app.module.ts matters: this module must
 * come AFTER PrismaModule + ScheduleModule but BEFORE the feature
 * modules whose mutations call `license.assertMutation()` — Nest
 * resolves DI in declaration order.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LicenseController],
  providers: [
    LicenseService,
    LicenseScheduler,
    { provide: APP_GUARD, useClass: LicenseGuard },
  ],
  exports: [LicenseService],
})
export class LicenseModule {}

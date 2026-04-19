import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InstallController } from './install.controller';
import { InstallGuard } from './install.guard';
import { InstallService } from './install.service';

/**
 * Wizard module. Lives only on the codecanyon branch — buyers download
 * a copy with an empty DB, the wizard runs once, then 404s itself out
 * of existence. There is no DI consumer outside the controller, so no
 * exports.
 *
 * InstallGuard is provided here (singleton) so its in-memory cache is
 * shared between guard invocations and the InstallService that flips
 * the `markInstalled()` flag at finish time.
 */
@Module({
  imports: [PrismaModule],
  controllers: [InstallController],
  providers: [InstallService, InstallGuard],
})
export class InstallModule {}

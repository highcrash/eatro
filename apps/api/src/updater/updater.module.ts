import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupModule } from '../backup/backup.module';
import { UpdaterController } from './updater.controller';
import { UpdaterService } from './updater.service';

/**
 * In-app updater. Admin uploads a new release zip via
 * Settings → Updates; we verify signature, backup DB, swap files,
 * run migrations, exit so PM2 restarts us.
 *
 * OnApplicationBootstrap: if the previous process wrote an apply
 * marker before exiting, the NEW process (that's us right now)
 * needs to finalize the UpdateRecord row as APPLIED. That has to
 * happen after Prisma is ready, so we do it on bootstrap not in
 * the module constructor.
 */
@Module({
  imports: [PrismaModule, BackupModule],
  controllers: [UpdaterController],
  providers: [UpdaterService],
  exports: [UpdaterService],
})
export class UpdaterModule implements OnApplicationBootstrap {
  constructor(private readonly svc: UpdaterService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.svc.finalizeBootIfPending();
  }
}

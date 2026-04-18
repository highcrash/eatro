import { Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseAdminController } from './license.admin.controller';
import { LicenseService } from './license.service';
import { AbuseTracker } from './abuse-tracker';
import { HmacRequestGuard } from './guards/hmac-request.guard';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

/**
 * Public license endpoints + their service + admin read/revoke.
 * CryptoModule, PrismaModule, LogModule are already @Global().
 * AdminAuthModule is imported so the admin-jwt strategy is registered
 * before LicenseAdminController mounts its AdminJwtGuard.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [LicenseController, LicenseAdminController],
  providers: [LicenseService, AbuseTracker, HmacRequestGuard],
  exports: [LicenseService],
})
export class LicenseModule {}

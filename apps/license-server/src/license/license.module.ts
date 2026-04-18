import { Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { AbuseTracker } from './abuse-tracker';
import { HmacRequestGuard } from './guards/hmac-request.guard';

/**
 * Public license endpoints + their service. CryptoModule, PrismaModule,
 * and LogModule are already @Global() so this module imports nothing
 * beyond Nest's own machinery — keeping the dependency graph flat.
 */
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, AbuseTracker, HmacRequestGuard],
  exports: [LicenseService],
})
export class LicenseModule {}

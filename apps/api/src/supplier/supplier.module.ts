import { Module } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import { AccountModule } from '../account/account.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AccountModule, ActivityLogModule, WhatsAppModule],
  controllers: [SupplierController],
  providers: [SupplierService],
  exports: [SupplierService],
})
export class SupplierModule {}

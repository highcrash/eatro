import { Module } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import { AccountModule } from '../account/account.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [AccountModule, ActivityLogModule],
  controllers: [SupplierController],
  providers: [SupplierService],
  exports: [SupplierService],
})
export class SupplierModule {}

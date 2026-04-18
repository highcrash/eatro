import { Module } from '@nestjs/common';
import { PurchaseCodeAdminController } from './purchase-code.admin.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [AdminAuthModule],
  controllers: [PurchaseCodeAdminController],
})
export class PurchaseCodeModule {}
